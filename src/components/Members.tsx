import { useState } from 'react'
import type { Room, Participant, Member } from '../lib/room'
import { MAX_GAIN } from '../lib/audio'
import { Avatar } from './Media'
import { MicOff, Screen, Speaker, SpeakerOff, Chevron } from './Icons'

const quandoFoiVisto = (ts: number) => {
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

/** Alguém presente: dá para ajustar volume e ver o que está ligado. */
function LinhaOnline({
  room,
  p,
  isMe,
  name,
  speaking,
}: {
  room: Room
  p?: Participant
  isMe?: boolean
  name: string
  speaking?: boolean
}) {
  const [open, setOpen] = useState(false)
  const pct = p ? Math.round(p.volume * 100) : 100
  const boosted = !!p && p.volume > 1
  const state = p?.state

  return (
    <li className="member">
      <button
        className="member__row"
        onClick={() => p && setOpen((o) => !o)}
        title={p ? 'Ajustar volume' : undefined}
      >
        <span className={`member__avatar ${speaking ? 'is-speaking' : ''}`}>
          <Avatar name={name} size={32} />
          <i className="member__presence" />
        </span>

        <span className="member__name">
          {name}
          {isMe && <span className="tile__you">você</span>}
        </span>

        <span className="member__tags">
          {state?.screen && <Screen size={13} />}
          {state && !state.mic && <MicOff size={13} />}
          {p?.localMuted && <SpeakerOff size={13} />}
          {boosted && <em className="member__pct is-boost">{pct}%</em>}
          {p && <Chevron size={13} />}
        </span>
      </button>

      {open && p && (
        <div className="member__volume">
          <button
            className={`icon-btn icon-btn--sm ${p.localMuted ? 'is-danger' : ''}`}
            onClick={() => room.setLocalMuted(p.id, !p.localMuted)}
            title={p.localMuted ? 'Ouvir de novo' : 'Silenciar só pra você'}
          >
            {p.localMuted ? <SpeakerOff size={14} /> : <Speaker size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={MAX_GAIN * 100}
            step={5}
            value={pct}
            disabled={p.localMuted}
            onChange={(e) => room.setVolume(p.id, Number(e.target.value) / 100)}
            onDoubleClick={() => room.setVolume(p.id, 1)}
            className={boosted ? 'range range--boost' : 'range'}
            title="Volume desta pessoa (dois cliques volta pra 100%)"
          />
          <span className={`member__pct ${boosted ? 'is-boost' : ''}`}>{pct}%</span>
        </div>
      )}
    </li>
  )
}

/** Quem já entrou nesta sala alguma vez, mas não está aqui agora. */
function LinhaOffline({ m }: { m: Member }) {
  return (
    <li className="member member--offline">
      <div className="member__row" title={`Visto ${quandoFoiVisto(m.lastSeen)}`}>
        <span className="member__avatar">
          <Avatar name={m.name} size={32} />
        </span>
        <span className="member__name">{m.name}</span>
        <span className="member__seen">{quandoFoiVisto(m.lastSeen)}</span>
      </div>
    </li>
  )
}

export function Members({ room }: { room: Room }) {
  const { naVoz, online, offline } = room.roster

  const totalVoz = naVoz.length + (room.inVoice ? 1 : 0)
  const totalOnline = online.length + (room.inVoice ? 0 : 1)

  return (
    <aside className="members">
      {totalVoz > 0 && (
        <>
          <p className="members__group">Na voz — {totalVoz}</p>
          <ul className="members__list">
            {room.inVoice && (
              <LinhaOnline room={room} isMe name={room.name} speaking={room.speaking} />
            )}
            {naVoz.map((p) => (
              <LinhaOnline
                key={p.id}
                room={room}
                p={p}
                name={p.name}
                speaking={!!p.audio?.speaking}
              />
            ))}
          </ul>
        </>
      )}

      <p className="members__group">Online — {totalOnline}</p>
      <ul className="members__list">
        {!room.inVoice && <LinhaOnline room={room} isMe name={room.name} />}
        {online.map((p) => (
          <LinhaOnline key={p.id} room={room} p={p} name={p.name} />
        ))}
      </ul>

      {offline.length > 0 && (
        <>
          <p className="members__group">Offline — {offline.length}</p>
          <ul className="members__list">
            {offline.map((m) => (
              <LinhaOffline key={m.id} m={m} />
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
