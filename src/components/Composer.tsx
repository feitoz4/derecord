import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Room } from '../lib/room'
import { EVERYONE } from '../lib/mentions'
import { uploadImage, imageFrom, isImage, type Attachment } from '../lib/upload'
import { Avatar } from './Media'
import { Send, Attach, Close, Reply } from './Icons'

const MAX_ROWS = 10

/**
 * Acha a menção que está sendo digitada na posição do cursor.
 *
 * O nome pode ter espaço, então a busca não para no primeiro branco — ela vai
 * até o `@`, desde que ele comece um token e o trecho seja curto.
 */
function mentionQuery(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null

  const prev = at > 0 ? before[at - 1] : ' '
  if (!/\s/.test(prev)) return null // "email@dominio" não abre menção

  const query = before.slice(at + 1)
  if (query.length > 24 || query.includes('\n')) return null
  return { at, query }
}

export function Composer({
  room,
  dropRef,
}: {
  room: Room
  /** Área onde soltar uma imagem também funciona (o log do chat). */
  dropRef?: React.RefObject<HTMLElement | null>
}) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<Attachment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [picker, setPicker] = useState<{ at: number; matches: string[] } | null>(null)
  const [active, setActive] = useState(0)

  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // -------- crescer com o conteúdo -----------------------------------------

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = parseFloat(getComputedStyle(el).lineHeight) * MAX_ROWS
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [text])

  // Ao escolher responder, o foco vai pro campo — como no Discord.
  useEffect(() => {
    if (room.replyTo) areaRef.current?.focus()
  }, [room.replyTo])

  // -------- anexos ----------------------------------------------------------

  const attach = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      setImage(await uploadImage(file))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const file = imageFrom(e.clipboardData)
    if (!file) return
    e.preventDefault()
    void attach(file)
  }

  // Soltar a imagem em qualquer lugar do chat, não só no campo.
  useEffect(() => {
    const zone = dropRef?.current
    if (!zone) return

    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget && zone.contains(e.relatedTarget as Node)) return
      setDragging(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = imageFrom(e.dataTransfer)
      if (file) void attach(file)
      else if (e.dataTransfer?.files.length) setError('Só imagem (png, jpg, gif, webp).')
    }

    zone.addEventListener('dragover', over)
    zone.addEventListener('dragleave', leave)
    zone.addEventListener('drop', drop)
    return () => {
      zone.removeEventListener('dragover', over)
      zone.removeEventListener('dragleave', leave)
      zone.removeEventListener('drop', drop)
    }
  }, [dropRef])

  // -------- menções ---------------------------------------------------------

  const refreshPicker = (value: string, caret: number) => {
    const found = mentionQuery(value, caret)
    if (!found) return setPicker(null)

    const q = found.query.toLowerCase()
    const matches = [...room.knownNames, EVERYONE]
      .filter((n) => n !== room.name || q.length > 0)
      .filter((n) => n.toLowerCase().startsWith(q))
      .slice(0, 8)

    setPicker(matches.length ? { at: found.at, matches } : null)
    setActive(0)
  }

  const pick = (name: string) => {
    if (!picker) return
    const el = areaRef.current!
    const next = `${text.slice(0, picker.at)}@${name} ${text.slice(el.selectionStart)}`
    setText(next)
    setPicker(null)
    requestAnimationFrame(() => {
      const pos = picker.at + name.length + 2
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  // -------- envio -----------------------------------------------------------

  const submit = () => {
    if (busy) return
    if (!text.trim() && !image) return
    room.sendChat(text, image)
    setText('')
    setImage(null)
    setPicker(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (picker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setActive((a) => (a + 1) % picker.matches.length)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setActive((a) => (a - 1 + picker.matches.length) % picker.matches.length)
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return pick(picker.matches[active])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setPicker(null)
      }
    }

    if (e.key === 'Escape' && room.replyTo) {
      e.preventDefault()
      return room.setReplyTo(null)
    }

    // Enter envia, Shift+Enter quebra linha.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className={`composer ${dragging ? 'is-dragging' : ''}`}>
      {room.replyTo && (
        <div className="replybar">
          <Reply size={14} />
          <span className="replybar__label">
            respondendo a <strong>{room.replyTo.name}</strong>
          </span>
          <span className="replybar__text">
            {room.replyTo.text || (room.replyTo.image ? 'imagem' : '')}
          </span>
          <button
            className="icon-btn icon-btn--sm"
            onClick={() => room.setReplyTo(null)}
            title="Cancelar (Esc)"
          >
            <Close />
          </button>
        </div>
      )}

      {(image || busy) && (
        <div className="attachbar">
          {busy ? (
            <span className="attachbar__busy">enviando imagem…</span>
          ) : (
            <>
              <img src={image!.url} alt="" className="attachbar__thumb" />
              <span className="attachbar__name">{image!.name}</span>
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => setImage(null)}
                title="Remover"
              >
                <Close />
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="attachbar attachbar--error">
          <span>{error}</span>
          <button className="icon-btn icon-btn--sm" onClick={() => setError(null)}>
            <Close />
          </button>
        </div>
      )}

      <div className="composer__row">
        {picker && (
          <div className="picker">
            <p className="picker__head">Membros</p>
            {picker.matches.map((name, i) => (
              <button
                key={name}
                className={`picker__item ${i === active ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(name)
                }}
              >
                {name === EVERYONE ? (
                  <span className="picker__all">@</span>
                ) : (
                  <Avatar name={name} size={22} />
                )}
                <span>{name}</span>
                {name === EVERYONE && <em>notifica todo mundo</em>}
              </button>
            ))}
          </div>
        )}

        <button
          className="icon-btn"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Anexar imagem"
        >
          <Attach />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f && isImage(f)) void attach(f)
            e.target.value = ''
          }}
        />

        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={room.replyTo ? `Responder a ${room.replyTo.name}` : 'Conversar em #chat'}
          maxLength={2000}
          onChange={(e) => {
            setText(e.target.value)
            refreshPicker(e.target.value, e.target.selectionStart)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setPicker(null)}
        />

        <button
          className="icon-btn"
          onClick={submit}
          disabled={busy || (!text.trim() && !image)}
          title="Enviar"
        >
          <Send />
        </button>
      </div>
    </div>
  )
}
