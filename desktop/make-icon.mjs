/**
 * Gera build/icon.png e build/icon.ico a partir da logo em build/source.png.
 *
 * Sem dependência: decodifica o PNG de origem com zlib, recorta a área que
 * realmente tem desenho, redimensiona com filtro de caixa e compõe sobre um
 * quadrado de cantos redondos.
 *
 * O recorte importa: logo exportada costuma vir com margem sobrando e fora de
 * centro, e no tamanho de um ícone de barra de tarefas isso vira um borrão
 * torto num canto.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'build')
const SOURCE = path.join(OUT, 'source.png')

const SIZE = 256
const PADDING = 0.14 // margem em volta do símbolo, proporção do lado
const RADIUS = 0.22 // canto arredondado, proporção do lado
const BG = [255, 255, 255] // fundo do ícone

// ---------- CRC32 (usado na leitura e na escrita) ---------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ---------- decodificar PNG -------------------------------------------------

/** Aceita RGB/RGBA 8 bits sem entrelaçamento — o que qualquer editor exporta. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('não é um PNG')

  let pos = 8
  let w = 0, h = 0, channels = 0
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)

    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      const depth = data[8]
      const color = data[9]
      if (depth !== 8) throw new Error(`PNG de ${depth} bits não suportado`)
      if (data[12] !== 0) throw new Error('PNG entrelaçado não suportado')
      if (color === 2) channels = 3
      else if (color === 6) channels = 4
      else throw new Error('PNG precisa ser RGB ou RGBA')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break

    pos += 12 + len
  }

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = Buffer.alloc(w * h * 4)

  // Desfaz os filtros por linha (a especificação define 5).
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  let src = 0

  for (let y = 0; y < h; y++) {
    const filter = raw[src++]
    raw.copy(line, 0, src, src + stride)
    src += stride

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]

      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 0xff
    }

    for (let x = 0; x < w; x++) {
      const s = x * channels
      const d = (y * w + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }

    line.copy(prev)
  }

  return { w, h, px: out }
}

// ---------- escrever PNG ----------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- montagem --------------------------------------------------------

if (!fs.existsSync(SOURCE)) {
  console.error(`Faltando ${SOURCE}\nColoque a logo (PNG) nesse caminho.`)
  process.exit(1)
}

const src = decodePng(fs.readFileSync(SOURCE))

// Caixa do que tem desenho: descarta transparente e quase-branco das bordas.
let x0 = src.w, y0 = src.h, x1 = -1, y1 = -1
for (let y = 0; y < src.h; y++) {
  for (let x = 0; x < src.w; x++) {
    const i = (y * src.w + x) * 4
    const alpha = src.px[i + 3]
    const claro = src.px[i] > 244 && src.px[i + 1] > 244 && src.px[i + 2] > 244
    if (alpha > 16 && !claro) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
}
if (x1 < 0) throw new Error('a imagem parece vazia')

// Recorte quadrado centrado no símbolo, para não distorcer.
const bw = x1 - x0 + 1
const bh = y1 - y0 + 1
const lado = Math.max(bw, bh)
const cx = (x0 + x1) / 2
const cy = (y0 + y1) / 2

const inner = Math.round(SIZE * (1 - PADDING * 2))
const off = Math.round((SIZE - inner) / 2)
const out = Buffer.alloc(SIZE * SIZE * 4)

// Filtro de caixa: para reduzir muito, faz média da região de origem.
const escala = lado / inner
for (let y = 0; y < inner; y++) {
  for (let x = 0; x < inner; x++) {
    const sx0 = cx - lado / 2 + x * escala
    const sy0 = cy - lado / 2 + y * escala
    let r = 0, g = 0, b = 0, a = 0, n = 0

    for (let sy = Math.floor(sy0); sy < sy0 + escala; sy++) {
      for (let sx = Math.floor(sx0); sx < sx0 + escala; sx++) {
        if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) { n++; continue }
        const i = (sy * src.w + sx) * 4
        const al = src.px[i + 3] / 255
        r += src.px[i] * al
        g += src.px[i + 1] * al
        b += src.px[i + 2] * al
        a += al
        n++
      }
    }
    if (!n) continue

    const d = ((y + off) * SIZE + (x + off)) * 4
    // Compõe sobre o fundo aqui mesmo: o ícone final é opaco dentro do quadrado.
    const cob = a / n
    out[d] = Math.round((a ? r / a : 0) * cob + BG[0] * (1 - cob))
    out[d + 1] = Math.round((a ? g / a : 0) * cob + BG[1] * (1 - cob))
    out[d + 2] = Math.round((a ? b / a : 0) * cob + BG[2] * (1 - cob))
    out[d + 3] = 255
  }
}

// Preenche a margem com o fundo e recorta os cantos arredondados.
const rad = SIZE * RADIUS
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = (y * SIZE + x) * 4
    if (out[d + 3] === 0) {
      out[d] = BG[0]; out[d + 1] = BG[1]; out[d + 2] = BG[2]; out[d + 3] = 255
    }
    // Distância até o retângulo de cantos redondos, para suavizar a borda.
    const dx = Math.abs(x + 0.5 - SIZE / 2) - (SIZE / 2 - rad)
    const dy = Math.abs(y + 0.5 - SIZE / 2) - (SIZE / 2 - rad)
    const dist = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rad
    if (dist > 0) out[d + 3] = Math.round(255 * Math.max(0, 1 - dist))
  }
}

const png = encodePng(out, SIZE)

// ICO com um único PNG de 256 — formato que o Windows aceita desde o Vista.
const dir = Buffer.alloc(22)
dir.writeUInt16LE(1, 2)
dir.writeUInt16LE(1, 4)
dir.writeUInt16LE(1, 10)
dir.writeUInt16LE(32, 12)
dir.writeUInt32LE(png.length, 14)
dir.writeUInt32LE(22, 18)

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'icon.png'), png)
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([dir, png]))

console.log(`origem   ${src.w}x${src.h}`)
console.log(`símbolo  ${bw}x${bh} em (${x0},${y0}) — recortado e centrado`)
console.log(`gerado   icon.png ${png.length} bytes | icon.ico ${png.length + 22} bytes`)
