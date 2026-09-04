import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Room } from './lib/room'
import './styles.css'

// Instância única fora do React: o mesh não pode ser remontado a cada render.
const room = new Room()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App room={room} />
  </StrictMode>,
)

window.addEventListener('beforeunload', () => room.disconnect())

// Exposto também em produção: é a única forma de diagnosticar a chamada de
// quem está do outro lado, e não abre nada que a própria página já não faça.
;(window as unknown as { room: Room }).room = room

/** Cola o resultado no chat quando algo estiver estranho: room.diagnostico() */
;(window as unknown as { diagnostico: () => string }).diagnostico = () =>
  JSON.stringify(
    {
      eu: { nome: room.name, id: room.meId.slice(0, 8), naVoz: room.inVoice, mic: room.micOn },
      sala: room.roomId,
      status: room.status,
      canal: (room as unknown as { channel?: { state?: string } }).channel?.state,
      pessoas: [...room.peers.values()].map((p) => ({
        nome: p.name,
        naVoz: p.voice,
        conexao: p.conn?.connectionState ?? 'sem conexão',
        ouvindo: !!p.audio,
      })),
    },
    null,
    1,
  )
