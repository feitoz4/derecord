import { useState } from 'react'
import type { Room, Participant } from '../lib/room'
import { MAX_GAIN } from '../lib/audio'
import { Avatar } from './Media'
import { VoiceControls } from './Controls'
import {
  Hash,
  VoiceChannel,
  Disconnect,
  MicOff,
  Screen,
  CamOn,
  Speaker,
  SpeakerOff,
} from './Icons'

export type View = 'chat' | 'voice'

// ---------- alguém no canal de voz ------------------------------------------

function VoiceMember({
  room,
  p,
  me,
}: {
  room: Room
  p?: Participant
  me?: { name: string; speaking: boolean; state: { mic: boolean; cam: boolean; screen: boolean } }
}) {
  const [open, setOpen] = useState(false)

  const name = p?.name ?? me!.name
  const speaking = p ? !!p.audio?.speaking : me!.speaking
  const state = p?.state ?? me!.state
  const pct = p ? Math.round(p.volume * 100) : 100
  const boosted = !!p && p.volume > 1

  return (
    <li className={`vmember ${speaking ? 'is-speaking' : ''}`}>
      <button
        className="vmember__row"
        onClick={() => p && setOpen((o) => !o)}
        title={p ? 'Ajustar volume' : undefined}
      >
        <span className={`vmember__ring ${speaking ? 'is-on' : ''}`}>
          <Avatar name={name} size={22} />
        </span>
        <span className="vmember__name">{name}</span>
        <span className="vmember__tags">
          {state.screen && <Screen size={12} />}
          {state.cam && <CamOn size={12} />}
          {!state.mic && <MicOff size={12} />}
          {p?.localMuted && <SpeakerOff size={12} />}
          {boosted && <em className="vmember__pct">{pct}%</em>}
        </span>
      </button>

      {open && p && (
        <div className="vmember__volume">
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
          <span className={`vmember__pct ${boosted ? 'is-boost' : ''}`}>{pct}%</span>
        </div>
      )}
    </li>
  )
}

// ---------- barra lateral ----------------------------------------------------

export function Sidebar({
  room,
  view,
  setView,
}: {
  room: Room
  view: View
  setView: (v: View) => void
}) {
  const [copied, setCopied] = useState(false)
  const voice = room.voicePeers.sort((a, b) => a.name.localeCompare(b.name))
  const total = voice.length + (room.inVoice ? 1 : 0)

  const openVoice = () => {
    setView('voice')
    if (!room.inVoice) void room.joinVoice()
  }

  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <button
          className="sidebar__room"
          onClick={() => {
            void navigator.clipboard.writeText(location.href).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            })
          }}
          title="Copiar o link da sala"
        >
          {copied ? 'link copiado' : room.roomId}
        </button>
        <span className={`dot dot--${room.status}`} title={room.status} />
      </header>

      <nav className="sidebar__nav">
        <p className="chan-group">Canais de texto</p>
        <button
          className={`chan ${view === 'chat' ? 'is-active' : ''}`}
          onClick={() => {
            setView('chat')
            room.clearUnread()
          }}
        >
          <Hash size={17} />
          <span>chat</span>
          {room.unread > 0 && view !== 'chat' && (
            <em className={`chan__badge ${room.unreadMentions > 0 ? 'is-mention' : ''}`}>
              {room.unreadMentions > 0 ? `@${room.unreadMentions}` : room.unread}
            </em>
          )}
        </button>

        <p className="chan-group">Canais de voz</p>
        <button
          className={`chan ${view === 'voice' ? 'is-active' : ''}`}
          onClick={openVoice}
        >
          <VoiceChannel size={17} />
          <span>voz</span>
          {total > 0 && <em className="chan__count">{total}</em>}
        </button>

        {(total > 0 || room.joiningVoice) && (
          <ul className="vmembers">
            {room.inVoice && (
              <VoiceMember
                room={room}
                me={{
                  name: room.name,
                  speaking: room.speaking,
                  state: { mic: room.micOn, cam: room.camOn, screen: room.screenOn },
                }}
              />
            )}
            {voice.map((p) => (
              <VoiceMember key={p.id} room={room} p={p} />
            ))}
            {room.joiningVoice && <li className="vmembers__hint">entrando…</li>}
          </ul>
        )}

        {total === 0 && !room.joiningVoice && (
          <p className="chan-empty">Ninguém na voz. Clique pra entrar.</p>
        )}
      </nav>

      <footer className="userbar">
        {room.inVoice && (
          <div className="voicelink">
            <span className="voicelink__state">
              <i />
              Voz conectada
            </span>
            <button
              className="icon-btn icon-btn--sm is-danger"
              onClick={() => room.leaveVoice()}
              title="Sair do canal de voz"
            >
              <Disconnect size={16} />
            </button>
          </div>
        )}

        <div className="userbar__me">
          <Avatar name={room.name} size={28} />
          <span className="userbar__name">{room.name}</span>
        </div>

        <VoiceControls room={room} />
      </footer>
    </aside>
  )
}
