import { useEffect, useRef, useState } from 'react'
import type { Room } from '../lib/room'
import { listDevices, type Devices } from '../lib/media'
import { MicOn, MicOff, CamOn, CamOff, Screen, ScreenOff, Settings } from './Icons'

/**
 * Fica no rodapé da barra lateral e não sai de lá — dá pra mutar o microfone
 * enquanto se lê o canal de texto, sem voltar pra chamada.
 */
export function VoiceControls({ room }: { room: Room }) {
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<Devices>({ mics: [], cams: [], speakers: [] })
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void listDevices().then(setDevices)
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Atalhos: os mesmos do Discord, porque é o que a mão já sabe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      if (!e.ctrlKey || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'm') {
        e.preventDefault()
        void room.toggleMic()
      } else if (k === 'v') {
        e.preventDefault()
        void room.toggleCam()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room])

  const live = room.inVoice
  const level = room.micOn ? (room.localMeter?.level ?? 0) : 0

  return (
    <div className="vctl">
      <button
        className={`vctl__btn ${room.micOn ? 'is-on' : 'is-off'}`}
        onClick={() => void room.toggleMic()}
        disabled={!live}
        title={live ? 'Microfone (Ctrl+Shift+M)' : 'Entre no canal de voz'}
      >
        {room.micOn ? <MicOn size={17} /> : <MicOff size={17} />}
        <span className="vctl__meter" style={{ transform: `scaleX(${level})` }} />
      </button>

      <button
        className={`vctl__btn ${room.camOn ? 'is-on' : 'is-off'}`}
        onClick={() => void room.toggleCam()}
        disabled={!live}
        title={live ? 'Câmera (Ctrl+Shift+V)' : 'Entre no canal de voz'}
      >
        {room.camOn ? <CamOn size={17} /> : <CamOff size={17} />}
      </button>

      <button
        className={`vctl__btn ${room.screenOn ? 'is-live' : 'is-off'}`}
        onClick={() => void room.toggleScreen()}
        disabled={!live}
        title={live ? 'Compartilhar tela' : 'Entre no canal de voz'}
      >
        {room.screenOn ? <ScreenOff size={17} /> : <Screen size={17} />}
      </button>

      <div className="vctl__wrap" ref={popRef}>
        <button
          className={`vctl__btn ${open ? 'is-on' : 'is-off'}`}
          onClick={() => setOpen((o) => !o)}
          title="Dispositivos"
        >
          <Settings size={17} />
        </button>

        {open && (
          <div className="popover">
            <label className="field">
              <span>Microfone</span>
              <select
                value={room.micDeviceId ?? ''}
                onChange={(e) => void room.setMicDevice(e.target.value)}
              >
                <option value="">Padrão do sistema</option>
                {devices.mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microfone'}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Câmera</span>
              <select
                value={room.camDeviceId ?? ''}
                onChange={(e) => void room.setCamDevice(e.target.value)}
              >
                <option value="">Padrão do sistema</option>
                {devices.cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Câmera'}
                  </option>
                ))}
              </select>
            </label>

            {!devices.mics.some((d) => d.label) && (
              <p className="hint">
                Entre no canal de voz uma vez para o navegador revelar os nomes dos
                dispositivos.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
