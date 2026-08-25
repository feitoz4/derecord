const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  session,
  shell,
  dialog,
  globalShortcut,
  desktopCapturer,
  nativeImage,
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Uma instância só: abrir de novo traz a janela existente pra frente.
if (!app.requestSingleInstanceLock()) app.quit()

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')
// Já vem apontando para o servidor do grupo; a primeira execução só confirma.
const DEFAULT_URL = 'https://feitoz4.github.io/derecord/'

function loadConfig() {
  try {
    return { url: DEFAULT_URL, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }
  } catch {
    return { url: DEFAULT_URL }
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
}

let config = loadConfig()
let win = null
let tray = null
let quitting = false

const origin = (u) => {
  try {
    return new URL(u).origin
  } catch {
    return ''
  }
}

// ---------- janela principal ------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#1a1b1e',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.loadURL(config.url)

  // Fechar vai pra bandeja: sair de verdade é pelo menu do ícone.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })

  // Link externo abre no navegador, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    if (code === -3) return // navegação abortada, acontece em reload
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'Não consegui abrir o servidor',
      message: `${config.url}\n\n${desc}`,
      detail: 'Confira o endereço em "Trocar servidor", na bandeja.',
    })
  })
}

// ---------- permissões ------------------------------------------------------

/**
 * O Electron nega mídia por padrão. Libera só para o nosso servidor —
 * qualquer outra origem que a janela venha a carregar continua barrada.
 */
function setupPermissions() {
  const allowed = new Set(['media', 'display-capture', 'clipboard-read', 'notifications'])
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((contents, permission, callback) => {
    callback(allowed.has(permission) && origin(contents.getURL()) === origin(config.url))
  })

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && requestingOrigin === origin(config.url)
  })
}

// ---------- compartilhar tela -----------------------------------------------

/**
 * O `getDisplayMedia` do Chrome mostra um seletor nativo; no Electron esse
 * seletor não existe — a aplicação precisa fornecer o dela. É por isso que
 * este bloco existe, e sem ele o botão de compartilhar tela simplesmente
 * não faz nada.
 */
function setupScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        })

        const chosen = await pickSource(sources)
        if (!chosen) return callback({})

        callback({
          video: chosen,
          // No Windows dá pra capturar o som do que está na tela.
          audio: process.platform === 'win32' ? 'loopback' : undefined,
        })
      } catch (err) {
        console.error('[desktop] seletor de tela', err)
        callback({})
      }
    },
    { useSystemPicker: false },
  )
}

function pickSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 780,
      height: 560,
      parent: win,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#1a1b1e',
      autoHideMenuBar: true,
      title: 'Compartilhar tela',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    })

    const payload = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      isScreen: s.id.startsWith('screen:'),
    }))

    let settled = false
    const finish = (id) => {
      if (settled) return
      settled = true
      ipcMain.removeHandler('picker:sources')
      ipcMain.removeListener('picker:choose', onChoose)
      resolve(id ? sources.find((s) => s.id === id) || null : null)
      if (!picker.isDestroyed()) picker.close()
    }

    const onChoose = (_e, id) => finish(id)

    ipcMain.handle('picker:sources', () => payload)
    ipcMain.on('picker:choose', onChoose)
    picker.on('closed', () => finish(null))

    picker.loadFile(path.join(__dirname, 'picker.html'))
  })
}

// ---------- bandeja e atalho global -----------------------------------------

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('derecord')

  const show = () => {
    win.show()
    win.focus()
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir', click: show },
      { type: 'separator' },
      { label: 'Mudo (Ctrl+Shift+M)', click: toggleMic },
      { label: 'Recarregar', click: () => win.reload() },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) =>
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      {
        label: 'Trocar servidor…',
        click: async () => {
          if (await promptServer()) win.loadURL(config.url)
        },
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )

  tray.on('click', show)
}

/**
 * Dispara o mesmo atalho que a página já escuta — assim o app não precisa
 * saber nada de dentro do site, e continua funcionando se a página mudar.
 */
function toggleMic() {
  win?.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent('keydown',{key:'M',ctrlKey:true,shiftKey:true,bubbles:true}))`,
    true,
  )
}

/** Retorna true se o endereço mudou (e a janela precisa recarregar). */
function promptServer() {
  return new Promise((resolve) => {
    const dlg = new BrowserWindow({
      width: 460,
      height: 330,
      parent: win || undefined,
      modal: !!win,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#1a1b1e',
      autoHideMenuBar: true,
      title: 'Servidor',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    })

    let settled = false
    const finish = (url) => {
      if (settled) return
      settled = true
      ipcMain.removeHandler('settings:current')
      ipcMain.removeListener('settings:save', onSave)
      if (url) {
        config = { ...config, url }
        saveConfig(config)
      }
      if (!dlg.isDestroyed()) dlg.close()
      resolve(!!url)
    }

    const onSave = (_e, url) => finish(url)

    ipcMain.handle('settings:current', () => config.url)
    ipcMain.on('settings:save', onSave)
    dlg.on('closed', () => finish(null))

    dlg.loadFile(path.join(__dirname, 'server.html'))
  })
}

// ---------- ciclo de vida ---------------------------------------------------

app.whenReady().then(async () => {
  setupPermissions()
  setupScreenShare()

  // Primeira execução: confirma o endereço antes de abrir a janela.
  if (!fs.existsSync(CONFIG_FILE)) {
    const ok = await promptServer()
    if (!ok) return app.exit(0)
  }

  createWindow()
  setupTray()

  // Vale mesmo com o app em segundo plano — é o ponto de ter um app nativo.
  globalShortcut.register('CommandOrControl+Shift+M', toggleMic)

  if (process.argv.includes('--hidden')) win.hide()
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on('window-all-closed', (e) => e.preventDefault()) // fica na bandeja
app.on('before-quit', () => (quitting = true))
app.on('will-quit', () => globalShortcut.unregisterAll())
