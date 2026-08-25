import { supabase } from './supabase'

export type Attachment = { url: string; w: number; h: number; name: string }

export const MAX_UPLOAD = 8 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Acima disso a foto é reduzida antes de subir — foto de celular é enorme. */
const MAX_SIDE = 1920
const JPEG_QUALITY = 0.85

export const isImage = (f: File) => ACCEPTED.includes(f.type)

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não consegui ler a imagem.'))
    }
    img.src = url
  })
}

/**
 * Reduz a imagem quando ela é maior que o necessário.
 *
 * GIF passa direto: jogar num canvas mataria a animação, sobraria o 1º quadro.
 */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number; type: string }> {
  const img = await loadBitmap(file)
  const { naturalWidth: w, naturalHeight: h } = img

  if (file.type === 'image/gif' || Math.max(w, h) <= MAX_SIDE) {
    return { blob: file, w, h, type: file.type }
  }

  const scale = MAX_SIDE / Math.max(w, h)
  const nw = Math.round(w * scale)
  const nh = Math.round(h * scale)

  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, w, h, type: file.type }
  ctx.drawImage(img, 0, 0, nw, nh)

  // PNG vira JPEG: economiza muito e a diferença não aparece numa foto.
  const type = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, JPEG_QUALITY))
  return blob ? { blob, w: nw, h: nh, type } : { blob: file, w, h, type: file.type }
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export async function uploadImage(file: File): Promise<Attachment> {
  if (!isImage(file)) throw new Error('Só imagem (png, jpg, gif, webp).')

  const { blob, w, h, type } = await shrink(file)
  if (blob.size > MAX_UPLOAD) throw new Error('Imagem acima de 8 MB, mesmo reduzida.')

  // O nome no bucket é sorteado: o nome original vai só na mensagem, e assim
  // dois arquivos iguais nunca colidem.
  const path = `${crypto.randomUUID()}.${EXT[type] ?? 'jpg'}`

  const { error } = await supabase.storage.from('images').upload(path, blob, {
    contentType: type,
    cacheControl: '31536000',
  })
  if (error) throw new Error(`Falha no envio da imagem: ${error.message}`)

  const { data } = supabase.storage.from('images').getPublicUrl(path)
  return { url: data.publicUrl, w, h, name: file.name }
}

/** Pega a primeira imagem de um paste ou de um arrastar-e-soltar. */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.files)) if (isImage(item)) return item
  return null
}
