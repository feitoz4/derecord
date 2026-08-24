import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

// A porta vem do argumento antes da env: em dev o Vite já ocupa a PORT do
// ambiente, e sem isso os dois brigam pela mesma e um build velho acaba servido.
const argPort = process.argv.indexOf('--port')
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT) || 8787
const SERVE_STATIC = !process.argv.includes('--no-static')

/**
 * TURN com credencial temporária (o "TURN REST API" do coturn).
 *
 * O segredo fica só aqui no servidor. Cada pessoa recebe um usuário que é a
 * data de expiração e uma senha que é o HMAC dela — o coturn valida sozinho,
 * sem banco de usuários. Se vazar, expira em horas em vez de valer pra sempre.
 */
const TURN_HOST = process.env.TURN_HOST || ''
const TURN_SECRET = process.env.TURN_SECRET || ''
const TURN_TTL = 12 * 3600

function iceServers() {
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]
  if (!TURN_HOST || !TURN_SECRET) return list

  const username = String(Math.floor(Date.now() / 1000) + TURN_TTL)
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64')

  list.push({
    urls: [
      `turn:${TURN_HOST}:3478?transport=udp`,
      `turn:${TURN_HOST}:3478?transport=tcp`,
      // 443/TLS é a saída para redes corporativas que bloqueiam o resto.
      `turns:${TURN_HOST}:5349?transport=tcp`,
    ],
    username,
    credential,
  })
  return list
}

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const UPLOADS = path.join(ROOT, 'uploads')
fs.mkdirSync(UPLOADS, { recursive: true })

const MAX_UPLOAD = 8 * 1024 * 1024
const IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}
/** O cliente só pode citar um arquivo que este servidor gerou. */
const UPLOAD_URL = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Recebe o arquivo cru no corpo do POST — sem multipart, sem dependência. */
function handleUpload(req, res) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim()
  const ext = IMAGE_TYPES[type]
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  if (!ext) return reply(415, { error: 'Só imagem (png, jpg, gif, webp).' })

  const chunks = []
  let size = 0
  let aborted = false

  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > MAX_UPLOAD) {
      aborted = true
      reply(413, { error: 'Imagem acima de 8 MB.' })
      return req.destroy()
    }
    chunks.push(c)
  })

  req.on('end', () => {
    if (aborted) return
    const name = `${crypto.randomUUID()}${ext}`
    fs.writeFile(path.join(UPLOADS, name), Buffer.concat(chunks), (err) => {
      if (err) return reply(500, { error: 'Falha ao gravar o arquivo.' })
      reply(200, { url: `/uploads/${name}` })
    })
  })
}

function serveUpload(url, res) {
  const file = path.join(UPLOADS, path.basename(decodeURIComponent(url)))
  if (!file.startsWith(UPLOADS) || !fs.existsSync(file)) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(file).pipe(res)
}

// Serve o build de produção quando existir. Em dev o Vite cuida do front.
const server = http.createServer((req, res) => {
  const reqUrl = (req.url || '/').split('?')[0]

  // Upload e imagens valem sempre, inclusive com --no-static.
  if (req.method === 'POST' && reqUrl === '/upload') return handleUpload(req, res)
  if (reqUrl.startsWith('/uploads/')) return serveUpload(reqUrl, res)

  if (!SERVE_STATIC || !fs.existsSync(DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('Esta porta é só a sinalização. Abra o app na porta do Vite.')
  }
  let file = path.join(DIST, reqUrl === '/' ? 'index.html' : decodeURIComponent(reqUrl))
  // impede path traversal
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

const wss = new WebSocketServer({ server, path: '/ws' })

/** @type {Map<string, Map<string, Peer>>} roomId -> (peerId -> Peer) */
const rooms = new Map()
/** @type {Map<string, object[]>} histórico de mensagens por sala */
const history = new Map()
const HISTORY_MAX = 200

const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, new Map())
  return rooms.get(id)
}

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

const publicPeer = (p) => ({ id: p.id, name: p.name, voice: p.voice, state: p.state })

function broadcast(roomId, msg, exceptId) {
  for (const p of room(roomId).values()) {
    if (p.id !== exceptId) send(p.ws, msg)
  }
}

wss.on('connection', (ws, req) => {
  const id = crypto.randomUUID()
  let roomId = null
  let me = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (msg.t) {
      case 'join': {
        if (me) return
        roomId = String(msg.room || 'geral').slice(0, 60)
        me = {
          id,
          ws,
          name: String(msg.name || 'anônimo').slice(0, 32) || 'anônimo',
          voice: false, // online no grupo, mas ainda fora do canal de voz
          state: { mic: false, cam: false, screen: false },
        }
        const r = room(roomId)
        send(ws, {
          t: 'welcome',
          id,
          room: roomId,
          peers: [...r.values()].map(publicPeer),
          history: history.get(roomId) || [],
          iceServers: iceServers(),
        })
        r.set(id, me)
        broadcast(roomId, { t: 'peer-join', peer: publicPeer(me) }, id)
        break
      }

      // Entrar/sair do canal de voz. É isso que decide com quem o mesh conecta.
      case 'voice': {
        if (!me) return
        me.voice = !!msg.join
        if (!me.voice) me.state = { mic: false, cam: false, screen: false }
        broadcast(roomId, { t: 'peer-voice', id, voice: me.voice, state: me.state }, id)
        break
      }

      case 'state': {
        if (!me) return
        me.state = {
          mic: !!msg.mic,
          cam: !!msg.cam,
          screen: !!msg.screen,
        }
        broadcast(roomId, { t: 'peer-state', id, state: me.state }, id)
        break
      }

      // Relay puro de SDP/ICE entre dois peers.
      case 'signal': {
        if (!me || !msg.to) return
        const target = room(roomId).get(msg.to)
        if (target) send(target.ws, { t: 'signal', from: id, data: msg.data })
        break
      }

      case 'chat': {
        if (!me) return
        const text = String(msg.text || '').slice(0, 2000).trim()

        // Imagem só entra se apontar para um arquivo que este servidor gerou.
        const img = msg.image
        const image =
          img && typeof img.url === 'string' && UPLOAD_URL.test(img.url)
            ? {
                url: img.url,
                w: Math.max(1, Math.min(8000, Number(img.w) || 0)),
                h: Math.max(1, Math.min(8000, Number(img.h) || 0)),
              }
            : null

        // Mensagem vazia só passa se trouxer imagem.
        if (!text && !image) return

        const src = msg.replyTo
        const replyTo =
          src && typeof src.id === 'string'
            ? {
                id: String(src.id).slice(0, 40),
                name: String(src.name || '').slice(0, 32),
                text: String(src.text || '').slice(0, 160),
                image: !!src.image,
              }
            : null

        const mentions = Array.isArray(msg.mentions)
          ? msg.mentions.slice(0, 30).map((m) => String(m).slice(0, 32))
          : []

        const entry = {
          id: crypto.randomUUID(),
          from: id,
          name: me.name,
          text,
          ts: Date.now(),
          image,
          replyTo,
          mentions,
        }
        const h = history.get(roomId) || []
        h.push(entry)
        if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX)
        history.set(roomId, h)
        // broadcast sem exceção já inclui quem enviou — o remetente vê uma vez só.
        broadcast(roomId, { t: 'chat', ...entry })
        break
      }

      case 'ping':
        send(ws, { t: 'pong' })
        break
    }
  })

  ws.on('close', () => {
    if (!me || !roomId) return
    room(roomId).delete(id)
    broadcast(roomId, { t: 'peer-leave', id })
    if (room(roomId).size === 0) {
      rooms.delete(roomId)
      history.delete(roomId)
    }
  })
})

server.listen(PORT, () => {
  console.log(`[derecord] sinalização em ws://localhost:${PORT}/ws`)
  console.log(
    TURN_HOST && TURN_SECRET
      ? `[derecord] TURN em ${TURN_HOST}`
      : '[derecord] sem TURN (só STUN) — ok em dev, ruim em rede difícil',
  )
  if (SERVE_STATIC && fs.existsSync(DIST)) {
    console.log(`[derecord] app em http://localhost:${PORT}`)
  }
})
