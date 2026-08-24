import { PeerConn, FALLBACK_ICE, type SignalPayload } from './rtc'
import { RemoteAudio, LocalMeter, setLevelListener, MAX_GAIN } from './audio'
import { getMic, getCam, getScreen, stopStream, mediaErrorMessage } from './media'
import { findMentions, mentionsMe } from './mentions'
import type { Attachment } from './upload'

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

const VOL_KEY = 'derecord:volumes'

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

  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  private volumes = loadVolumes()
  private reconnectTimer: number | null = null
  private closing = false

  constructor() {
    setLevelListener(() => this.emit())
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

  connect(name: string, roomId = 'geral') {
    this.name = name
    this.roomId = roomId
    this.closing = false
    this.status = this.meId ? 'reconnecting' : 'connecting'
    this.emit()

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = () => this.send({ t: 'join', name, room: roomId })
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data))

    ws.onclose = () => {
      if (this.closing) return
      this.status = 'reconnecting'
      // Derruba o mesh; quem estiver na voz se reapresenta depois do rejoin.
      this.peers.forEach((p) => this.dropConn(p))
      this.peers.clear()
      this.emit()
      this.reconnectTimer = window.setTimeout(() => this.connect(name, roomId), 1500)
    }

    ws.onerror = () => ws.close()
  }

  disconnect() {
    this.closing = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.leaveVoice()
    this.peers.clear()
    this.ws?.close()
    this.ws = null
    this.status = 'idle'
    this.meId = ''
    this.emit()
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private onMessage(msg: any) {
    switch (msg.t) {
      case 'welcome': {
        this.meId = msg.id
        this.status = 'connected'
        this.chat = msg.history || []
        if (msg.iceServers?.length) this.iceServers = msg.iceServers
        msg.peers.forEach((p: any) => this.addPeer(p))
        // Se caiu e voltou enquanto estava na voz, refaz o mesh.
        if (this.inVoice) {
          this.send({ t: 'voice', join: true })
          this.broadcastState()
          this.peers.forEach((p) => p.voice && this.ensureConn(p))
        }
        break
      }

      case 'peer-join':
        this.addPeer(msg.peer)
        break

      case 'peer-leave': {
        const p = this.peers.get(msg.id)
        if (p) {
          this.dropConn(p)
          this.peers.delete(msg.id)
        }
        if (this.pinned === msg.id) this.pinned = null
        break
      }

      case 'peer-voice': {
        const p = this.peers.get(msg.id)
        if (!p) break
        p.voice = msg.voice
        p.state = msg.state
        if (p.voice) {
          if (this.inVoice) this.ensureConn(p)
        } else {
          this.dropConn(p)
          if (this.pinned === p.id) this.pinned = null
        }
        break
      }

      case 'peer-state': {
        const p = this.peers.get(msg.id)
        if (p) p.state = msg.state
        break
      }

      case 'signal': {
        const p = this.peers.get(msg.from)
        // Sinal pode chegar antes de eu processar o peer-voice do outro lado.
        if (p && !p.conn && this.inVoice) this.ensureConn(p)
        void p?.conn?.handleSignal(msg.data as SignalPayload)
        return // handleSignal emite depois, via onChange
      }

      case 'chat': {
        const m = msg as ChatMsg
        this.chat = [...this.chat, m].slice(-200)
        if (m.from !== this.meId) {
          this.unread++
          if (mentionsMe(m.mentions, this.name)) this.unreadMentions++
        }
        break
      }
    }
    this.emit()
  }

  private addPeer(raw: { id: string; name: string; voice: boolean; state: PeerState }) {
    if (this.peers.has(raw.id)) return
    const saved = this.volumes[raw.name] ?? { volume: 1, muted: false }
    const p: Participant = {
      id: raw.id,
      name: raw.name,
      voice: raw.voice,
      state: raw.state,
      conn: null,
      audio: null,
      volume: saved.volume,
      localMuted: saved.muted,
    }
    this.peers.set(raw.id, p)
    if (this.inVoice && p.voice) this.ensureConn(p)
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
    this.send({ t: 'voice', join: true })
    this.broadcastState()
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

    this.send({ t: 'voice', join: false })
    this.emit()
  }

  // -------- conexões do mesh ------------------------------------------------

  private ensureConn(p: Participant) {
    if (p.conn || !this.inVoice || !p.voice || p.id === this.meId) return

    p.conn = new PeerConn(
      p.id,
      this.meId < p.id, // polite/impolite: determinístico e oposto dos dois lados
      (data) => this.send({ t: 'signal', to: p.id, data }),
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
  }

  private dropConn(p: Participant) {
    p.audio?.close()
    p.conn?.close()
    p.audio = null
    p.conn = null
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

  private broadcastState() {
    this.send({ t: 'state', mic: this.micOn, cam: this.camOn, screen: this.screenOn })
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
    this.broadcastState()
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
    this.broadcastState()
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
    this.broadcastState()
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
    this.broadcastState()
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

  sendChat(text: string, image?: Attachment | null) {
    const trimmed = text.trim()
    if (!trimmed && !image) return
    this.send({
      t: 'chat',
      text: trimmed,
      image: image ? { url: image.url, w: image.w, h: image.h } : null,
      replyTo: this.replyTo,
      mentions: findMentions(trimmed, this.knownNames),
    })
    this.replyTo = null
    this.emit()
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
