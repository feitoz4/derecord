/**
 * Gera build/icon.png e build/icon.ico sem dependência nenhuma.
 *
 * Desenha por matemática (distância a formas) com 3x3 de supersampling —
 * é o suficiente para um ícone limpo e evita arrastar um rasterizador só
 * para isso.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build')

// ---------- formas ----------------------------------------------------------

/** Distância até um retângulo de cantos redondos (negativa = dentro). */
function roundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
  const d1 = s(px, py, ax, ay, bx, by)
  const d2 = s(px, py, bx, by, cx, cy)
  const d3 = s(px, py, cx, cy, ax, ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

const lerp = (a, b, t) => a + (b - a) * t

/** Cor de um ponto: fundo em gradiente + balão de fala branco. */
function shade(x, y) {
  const bg = roundRect(x, y, 128, 128, 128, 128, 56)
  if (bg > 0) return [0, 0, 0, 0]

  // gradiente diagonal indigo -> verde, o mesmo par do app
  const t = Math.min(1, Math.max(0, (x + y) / (SIZE * 2)))
  let r = lerp(0x5b, 0x2f, t)
  let g = lerp(0x6b, 0xbf, t)
  let b = lerp(0xf0, 0x71, t)

  const bubble = roundRect(x, y, 128, 118, 74, 56, 24)
  const tail = inTriangle(x, y, 96, 168, 132, 168, 92, 202)

  if (bubble <= 0 || tail) {
    // furos do balão: três pontinhos, como reticências
    const dot = [96, 128, 160].some((dx) => Math.hypot(x - dx, y - 118) < 10)
    if (!dot) return [255, 255, 255, 255]
    return [r, g, b, 255]
  }
  return [r, g, b, 255]
}

// ---------- rasterização ----------------------------------------------------

const px = Buffer.alloc(SIZE * SIZE * 4)
const S = 3 // supersampling

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const c = shade(x + (sx + 0.5) / S, y + (sy + 0.5) / S)
        r += c[0] * c[3]
        g += c[1] * c[3]
        b += c[2] * c[3]
        a += c[3]
      }
    }
    const i = (y * SIZE + x) * 4
    px[i] = a ? Math.round(r / a) : 0
    px[i + 1] = a ? Math.round(g / a) : 0
    px[i + 2] = a ? Math.round(b / a) : 0
    px[i + 3] = Math.round(a / (S * S))
  }
}

// ---------- PNG -------------------------------------------------------------

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return (buf) => {
    let c = -1
    for (const byte of buf) c = t[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(CRC(body))
  return Buffer.concat([len, body, crc])
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filtro "none"
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bits por canal
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

// ---------- ICO (um único PNG de 256, que o Windows aceita) -----------------

const dir = Buffer.alloc(22)
dir.writeUInt16LE(0, 0) // reservado
dir.writeUInt16LE(1, 2) // tipo: ícone
dir.writeUInt16LE(1, 4) // quantidade
dir[6] = 0 // largura 0 == 256
dir[7] = 0 // altura  0 == 256
dir.writeUInt16LE(1, 10) // planos
dir.writeUInt16LE(32, 12) // bits por pixel
dir.writeUInt32BE(0, 14)
dir.writeUInt32LE(png.length, 14)
dir.writeUInt32LE(22, 18)

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'icon.png'), png)
fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([dir, png]))

console.log(`icon.png ${png.length} bytes | icon.ico ${png.length + 22} bytes`)
