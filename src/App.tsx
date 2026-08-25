import { useEffect, useReducer, useRef, useState } from 'react'
import { nomeSalvo, type Room } from './lib/room'
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

  // Quem já disse o nome uma vez não precisa dizer de novo: entra direto.
  const entrou = useRef(false)
  useEffect(() => {
    if (entrou.current || room.status !== 'idle') return
    const nome = nomeSalvo()
    if (!nome) return
    entrou.current = true
    const sala = new URLSearchParams(location.search).get('sala') || 'geral'
    void room.connect(nome, sala)
  }, [room, room.status])

  if (room.status === 'idle') {
    // Só cai aqui na primeira vez, ou se o nome salvo tiver sido apagado.
    return nomeSalvo() ? <div className="join" /> : <Join room={room} />
  }

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
