import { useEffect, useRef } from 'react'

type Props = {
  stream: MediaStream | null
  /** Preview local e vídeo de câmera são mudos: o áudio sai pelo RemoteAudio. */
  muted?: boolean
  volume?: number
  mirror?: boolean
  contain?: boolean
  className?: string
}

export function Media({ stream, muted, volume = 1, mirror, contain, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) {
      el.srcObject = stream
      if (stream) void el.play().catch(() => {})
    }
  }, [stream])

  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, volume)
  }, [volume])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={[
        'media',
        contain ? 'media--contain' : '',
        mirror ? 'media--mirror' : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

const COLORS = ['#6d7cff', '#e8615a', '#f0a23c', '#3fbf7f', '#c76ae0', '#3aa8d4', '#dd6ba0']

export function Avatar({ name, size = 76 }: { name: string; size?: number }) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const color = COLORS[hash % COLORS.length]
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase()

  return (
    <div
      className="avatar"
      style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </div>
  )
}
