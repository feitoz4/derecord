import { useState } from 'react'
import type { Room } from '../lib/room'
import { isSecure } from '../lib/media'
import { configured } from '../lib/supabase'

const NAME_KEY = 'nearbycord:name'

export function Join({ room }: { room: Room }) {
  const params = new URLSearchParams(location.search)
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) || '')
  const [sala, setSala] = useState(params.get('sala') || 'geral')

  const secure = isSecure()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    localStorage.setItem(NAME_KEY, n)
    const url = new URL(location.href)
    url.searchParams.set('sala', sala)
    history.replaceState(null, '', url)
    room.connect(n, sala.trim() || 'geral')
  }

  return (
    <div className="join">
      <form className="join__card" onSubmit={submit}>
        <h1 className="join__logo">nearbycord</h1>
        <p className="join__sub">Chamada de voz, vídeo e tela para o grupo.</p>

        <label className="field">
          <span>Seu nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como o pessoal te chama"
            maxLength={32}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Sala</span>
          <input
            value={sala}
            onChange={(e) => setSala(e.target.value)}
            placeholder="geral"
            maxLength={60}
          />
        </label>

        <button
          type="submit"
          className="btn"
          disabled={!name.trim() || !secure || !configured}
        >
          Entrar
        </button>

        {!configured && (
          <p className="warn">
            Faltam as variáveis do Supabase. Copie <code>.env.example</code> para{' '}
            <code>.env</code>, preencha com os dados do seu projeto e reinicie o{' '}
            <code>npm run dev</code>.
          </p>
        )}

        {!secure && (
          <p className="warn">
            Câmera e microfone só funcionam em <strong>localhost</strong> ou{' '}
            <strong>HTTPS</strong>. Neste endereço o navegador vai bloquear o acesso.
          </p>
        )}

        <p className="join__hint">
          Você entra sem microfone e sem câmera ligados. Ligue quando quiser, pelos
          botões de baixo.
        </p>
      </form>
    </div>
  )
}
