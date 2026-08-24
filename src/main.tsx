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

// Em dev, dá pra inspecionar o mesh pelo console: room.peers, pc.connectionState…
if (import.meta.env.DEV) (window as unknown as { room: Room }).room = room
