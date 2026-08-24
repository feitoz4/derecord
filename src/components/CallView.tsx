import { useCallback, useEffect, useRef, useState } from 'react'
import type { Room } from '../lib/room'
import { Tile, type TileData } from './Tile'
import { Media, Avatar } from './Media'
import { VoiceChannel, Expand, Collapse, Screen, CamOn } from './Icons'

/** Tela cheia de verdade (a do sistema), presa a um elemento. */
function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void ref.current?.requestFullscreen().catch(() => {})
  }, [ref])

  return { active, toggle }
}

export function CallView({ room }: { room: Room }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(stageRef)

  // Esc já sai da tela cheia; aqui ele também desfaz o palco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement && room.pinned) room.pin(null)
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        const el = e.target as HTMLElement
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
        if (room.stageId) toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room, room.pinned, toggleFullscreen])

  if (!room.inVoice) {
    return (
      <div className="view view--center">
        <div className="voidstate">
          <VoiceChannel size={44} />
          <h3>Canal de voz</h3>
          <p>
            {room.voicePeers.length > 0
              ? `${room.voicePeers.map((p) => p.name).join(', ')} ${
                  room.voicePeers.length > 1 ? 'estão' : 'está'
                } na chamada.`
              : 'Ninguém aqui ainda.'}
          </p>
          <button
            className="btn"
            onClick={() => void room.joinVoice()}
            disabled={room.joiningVoice}
          >
            {room.joiningVoice ? 'Entrando…' : 'Entrar na chamada'}
          </button>
        </div>
      </div>
    )
  }

  const tiles: TileData[] = [
    {
      id: room.meId,
      name: room.name,
      isMe: true,
      camOn: room.camOn,
      micOn: room.micOn,
      screenOn: room.screenOn,
      speaking: room.speaking,
      camStream: room.camStream,
      screenStream: room.screenStream,
    },
    ...room.voicePeers.map<TileData>((p) => ({
      id: p.id,
      name: p.name,
      isMe: false,
      camOn: p.state.cam,
      micOn: p.state.mic,
      screenOn: p.state.screen,
      speaking: !!p.audio?.speaking,
      camStream: p.conn?.camStream ?? null,
      screenStream: p.conn?.screenStream ?? null,
      localMuted: p.localMuted,
      connecting: p.conn?.connectionState !== 'connected',
    })),
  ]

  const stageId = room.stageId
  const stageTile = tiles.find((t) => t.id === stageId) ?? null
  const stagePeer = stageId && stageId !== room.meId ? room.peers.get(stageId) : null

  // No palco, tela compartilhada tem prioridade sobre a câmera da mesma pessoa.
  const stageShowsScreen = !!stageTile?.screenOn && !!stageTile.screenStream
  // O camStream remoto existe mesmo com a câmera desligada — fica vazio. Sem
  // checar camOn, o palco mostraria um vídeo preto no lugar do avatar.
  const stageStream = stageTile
    ? stageShowsScreen
      ? stageTile.screenStream!
      : stageTile.camOn
        ? stageTile.camStream
        : null
    : null

  return (
    <div className="view">
      <div className={`call ${stageTile ? 'call--stage' : ''}`}>
        {stageTile && (
          <section className={`stage ${fullscreen ? 'is-fullscreen' : ''}`} ref={stageRef}>
            {stageStream ? (
              <Media
                stream={stageStream}
                contain={stageShowsScreen}
                muted={stageTile.isMe || stagePeer?.localMuted}
                volume={stagePeer?.volume ?? 1}
                mirror={stageTile.isMe && !stageShowsScreen}
              />
            ) : (
              <div className="stage__placeholder">
                <Avatar name={stageTile.name} size={120} />
                <p>{stageTile.isMe ? 'Sua câmera está desligada' : 'Câmera desligada'}</p>
              </div>
            )}

            <div className="stage__bar">
              <span className="stage__label">
                {stageShowsScreen ? <Screen size={13} /> : <CamOn size={13} />}
                {stageShowsScreen
                  ? stageTile.isMe
                    ? 'Sua tela'
                    : `Tela de ${stageTile.name}`
                  : stageTile.isMe
                    ? 'Você'
                    : stageTile.name}
              </span>

              <span className="stage__actions">
                {room.pinned && (
                  <button className="ghost ghost--sm" onClick={() => room.pin(null)}>
                    recolher
                  </button>
                )}
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={toggleFullscreen}
                  title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F)'}
                >
                  {fullscreen ? <Collapse /> : <Expand />}
                </button>
              </span>
            </div>
          </section>
        )}

        <section className="grid">
          {tiles.map((t) => (
            <Tile
              key={t.id}
              data={t}
              expanded={stageId === t.id}
              onExpand={() => room.pin(t.id)}
            />
          ))}
        </section>
      </div>
    </div>
  )
}
