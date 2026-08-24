/**
 * Confere, na SUA máquina, que tudo que o app depende funciona:
 * captura de tela, ícone, atalho global e a ponte do preload.
 *
 *   npm run verify
 */
const { app, session, BrowserWindow, Tray, globalShortcut, desktopCapturer, nativeImage } = require('electron')
const path = require('node:path')

app.whenReady().then(async () => {
  const out = {}
  const ses = session.defaultSession
  out.setDisplayMediaRequestHandler = typeof ses.setDisplayMediaRequestHandler
  out.setPermissionRequestHandler = typeof ses.setPermissionRequestHandler
  out.setPermissionCheckHandler = typeof ses.setPermissionCheckHandler
  out.desktopCapturer = typeof desktopCapturer.getSources

  // o ícone gerado é legível pelo Electron?
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'))
  out.iconOk = !img.isEmpty()
  out.iconSize = img.getSize()

  // o atalho global registra?
  out.shortcut = globalShortcut.register('CommandOrControl+Shift+F24', () => {})
  globalShortcut.unregisterAll()

  // janela + preload carregam o picker sem erro?
  const w = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  })
  const errs = []
  w.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) errs.push(msg) })
  await w.loadFile(path.join(__dirname, 'picker.html'))
  out.pickerBridge = await w.webContents.executeJavaScript('typeof window.picker?.choose')
  out.pickerTitulo = await w.webContents.executeJavaScript('document.querySelector("h1").textContent')
  out.errosNoPicker = errs

  // fontes de captura de tela de verdade
  try {
    const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 80, height: 45 } })
    out.fontesDeTela = s.length
    out.primeiraFonte = s[0]?.name
  } catch (e) { out.capturaErro = String(e.message) }

  const ok =
    out.setDisplayMediaRequestHandler === 'function' &&
    out.desktopCapturer === 'function' &&
    out.iconOk &&
    out.shortcut &&
    out.pickerBridge === 'function' &&
    out.errosNoPicker.length === 0 &&
    out.fontesDeTela > 0

  for (const [k, v] of Object.entries(out)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`)
  }
  console.log('')
  console.log(ok ? '  tudo certo.' : '  ALGO FALHOU — veja acima.')
  app.exit(ok ? 0 : 1)
})
