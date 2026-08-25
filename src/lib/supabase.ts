import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Sem as variáveis o app não sobe — melhor falhar claro do que falhar torto. */
export const configured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'anon', {
  auth: { persistSession: false },
  realtime: {
    // Sinalização é rajada curta: 20 mensagens por segundo dá folga de sobra
    // para uma chamada de 6 pessoas se apresentando ao mesmo tempo.
    params: { eventsPerSecond: 20 },
  },
})

export type MessageRow = {
  id: string
  room: string
  author_id: string
  name: string
  text: string
  image: { url: string; w: number; h: number } | null
  reply_to: { id: string; name: string; text: string; image?: boolean } | null
  mentions: string[]
  created_at: string
}
