import { useEffect, useRef } from 'react'
import type { Room } from '../lib/room'
import { Message } from './Message'
import { Composer } from './Composer'
import { Hash } from './Icons'

const dayLabel = (ts: number) => {
  const d = new Date(ts)
  const today = new Date()
  const yst = new Date(today.getTime() - 86400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Hoje'
  if (same(d, yst)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

export function ChatView({ room }: { room: Room }) {
  const logRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
    room.clearUnread()
  }, [room.chat.length, room])

  // Clicar na citação leva até a mensagem original e a pisca.
  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-flash')
    setTimeout(() => el.classList.remove('is-flash'), 1200)
  }

  const names = room.knownNames

  return (
    <div className="view">
      <div className="chatlog" ref={logRef}>
        {room.chat.length === 0 && (
          <div className="chatlog__empty">
            <Hash size={40} />
            <h3>Começo do #chat</h3>
            <p>Nada por aqui ainda. Manda a primeira.</p>
          </div>
        )}

        {room.chat.map((m, i) => {
          const prev = room.chat[i - 1]
          const newDay =
            !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
          // Uma resposta nunca agrupa: ela precisa mostrar de quem é.
          const grouped =
            !newDay &&
            !m.replyTo &&
            !!prev &&
            prev.from === m.from &&
            m.ts - prev.ts < 5 * 60_000

          return (
            <div key={m.id ?? `${m.ts}-${i}`}>
              {newDay && (
                <div className="daysep">
                  <span>{dayLabel(m.ts)}</span>
                </div>
              )}
              <Message
                room={room}
                msg={m}
                grouped={grouped}
                names={names}
                onJumpTo={jumpTo}
              />
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <Composer room={room} dropRef={logRef} />
    </div>
  )
}
