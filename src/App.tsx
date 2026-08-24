import { useEffect, useReducer, useState } from 'react'
import type { Room } from './lib/room'
import { Join } from './components/Join'
import { Sidebar, type View } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { CallView } from './components/CallView'
import { Members } from './components/Members'
import { Hash, VoiceChannel, People } from './components/Icons'

export default function App({ room }: { room: Room }) {
  // A Room é um objeto mutável; o React só precisa saber que algo mudou.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => room.subscribe(bump), [room])

  const [view, setView] = useState<View>('chat')
  const [showMembers, setShowMembers] = useState(true)

  if (room.status === 'idle') return <Join room={room} />

  const inCall = room.voicePeers.length + (room.inVoice ? 1 : 0)

  return (
    <div className="app">
      <Sidebar room={room} view={view} setView={setView} />

      <div className="content">
        <header className="view__head">
          {view === 'chat' ? <Hash size={18} /> : <VoiceChannel size={18} />}
          <h2>{view === 'chat' ? 'chat' : 'voz'}</h2>
          <span className="view__sub">
            {view === 'chat'
              ? 'as últimas 200 mensagens ficam no servidor'
              : inCall === 0
                ? 'ninguém na chamada'
                : `${inCall} ${inCall === 1 ? 'pessoa' : 'pessoas'} na chamada`}
          </span>

          <button
            className={`icon-btn ${showMembers ? 'is-on' : ''}`}
            onClick={() => setShowMembers((s) => !s)}
            title="Lista de membros"
          >
            <People />
          </button>
        </header>

        {room.error && (
          <div className="banner">
            <span>{room.error}</span>
            <button
              className="ghost"
              onClick={() => {
                room.error = null
                bump()
              }}
            >
              ok
            </button>
          </div>
        )}

        <div className="content__row">
          {view === 'chat' ? <ChatView room={room} /> : <CallView room={room} />}
          {showMembers && <Members room={room} />}
        </div>
      </div>
    </div>
  )
}
