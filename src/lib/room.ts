import { PeerConn, FALLBACK_ICE, type SignalPayload } from './rtc'
import { RemoteAudio, LocalMeter, setLevelListener, MAX_GAIN } from './audio'
import { getMic, getCam, getScreen, stopStream, mediaErrorMessage } from './media'
import { findMentions, mentionsMe } from './mentions'
import type { Attachment } from './upload'
import { supabase, type MessageRow } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

/** O que cada pessoa publica no presence do canal. */
type Presence = { name: string; voice: boolean; state: PeerState }

export type PeerState = { mic: boolean; cam: boolean; screen: boolean }

export type Participant = {
  id: string
  name: string
  /** Online no grupo é uma coisa; estar no canal de voz é outra. */
  voice: boolean
  state: PeerState
  /** Só existe enquanto os dois lados estiverem no canal de voz. */
  conn: PeerConn | null
  audio: RemoteAudio | null
  volume: number
  localMuted: boolean
}

export type ReplyRef = { id: string; name: string; text: string; image?: boolean }

export type ChatImage = { url: string; w: number; h: number }

export type ChatMsg = {
  id: string
  from: string
  name: string
  text: string
  ts: number
  image?: ChatImage | null
  replyTo?: ReplyRef | null
  mentions?: string[]
}

export type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting'

const VOL_KEY = 'nearbycord:volumes'
const ID_KEY = 'nearbycord:id'
const NAME_KEY = 'nearbycord:name'

export type Member = { id: string; name: string; lastSeen: number; online: boolean }

/**
 * A identidade vive no navegador e não muda entre sessões.
 *
 * Antes o id nascia a cada conexão, o que impedia qualquer noção de "membro":
 * a mesma pessoa virava uma linha nova no banco toda vez que abria o app.
 */
function identidade(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

export const nomeSalvo = () => localStorage.getItem(NAME_KEY) ?? ''

/** Volume é salvo por nome — o id do participante muda a cada sessão. */
function loadVolumes(): Record<string, { volume: number; muted: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(VOL_KEY) || '{}')
  } catch {
    return {}
  }
}
function saveVolumes(v: Record<string, { volume: number; muted: boolean }>) {
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify(v))
  } catch {}
}

export class Room {
  status: Status = 'idle'
  meId = ''
  name = ''
  roomId = 'geral'
  error: string | null = null

  peers = new Map<string, Participant>()
  /** Todo mundo que já entrou nesta sala — é daqui que sai a lista de offline. */
  members: Member[] = []
  chat: ChatMsg[] = []
  unread = 0
  unreadMentions = 0

  /** Mensagem que o compositor está respondendo. */
  replyTo: ReplyRef | null = null

  /** Estou no canal de voz? */
  inVoice = false
  joiningVoice = false

  // mídia local
  micOn = false
  camOn = false
  screenOn = false
  micStream: MediaStream | null = null
  camStream: MediaStream | null = null
  screenStream: MediaStream | null = null
  localMeter: LocalMeter | null = null

  micDeviceId: string | undefined
  camDeviceId: string | undefined

  /** id fixado no palco; null = automático (quem estiver compartilhando tela) */
  pinned: string | null = null

  /** STUN/TURN vêm do servidor: a credencial de TURN é temporária. */
  iceServers: RTCIceServer[] = FALLBACK_ICE

  /** Sinais que chegaram antes de o presence trazer a pessoa. */
  private pendingSignals = new Map<string, SignalPayload[]>()
  private channel: RealtimeChannel | null = null
  private rejoinTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  private volumes = loadVolumes()
  private closing = false

  constructor() {
    setLevelListener(() => this.emit())
    this.meId = identidade()
    this.name = nomeSalvo()
  }

  // -------- assinatura para o React ----------------------------------------

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit() {
    this.listeners.forEach((cb) => cb())
  }

  // -------- conexão com o grupo --------------------------------------------

  async connect(name: string, roomId = 'geral') {
    this.name = name
    this.roomId = roomId
    this.closing = false
    this.status = 'connecting'
    localStorage.setItem(NAME_KEY, name)
    this.emit()

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: { key: this.meId },
        broadcast: { self: false },
      },
    })
    this.channel = channel

    // Presence substitui o peer-join/leave/voice/state de uma vez só:
    // o servidor manda o estado inteiro e eu comparo com o que tenho.
    channel.on('presence', { event: 'sync' }, () => this.syncPresence())

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload?.to !== this.meId) return
      this.onSignal(payload.from, payload.data as SignalPayload)
    })

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${roomId}` },
      ({ new: row }) => this.onChat(row as MessageRow),
    )

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Presença PRIMEIRO. É ela que faz as pessoas se enxergarem, e não
        // pode ficar atrás de nenhuma ida ao banco: se o histórico ou o
        // cadastro demorarem ou falharem, quem entrou vira invisível para
        // todo mundo — dentro do canal, mas sem nunca ter dito que chegou.
        try {
          await channel.track(this.presence())
        } catch (err) {
          console.error('[room] falhou ao anunciar presença', err)
        }

        this.status = 'connected'
        this.emit()

        // Histórico e cadastro são complementos: falham sozinhos, sem
        // derrubar a chamada.
        void this.loadHistory().catch((e) => console.warn('[room] histórico', e))
        void this.registerMember().catch((e) => console.warn('[room] membros', e))
        return
      }

      // CLOSED também entra aqui, e é o caso perigoso: o canal morre, mas a
      // tela continuaria dizendo "ao vivo" enquanto nada mais trafega — nem
      // presence, nem sinalização, nem chat. Sem reentrar, a chamada fica
      // muda para sempre.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (this.closing) return
        this.status = 'reconnecting'
        this.emit()
        this.scheduleRejoin()
      }
    })
  }

  /** Reentra no canal do zero. O mesh cai junto e se refaz pelo presence. */
  private scheduleRejoin() {
    if (this.rejoinTimer || this.closing) return
    this.rejoinTimer = setTimeout(async () => {
      this.rejoinTimer = null
      if (this.closing) return

      this.peers.forEach((p) => this.dropConn(p))
      this.peers.clear()
      this.pendingSignals.clear()

      const antigo = this.channel
      this.channel = null
      if (antigo) {
        try {
          await supabase.removeChannel(antigo)
        } catch {}
      }
      await this.connect(this.name, this.roomId)
    }, 2000)
  }

  disconnect() {
    this.closing = true
    if (this.rejoinTimer) clearTimeout(this.rejoinTimer)
    this.rejoinTimer = null
    this.leaveVoice()
    this.peers.clear()
    void this.channel?.unsubscribe()
    this.channel = null
    this.status = 'idle'
    // meId NÃO é zerado: agora é a identidade persistente da pessoa.
    this.emit()
  }

  private presence(): Presence {
    return {
      name: this.name,
      voice: this.inVoice,
      state: { mic: this.micOn, cam: this.camOn, screen: this.screenOn },
    }
  }

  /** Republica meu estado (voz, microfone, câmera, tela) para o grupo. */
  private publish() {
    void this.channel?.track(this.presence())
  }

  /**
   * Presence e broadcast são canais distintos e chegam fora de ordem: a oferta
   * de quem acabou de entrar na voz costuma passar na frente do presence que
   * anuncia essa mesma entrada.
   *
   * Por isso o sinal não pode depender do presence. Receber um sinal já é
   * prova de que a pessoa está na chamada; e se ela ainda nem apareceu, o
   * sinal fica guardado em vez de ser descartado. Sem isto, quem perdesse a
   * corrida ficava esperando uma resposta que nunca vinha — em silêncio.
   */
  private onSignal(from: string, data: SignalPayload) {
    if (!this.inVoice) return

    const p = this.peers.get(from)
    if (!p) {
      const fila = this.pendingSignals.get(from) ?? []
      fila.push(data)
      this.pendingSignals.set(from, fila.slice(-25))
      return
    }

    if (!p.voice) p.voice = true
    this.ensureConn(p)
    void p.conn?.handleSignal(data)
  }

  /** Aplica o que chegou cedo demais, agora que a conexão existe. */
  private flushSignals(p: Participant) {
    const fila = this.pendingSignals.get(p.id)
    if (!fila) return
    this.pendingSignals.delete(p.id)
    for (const data of fila) void p.conn?.handleSignal(data)
  }

  private signalTo(to: string, data: SignalPayload) {
    void this.channel?.send({
      type: 'broadcast',
      event: 'signal',
      payload: { to, from: this.meId, data },
    })
  }

  /**
   * O presence chega inteiro a cada mudança, então em vez de tratar eventos
   * de entrada e saída eu comparo a lista atual com a que tenho e ajusto.
   */
  private syncPresence() {
    const state = this.channel?.presenceState<Presence>() ?? {}
    const vistos = new Set<string>()

    for (const [id, metas] of Object.entries(state)) {
      const meta = metas[0]
      if (!meta || id === this.meId) continue
      vistos.add(id)

      const existente = this.peers.get(id)
      if (!existente) {
        this.addPeer(id, meta)
        continue
      }

      existente.name = meta.name
      existente.state = meta.state

      if (existente.voice !== meta.voice) {
        existente.voice = meta.voice
        if (meta.voice) {
          if (this.inVoice) this.ensureConn(existente)
        } else {
          this.dropConn(existente)
          if (this.pinned === id) this.pinned = null
        }
      }
    }

    // Quem sumiu do presence saiu do grupo.
    for (const [id, p] of this.peers) {
      if (vistos.has(id)) continue
      this.dropConn(p)
      this.peers.delete(id)
      if (this.pinned === id) this.pinned = null
    }

    this.emit()
  }

  private addPeer(id: string, meta: Presence) {
    const saved = this.volumes[meta.name] ?? { volume: 1, muted: false }
    const p: Participant = {
      id,
      name: meta.name,
      voice: meta.voice,
      state: meta.state,
      conn: null,
      audio: null,
      volume: saved.volume,
      localMuted: saved.muted,
    }
    this.peers.set(id, p)
    if (this.inVoice && p.voice) this.ensureConn(p)

    // Chegou alguém que o cadastro ainda não tinha: mostra já, sem esperar.
    if (!this.members.some((m) => m.id === id)) {
      this.members = [...this.members, { id, name: meta.name, lastSeen: Date.now(), online: true }]
    }
  }

  // -------- chat -------------------------------------------------------------

  private static toMsg(row: MessageRow): ChatMsg {
    return {
      id: row.id,
      from: row.author_id,
      name: row.name,
      text: row.text,
      ts: new Date(row.created_at).getTime(),
      image: row.image,
      replyTo: row.reply_to,
      mentions: row.mentions,
    }
  }

  /** Anuncia-se como membro da sala e recarrega a lista completa. */
  private async registerMember() {
    const { error } = await supabase.from('members').upsert({
      id: this.meId,
      room: this.roomId,
      name: this.name,
      last_seen: new Date().toISOString(),
    })
    // Sem a tabela o app continua funcionando; só não há lista de offline.
    if (error) {
      console.warn('[room] members indisponível', error.message)
      return
    }
    await this.loadMembers()
  }

  private async loadMembers() {
    const { data } = await supabase
      .from('members')
      .select('*')
      .eq('room', this.roomId)
      .order('name')

    if (!data) return
    this.members = data.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      lastSeen: new Date(r.last_seen as string).getTime(),
      online: false,
    }))
    this.emit()
  }

  /** Troca o nome sem sair da sala: presence e cadastro acompanham. */
  async setName(name: string) {
    const novo = name.trim().slice(0, 32)
    if (!novo || novo === this.name) return
    this.name = novo
    localStorage.setItem(NAME_KEY, novo)
    this.publish()
    this.emit()
    await this.registerMember()
  }

  private async loadHistory() {
    // Busca as mais recentes e inverte: o índice do banco é por data desc.
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room', this.roomId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      this.error = `Não consegui carregar o histórico: ${error.message}`
    } else if (data) {
      this.chat = data.reverse().map(Room.toMsg)
    }
    this.emit()
  }

  private onChat(row: MessageRow) {
    const m = Room.toMsg(row)
    // O insert também volta pra quem escreveu; não duplica se já estiver lá.
    if (this.chat.some((x) => x.id === m.id)) return
    this.chat = [...this.chat, m].slice(-200)
    if (m.from !== this.meId) {
      this.unread++
      if (mentionsMe(m.mentions, this.name)) this.unreadMentions++
    }
    this.emit()
  }

  // -------- canal de voz ----------------------------------------------------

  async joinVoice() {
    if (this.inVoice || this.joiningVoice) return
    this.joiningVoice = true
    this.error = null
    this.emit()

    // Entrar na voz já com o microfone é o esperado. Se negarem a permissão,
    // entra mesmo assim — só ouvindo.
    try {
      this.micStream = await getMic(this.micDeviceId)
      this.localMeter = new LocalMeter(this.micStream)
      this.micOn = true
    } catch (err) {
      this.error = `${mediaErrorMessage(err)} Você entrou só ouvindo.`
      this.micOn = false
    }

    this.inVoice = true
    this.joiningVoice = false
    this.publish()
    this.peers.forEach((p) => p.voice && this.ensureConn(p))
    this.emit()
  }

  leaveVoice() {
    if (!this.inVoice) return
    this.peers.forEach((p) => this.dropConn(p))

    stopStream(this.micStream)
    stopStream(this.camStream)
    stopStream(this.screenStream)
    this.localMeter?.close()
    this.micStream = this.camStream = this.screenStream = null
    this.localMeter = null
    this.micOn = this.camOn = this.screenOn = false
    this.inVoice = false
    this.pinned = null

    this.publish()
    this.emit()
  }

  // -------- conexões do mesh ------------------------------------------------

  private ensureConn(p: Participant) {
    if (p.conn || !this.inVoice || !p.voice || p.id === this.meId) return

    p.conn = new PeerConn(
      p.id,
      this.meId < p.id, // polite/impolite: determinístico e oposto dos dois lados
      (data) => this.signalTo(p.id, data),
      () => this.onPeerChange(p.id),
      this.iceServers,
    )

    // Quem entra no meio da chamada já recebe o que eu estou enviando agora.
    const mic = this.micStream?.getAudioTracks()[0] ?? null
    const cam = this.camStream?.getVideoTracks()[0] ?? null
    const scr = this.screenStream?.getVideoTracks()[0] ?? null
    const scrAudio = this.screenStream?.getAudioTracks()[0] ?? null
    if (mic) p.conn.setTrack('mic', mic)
    if (cam) p.conn.setTrack('cam', cam)
    if (scr) p.conn.setTrack('screen', scr)
    if (scrAudio) p.conn.setTrack('screenAudio', scrAudio)

    this.flushSignals(p)
  }

  private dropConn(p: Participant) {
    p.audio?.close()
    p.conn?.close()
    p.audio = null
    p.conn = null
    this.pendingSignals.delete(p.id)
  }

  private onPeerChange(id: string) {
    const p = this.peers.get(id)
    if (!p?.conn) return
    // O áudio remoto só pode ser montado depois que a track chega de fato.
    if (!p.audio && p.conn.micStream.getAudioTracks().length > 0) {
      p.audio = new RemoteAudio(p.conn.micStream)
      p.audio.setVolume(p.volume)
      p.audio.setMuted(p.localMuted)
    }
    this.emit()
  }

  private forEachConn(fn: (c: PeerConn) => void) {
    this.peers.forEach((p) => p.conn && fn(p.conn))
  }

  // -------- controles de mídia ---------------------------------------------

  /** Mute é `enabled = false`: para o áudio na hora e mantém a conexão quente. */
  async toggleMic() {
    if (!this.inVoice) return
    this.error = null
    if (!this.micStream) {
      try {
        this.micStream = await getMic(this.micDeviceId)
        this.localMeter = new LocalMeter(this.micStream)
        const track = this.micStream.getAudioTracks()[0]
        this.forEachConn((c) => c.setTrack('mic', track))
        this.micOn = true
      } catch (err) {
        this.error = mediaErrorMessage(err)
        this.emit()
        return
      }
    } else {
      this.micOn = !this.micOn
      this.micStream.getAudioTracks().forEach((t) => (t.enabled = this.micOn))
    }
    this.publish()
    this.emit()
  }

  /** Desligar a câmera para a track de verdade — o LED da webcam apaga. */
  async toggleCam() {
    if (!this.inVoice) return
    this.error = null
    if (this.camOn) {
      this.forEachConn((c) => c.setTrack('cam', null))
      stopStream(this.camStream)
      this.camStream = null
      this.camOn = false
    } else {
      try {
        this.camStream = await getCam(this.camDeviceId)
        const track = this.camStream.getVideoTracks()[0]
        this.forEachConn((c) => c.setTrack('cam', track))
        this.camOn = true
      } catch (err) {
        this.error = mediaErrorMessage(err)
        this.emit()
        return
      }
    }
    this.publish()
    this.emit()
  }

  async toggleScreen() {
    if (!this.inVoice) return
    this.error = null
    if (this.screenOn) {
      this.stopScreen()
      return
    }
    try {
      const stream = await getScreen()
      this.screenStream = stream
      const video = stream.getVideoTracks()[0]
      const audio = stream.getAudioTracks()[0] ?? null
      this.forEachConn((c) => {
        c.setTrack('screen', video)
        c.setTrack('screenAudio', audio)
      })
      // O navegador tem o próprio botão de parar o compartilhamento.
      video.onended = () => this.stopScreen()
      this.screenOn = true
      this.pinned = this.meId
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        this.error = mediaErrorMessage(err)
      }
    }
    this.publish()
    this.emit()
  }

  private stopScreen() {
    this.forEachConn((c) => {
      c.setTrack('screen', null)
      c.setTrack('screenAudio', null)
    })
    stopStream(this.screenStream)
    this.screenStream = null
    this.screenOn = false
    if (this.pinned === this.meId) this.pinned = null
    this.publish()
    this.emit()
  }

  async setMicDevice(deviceId: string) {
    this.micDeviceId = deviceId
    if (!this.micStream) return
    const wasOn = this.micOn
    stopStream(this.micStream)
    this.localMeter?.close()
    this.micStream = await getMic(deviceId)
    this.localMeter = new LocalMeter(this.micStream)
    const track = this.micStream.getAudioTracks()[0]
    track.enabled = wasOn
    this.forEachConn((c) => c.setTrack('mic', track))
    this.emit()
  }

  async setCamDevice(deviceId: string) {
    this.camDeviceId = deviceId
    if (!this.camOn) return
    stopStream(this.camStream)
    this.camStream = await getCam(deviceId)
    const track = this.camStream.getVideoTracks()[0]
    this.forEachConn((c) => c.setTrack('cam', track))
    this.emit()
  }

  // -------- volume dos outros ----------------------------------------------

  setVolume(id: string, volume: number) {
    const p = this.peers.get(id)
    if (!p) return
    p.volume = Math.max(0, Math.min(MAX_GAIN, volume))
    p.audio?.setVolume(p.volume)
    this.persistVolume(p)
    this.emit()
  }

  setLocalMuted(id: string, muted: boolean) {
    const p = this.peers.get(id)
    if (!p) return
    p.localMuted = muted
    p.audio?.setMuted(muted)
    this.persistVolume(p)
    this.emit()
  }

  private persistVolume(p: Participant) {
    this.volumes[p.name] = { volume: p.volume, muted: p.localMuted }
    saveVolumes(this.volumes)
  }

  pin(id: string | null) {
    this.pinned = this.pinned === id ? null : id
    this.emit()
  }

  async sendChat(text: string, image?: Attachment | null) {
    const trimmed = text.trim()
    if (!trimmed && !image) return

    const replyTo = this.replyTo
    // Limpa antes de gravar: a resposta some do compositor na hora, e a
    // mensagem volta pelo realtime como qualquer outra.
    this.replyTo = null
    this.emit()

    const { error } = await supabase.from('messages').insert({
      room: this.roomId,
      author_id: this.meId,
      name: this.name,
      text: trimmed,
      image: image ? { url: image.url, w: image.w, h: image.h } : null,
      reply_to: replyTo,
      mentions: findMentions(trimmed, this.knownNames),
    })

    if (error) {
      this.error = `Não consegui enviar: ${error.message}`
      this.emit()
    }
  }

  setReplyTo(msg: ChatMsg | null) {
    this.replyTo = msg
      ? {
          id: msg.id,
          name: msg.name,
          text: msg.text,
          image: !!msg.image,
        }
      : null
    this.emit()
  }

  /** Quem pode ser mencionado: quem está online agora + quem já falou no chat. */
  get knownNames(): string[] {
    const names = new Set<string>([this.name])
    this.peers.forEach((p) => names.add(p.name))
    this.chat.forEach((m) => names.add(m.name))
    return [...names]
  }

  clearUnread() {
    if (this.unread === 0 && this.unreadMentions === 0) return
    this.unread = 0
    this.unreadMentions = 0
    this.emit()
  }

  // -------- derivados -------------------------------------------------------

  /**
   * A lista da direita: quem está na voz, quem está online e quem está fora.
   * Presence manda no estado atual; o cadastro completa com os ausentes.
   */
  get roster(): { naVoz: Participant[]; online: Participant[]; offline: Member[] } {
    const presentes = new Set([...this.peers.keys(), this.meId])
    return {
      naVoz: this.voicePeers.sort((a, b) => a.name.localeCompare(b.name)),
      online: [...this.peers.values()]
        .filter((p) => !p.voice)
        .sort((a, b) => a.name.localeCompare(b.name)),
      offline: this.members
        .filter((m) => !presentes.has(m.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  /** Só quem está no canal de voz. */
  get voicePeers(): Participant[] {
    return [...this.peers.values()].filter((p) => p.voice)
  }

  /** Quem ocupa o palco: o fixado, senão quem estiver compartilhando tela. */
  get stageId(): string | null {
    if (!this.inVoice) return null
    if (this.pinned) return this.pinned
    if (this.screenOn) return this.meId
    for (const p of this.voicePeers) if (p.state.screen) return p.id
    return null
  }

  get speaking() {
    return this.micOn && !!this.localMeter?.speaking
  }
}
