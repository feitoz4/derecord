/**
 * Menções por nome.
 *
 * Não há contas neste app, então o nome é a identidade — e nome pode ter
 * espaço. Por isso não dá pra usar `@\w+`: a menção é casada contra a lista
 * de nomes conhecidos, do mais longo pro mais curto, para que "@Ana Paula"
 * ganhe de "@Ana" quando as duas existirem.
 */

export const EVERYONE = 'todos'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function pattern(names: string[]): RegExp | null {
  const all = [...new Set([...names, EVERYONE])].filter(Boolean)
  if (all.length === 0) return null
  const alts = all.sort((a, b) => b.length - a.length).map(escape).join('|')
  // O lookahead evita casar "@Ana" dentro de "@Anabela" quando só "Ana" é conhecida.
  return new RegExp(`@(${alts})(?![\\p{L}\\p{N}_])`, 'giu')
}

export type Part = { mention: string | null; text: string }

/** Quebra o texto em pedaços para a renderização destacar as menções. */
export function splitMentions(text: string, names: string[]): Part[] {
  const re = pattern(names)
  if (!re) return [{ mention: null, text }]

  const parts: Part[] = []
  let last = 0

  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ mention: null, text: text.slice(last, at) })
    parts.push({ mention: m[1], text: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ mention: null, text: text.slice(last) })
  return parts
}

/** Nomes citados, na grafia da lista conhecida (não na que a pessoa digitou). */
export function findMentions(text: string, names: string[]): string[] {
  const re = pattern(names)
  if (!re) return []
  const canon = new Map([...names, EVERYONE].map((n) => [n.toLowerCase(), n]))
  const out = new Set<string>()
  for (const m of text.matchAll(re)) {
    const name = canon.get(m[1].toLowerCase())
    if (name) out.add(name)
  }
  return [...out]
}

export const mentionsMe = (mentions: string[] | undefined, me: string) =>
  !!mentions?.some((m) => m === EVERYONE || m.toLowerCase() === me.toLowerCase())
