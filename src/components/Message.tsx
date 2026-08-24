import { useEffect, useState } from 'react'
import type { Room, ChatMsg } from '../lib/room'
import { splitMentions, mentionsMe, EVERYONE } from '../lib/mentions'
import { Avatar } from './Media'
import { Reply, Close } from './Icons'

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Texto com as menções destacadas; a minha fica em amarelo. */
function Text({ text, names, me }: { text: string; names: string[]; me: string }) {
  if (!text) return null
  return (
    <>
      {splitMentions(text, names).map((part, i) =>
        part.mention ? (
          <span
            key={i}
            className={`mention ${
              part.mention === EVERYONE || part.mention.toLowerCase() === me.toLowerCase()
                ? 'is-me'
                : ''
            }`}
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox__close" onClick={onClose} title="Fechar (Esc)">
        <Close size={20} />
      </button>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

export function Message({
  room,
  msg,
  grouped,
  names,
  onJumpTo,
}: {
  room: Room
  msg: ChatMsg
  grouped: boolean
  names: string[]
  onJumpTo: (id: string) => void
}) {
  const [zoom, setZoom] = useState(false)
  const highlight = mentionsMe(msg.mentions, room.name)

  // Reserva a altura certa antes da imagem carregar: sem isso o chat "pula".
  const ratio = msg.image ? Math.min(350, (msg.image.h / msg.image.w) * 400) : 0

  return (
    <div
      id={`msg-${msg.id}`}
      className={`cmsg ${grouped ? 'cmsg--grouped' : ''} ${highlight ? 'cmsg--mention' : ''}`}
    >
      {msg.replyTo && (
        <button
          className="replyline"
          onClick={() => onJumpTo(msg.replyTo!.id)}
          title="Ir para a mensagem"
        >
          <span className="replyline__curve" />
          <Avatar name={msg.replyTo.name} size={16} />
          <span className="replyline__name">{msg.replyTo.name}</span>
          <span className="replyline__text">
            {msg.replyTo.text || (msg.replyTo.image ? 'imagem' : '')}
          </span>
        </button>
      )}

      <div className="cmsg__main">
        <div className="cmsg__gutter">
          {grouped && !msg.replyTo ? (
            <span className="cmsg__hovertime">{hhmm(msg.ts)}</span>
          ) : (
            <Avatar name={msg.name} size={38} />
          )}
        </div>

        <div className="cmsg__body">
          {(!grouped || msg.replyTo) && (
            <div className="cmsg__head">
              <span className={`cmsg__author ${msg.from === room.meId ? 'is-me' : ''}`}>
                {msg.name}
              </span>
              <span className="cmsg__time">{hhmm(msg.ts)}</span>
            </div>
          )}

          {msg.text && (
            <div className="cmsg__text">
              <Text text={msg.text} names={names} me={room.name} />
            </div>
          )}

          {msg.image && (
            <button
              className="cmsg__image"
              style={{ aspectRatio: `${msg.image.w} / ${msg.image.h}`, maxHeight: ratio }}
              onClick={() => setZoom(true)}
            >
              <img src={msg.image.url} alt="" loading="lazy" />
            </button>
          )}
        </div>

        <div className="cmsg__actions">
          <button
            className="icon-btn icon-btn--sm"
            onClick={() => room.setReplyTo(msg)}
            title="Responder"
          >
            <Reply />
          </button>
        </div>
      </div>

      {zoom && msg.image && <Lightbox src={msg.image.url} onClose={() => setZoom(false)} />}
    </div>
  )
}
