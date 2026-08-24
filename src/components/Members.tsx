import { useState } from 'react'
import type { Room, Participant } from '../lib/room'
import { MAX_GAIN } from '../lib/audio'
import { Avatar } from './Media'
import { MicOff, Screen, Speaker, SpeakerOff, Chevron } from './Icons'

function MemberRow({
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

export function Members({ room }: { room: Room }) {
  const all = [...room.peers.values()]
  const inVoice = all.filter((p) => p.voice).sort((a, b) => a.name.localeCompare(b.name))
  const online = all.filter((p) => !p.voice).sort((a, b) => a.name.localeCompare(b.name))

  const voiceCount = inVoice.length + (room.inVoice ? 1 : 0)
  const onlineCount = online.length + (room.inVoice ? 0 : 1)

  return (
    <aside className="members">
      {voiceCount > 0 && (
        <>
          <p className="members__group">Na voz — {voiceCount}</p>
          <ul className="members__list">
            {room.inVoice && (
              <MemberRow room={room} isMe name={room.name} speaking={room.speaking} />
            )}
            {inVoice.map((p) => (
              <MemberRow
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

      <p className="members__group">Online — {onlineCount}</p>
      <ul className="members__list">
        {!room.inVoice && <MemberRow room={room} isMe name={room.name} />}
        {online.map((p) => (
          <MemberRow key={p.id} room={room} p={p} name={p.name} />
        ))}
      </ul>
    </aside>
  )
}
