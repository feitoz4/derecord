/**
 * Volume por pessoa + indicador de quem está falando.
 *
 * Até 100% quem toca é o próprio <audio> (caminho nativo, mais robusto).
 * Acima de 100% o elemento é silenciado e o áudio passa a sair por um
 * GainNode do Web Audio — é ele que permite passar de 1.0 e realmente
 * amplificar o microfone de quem fala baixo.
 *
 * O AnalyserNode fica sempre ligado: ele não produz saída, então dá pra
 * medir o volume sem interferir na reprodução.
 */

let ctx: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export const MAX_GAIN = 3 // 300%

// -------- medidor compartilhado --------------------------------------------

type Meter = {
  analyser: AnalyserNode
  buf: Uint8Array<ArrayBuffer>
  speaking: boolean
  lastLoud: number
  level: number
}

const meters = new Set<Meter>()
let ticking = false
let onLevels: (() => void) | null = null

const SPEAK_RMS = 0.022 // limiar de voz; abaixo disso é ruído de fundo
const HANGOVER = 350 // ms que o indicador segura aceso após parar de falar

function tick() {
  if (meters.size === 0) {
    ticking = false
    return
  }
  const now = performance.now()
  let changed = false

  for (const m of meters) {
    m.analyser.getByteTimeDomainData(m.buf)
    let sum = 0
    for (let i = 0; i < m.buf.length; i++) {
      const v = (m.buf[i] - 128) / 128
      sum += v * v
    }
    const rms = Math.sqrt(sum / m.buf.length)
    m.level = Math.min(1, rms * 4)

    if (rms > SPEAK_RMS) m.lastLoud = now
    const speaking = now - m.lastLoud < HANGOVER
    if (speaking !== m.speaking) {
      m.speaking = speaking
      changed = true
    }
  }

  if (changed) onLevels?.()
  setTimeout(() => requestAnimationFrame(tick), 60) // ~15fps, barato
}

function startTicking() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(tick)
}

export function setLevelListener(cb: () => void) {
  onLevels = cb
}

function makeMeter(source: AudioNode): Meter {
  const analyser = audioContext().createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.4
  source.connect(analyser)
  const m: Meter = {
    analyser,
    buf: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
    speaking: false,
    lastLoud: 0,
    level: 0,
  }
  meters.add(m)
  startTicking()
  return m
}

// -------- saída de um participante remoto -----------------------------------

export class RemoteAudio {
  private el: HTMLAudioElement
  private source: MediaStreamAudioSourceNode
  private gain: GainNode
  private meter: Meter

  private volume = 1
  private muted = false

  constructor(stream: MediaStream) {
    const ac = audioContext()

    // Chrome só faz o áudio de uma stream WebRTC "fluir" se ela estiver
    // presa a um elemento de mídia, mesmo quando quem toca é o Web Audio.
    // O elemento também vai para o documento: elemento solto funciona no
    // Chrome, mas é terreno pouco garantido entre navegadores.
    this.el = new Audio()
    this.el.srcObject = stream
    this.el.autoplay = true
    this.el.volume = 1
    this.el.style.display = 'none'
    document.body.append(this.el)
    void this.el.play().catch((err) => console.warn('[audio] play bloqueado', err))

    this.source = ac.createMediaStreamSource(stream)
    this.gain = ac.createGain()
    this.gain.gain.value = 0 // desligado enquanto não passa de 100%
    this.source.connect(this.gain).connect(ac.destination)

    this.meter = makeMeter(this.source)
    this.apply()
  }

  private apply() {
    if (this.muted) {
      this.el.muted = true
      this.gain.gain.value = 0
      return
    }
    if (this.volume <= 1) {
      this.el.muted = false
      this.el.volume = this.volume
      this.gain.gain.value = 0
    } else {
      // Boost: o elemento cala e o ganho assume, senão sairia dobrado.
      this.el.muted = true
      this.gain.gain.value = this.volume
    }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(MAX_GAIN, v))
    this.apply()
  }

  setMuted(m: boolean) {
    this.muted = m
    this.apply()
  }

  get speaking() {
    return !this.muted && this.meter.speaking
  }

  get level() {
    return this.muted ? 0 : this.meter.level
  }

  close() {
    meters.delete(this.meter)
    try {
      this.source.disconnect()
      this.gain.disconnect()
    } catch {}
    this.el.srcObject = null
    this.el.remove()
  }
}

// -------- medidor do próprio microfone --------------------------------------

export class LocalMeter {
  private source: MediaStreamAudioSourceNode
  private meter: Meter

  constructor(stream: MediaStream) {
    this.source = audioContext().createMediaStreamSource(stream)
    this.meter = makeMeter(this.source)
  }
  get speaking() {
    return this.meter.speaking
  }
  get level() {
    return this.meter.level
  }
  close() {
    meters.delete(this.meter)
    try {
      this.source.disconnect()
    } catch {}
  }
}
