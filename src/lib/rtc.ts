/**
 * Conexão 1-a-1 do mesh.
 *
 * Cada par de participantes tem UMA RTCPeerConnection com 4 slots de mídia,
 * sempre nesta ordem:
 *
 *   0: audio  -> microfone
 *   1: audio  -> áudio da tela compartilhada
 *   2: video  -> câmera
 *   3: video  -> tela
 *
 * Só o lado iniciador (o "impolite") cria os transceivers. O outro lado NÃO
 * cria nada: adota os que chegam na oferta, na ordem em que vieram.
 *
 * Isso é importante e não é detalhe de estilo. Se os dois lados criarem os
 * transceivers antes de negociar, o SDP não casa os pares — ele empilha, e a
 * conexão termina com 8 transceivers desalinhados, os slots deixam de
 * corresponder e a mídia nunca flui.
 *
 * Com os slots prontos, ligar câmera ou tela é só `replaceTrack()`: a
 * negociação acontece uma vez só, na entrada.
 */

/** Reserva: o servidor manda a lista real (com TURN) no `welcome`. */
export const FALLBACK_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

export type SignalPayload =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit }

export type SlotName = 'mic' | 'screenAudio' | 'cam' | 'screen'

/** A ordem é contrato entre os dois lados. Mexeu aqui, mexeu nos dois. */
const SLOT_ORDER: SlotName[] = ['mic', 'screenAudio', 'cam', 'screen']

export class PeerConn {
  readonly id: string
  readonly pc: RTCPeerConnection

  /** Streams remotos, criados vazios e preenchidos pelo ontrack. */
  readonly micStream = new MediaStream()
  readonly camStream = new MediaStream()
  readonly screenStream = new MediaStream()

  private slots: Partial<Record<SlotName, RTCRtpTransceiver>> = {}
  /** Tracks pedidas antes dos slots existirem, aplicadas quando eles chegam. */
  private pending = new Map<SlotName, MediaStreamTrack | null>()

  /** Perfect negotiation (WHATWG): resolve colisão de ofertas sem travar. */
  private readonly polite: boolean
  private makingOffer = false
  private ignoreOffer = false
  private settingRemoteAnswer = false
  private retry: ReturnType<typeof setInterval> | null = null
  private retries = 0

  constructor(
    id: string,
    polite: boolean,
    private readonly signal: (data: SignalPayload) => void,
    private readonly onChange: () => void,
    iceServers: RTCIceServer[] = FALLBACK_ICE,
  ) {
    this.id = id
    this.polite = polite
    this.pc = new RTCPeerConnection({ iceServers })

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        this.signal({ description: this.pc.localDescription!.toJSON() })
        this.watchOffer()
      } catch (err) {
        console.error('[rtc] negotiationneeded', err)
      } finally {
        this.makingOffer = false
      }
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal({ candidate: candidate.toJSON() })
    }

    this.pc.ontrack = (ev) => {
      // Pelo índice, não pela identidade: do lado que adota, os transceivers
      // são criados pelo navegador e não existem antes da oferta chegar.
      const slot = SLOT_ORDER[this.pc.getTransceivers().indexOf(ev.transceiver)]
      const target =
        slot === 'mic' ? this.micStream
        : slot === 'cam' ? this.camStream
        : slot === 'screen' || slot === 'screenAudio' ? this.screenStream
        : null
      if (!target) return
      if (!target.getTracks().includes(ev.track)) target.addTrack(ev.track)
      this.onChange()
    }

    this.pc.oniceconnectionstatechange = () => {
      // Rede caiu ou trocou de Wi-Fi pra 4G: tenta reerguer os candidatos.
      if (this.pc.iceConnectionState === 'failed') this.pc.restartIce()
      this.onChange()
    }
    this.pc.onconnectionstatechange = () => this.onChange()

    // Só o iniciador abre os slots — é o que define a ordem dos m-lines.
    if (!polite) {
      for (const name of SLOT_ORDER) {
        this.slots[name] = this.pc.addTransceiver(
          name === 'mic' || name === 'screenAudio' ? 'audio' : 'video',
          { direction: 'sendrecv' },
        )
      }
      this.flushPending()
    }
  }

  get connectionState() {
    return this.pc.connectionState
  }

  /**
   * A sinalização trafega por um canal de broadcast, sem entrega garantida
   * nem ordem. Se a oferta se perder, os dois lados ficam esperando em
   * silêncio — um por uma resposta, o outro por uma oferta que nunca chegou.
   * Reenviar algumas vezes custa pouco e evita a chamada morta.
   */
  private watchOffer() {
    this.clearWatch()
    this.retries = 0
    this.retry = setInterval(() => {
      const esperando =
        this.pc.signalingState === 'have-local-offer' && !this.pc.remoteDescription
      if (!esperando || this.retries >= 4) return this.clearWatch()
      this.retries++
      this.signal({ description: this.pc.localDescription!.toJSON() })
    }, 4000)
  }

  private clearWatch() {
    if (this.retry) clearInterval(this.retry)
    this.retry = null
  }

  /**
   * Depois de setRemoteDescription: pega os slots pela ordem e **abre o envio**.
   *
   * Transceiver criado a partir de uma oferta remota nasce `recvonly`, e
   * `replaceTrack` não muda isso — não renegociar é exatamente a graça dele.
   * Sem forçar `sendrecv` aqui, este lado recebe áudio mas nunca transmite:
   * a faixa fica presa ao emissor, aparentemente saudável, e não sai um pacote.
   *
   * Precisa ser antes de montar a resposta, para que ela já anuncie sendrecv
   * e não exija uma segunda rodada de negociação.
   */
  private adoptSlots() {
    if (this.slots.mic) return
    const tx = this.pc.getTransceivers()
    if (tx.length < SLOT_ORDER.length) return

    SLOT_ORDER.forEach((name, i) => {
      this.slots[name] = tx[i]
      if (tx[i].direction !== 'sendrecv') tx[i].direction = 'sendrecv'
    })
    this.flushPending()
  }

  private flushPending() {
    for (const [name, track] of this.pending) this.setTrack(name, track)
    this.pending.clear()
  }

  async handleSignal(data: SignalPayload) {
    try {
      if ('description' in data) {
        const desc = data.description
        const readyForOffer =
          !this.makingOffer &&
          (this.pc.signalingState === 'stable' || this.settingRemoteAnswer)
        const collision = desc.type === 'offer' && !readyForOffer

        this.ignoreOffer = !this.polite && collision
        if (this.ignoreOffer) return

        this.settingRemoteAnswer = desc.type === 'answer'
        await this.pc.setRemoteDescription(desc)
        this.settingRemoteAnswer = false
        this.clearWatch()
        this.adoptSlots()

        if (desc.type === 'offer') {
          await this.pc.setLocalDescription()
          this.signal({ description: this.pc.localDescription!.toJSON() })
        }
      } else if ('candidate' in data) {
        try {
          await this.pc.addIceCandidate(data.candidate)
        } catch (err) {
          if (!this.ignoreOffer) throw err
        }
      }
    } catch (err) {
      console.error('[rtc] handleSignal', err)
    }
  }

  /** `null` para de enviar naquele slot (a câmera apaga de verdade do outro lado). */
  setTrack(slot: SlotName, track: MediaStreamTrack | null) {
    const tx = this.slots[slot]
    if (!tx) {
      // Ainda sem slots (lado que adota): guarda e aplica quando a oferta chegar.
      this.pending.set(slot, track)
      return
    }
    tx.sender.replaceTrack(track).catch((err) => console.error('[rtc] replaceTrack', err))
  }

  close() {
    this.clearWatch()
    this.pc.onnegotiationneeded = null
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    this.pc.oniceconnectionstatechange = null
    this.pc.onconnectionstatechange = null
    this.pc.close()
  }
}
