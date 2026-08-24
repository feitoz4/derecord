import { Media, Avatar } from './Media'
import { MicOff, Screen, Expand, SpeakerOff } from './Icons'

export type TileData = {
  id: string
  name: string
  isMe: boolean
  camOn: boolean
  micOn: boolean
  screenOn: boolean
  speaking: boolean
  camStream: MediaStream | null
  screenStream?: MediaStream | null
  localMuted?: boolean
  connecting?: boolean
}

export function Tile({
  data,
  onExpand,
  expanded,
}: {
  data: TileData
  /** Clique em qualquer lugar do tile joga a pessoa pro palco. */
  onExpand?: () => void
  expanded?: boolean
}) {
  // Quem está compartilhando aparece com a tela no tile, não com a câmera.
  const showScreen = data.screenOn && !!data.screenStream
  const stream = showScreen ? data.screenStream! : data.camStream
  const hasVideo = showScreen || (data.camOn && !!data.camStream)

  return (
    <div
      className={`tile ${data.speaking ? 'tile--speaking' : ''} ${expanded ? 'tile--expanded' : ''}`}
      onClick={onExpand}
      role={onExpand ? 'button' : undefined}
      title={onExpand ? (expanded ? 'Já está no palco' : `Expandir ${data.name}`) : undefined}
    >
      {hasVideo ? (
        <Media
          stream={stream}
          muted
          contain={showScreen}
          mirror={data.isMe && !showScreen}
        />
      ) : (
        <div className="tile__placeholder">
          <Avatar name={data.name} />
        </div>
      )}

      {data.connecting && <div className="tile__connecting">conectando…</div>}

      <div className="tile__bar">
        <span className="tile__name">
          {data.name}
          {data.isMe && <span className="tile__you">você</span>}
        </span>
        <span className="tile__badges">
          {data.localMuted && (
            <span className="badge badge--dim" title="silenciado só pra você">
              <SpeakerOff size={13} />
            </span>
          )}
          {data.screenOn && (
            <span className="badge badge--live" title="compartilhando tela">
              <Screen size={13} />
            </span>
          )}
          {!data.micOn && (
            <span className="badge badge--muted" title="microfone desligado">
              <MicOff size={13} />
            </span>
          )}
        </span>
      </div>

      {onExpand && !expanded && (
        <span className="tile__expand" title="Expandir">
          <Expand size={15} />
        </span>
      )}
    </div>
  )
}
