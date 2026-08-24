# derecord para Windows

Um invólucro Electron em volta do app hospedado. O que ele acrescenta sobre
abrir no navegador:

- **Seletor de tela próprio**, com telas e janelas separadas e miniatura
- **Som do que está na tela** junto com o vídeo (`loopback`, só no Windows)
- **Ícone na bandeja** — fechar esconde, não sai
- **Mudo por atalho global** (`Ctrl+Shift+M`) mesmo com o app em segundo plano
- **Iniciar com o Windows**, opcional, pelo menu da bandeja

## Rodar em desenvolvimento

```bash
npm install
npm start
```

Na primeira execução ele pergunta o endereço do servidor. Para testar contra o
servidor local, use `http://localhost:5173`.

## Conferir se tudo funciona

```bash
npm run verify
```

Checa captura de tela, ícone, atalho global e a ponte do preload, e sai com
código 1 se algo falhar. Vale rodar antes de gerar o instalador.

## Gerar o instalador

```bash
npm run dist
```

Sai em `dist/derecord Setup 0.1.0.exe`. É um NSIS comum: instala por usuário,
sem pedir administrador, e deixa escolher a pasta.

Mande esse `.exe` pro pessoal do grupo. Na primeira abertura cada um digita o
endereço do servidor uma vez.

## Por que Electron e não Tauri

O Tauri geraria um binário de ~5 MB em vez de ~150 MB, o que é bem melhor. Mas
ele usa o WebView2 do Windows, e o suporte a `getDisplayMedia` lá é
inconsistente. Compartilhar tela é a função central aqui, então valeu trocar
tamanho por previsibilidade.

## Detalhe importante: o seletor de tela

No navegador, `getDisplayMedia()` abre o seletor nativo do Chrome. **No Electron
esse seletor não existe** — sem `setDisplayMediaRequestHandler`, o botão de
compartilhar tela simplesmente não faz nada, sem erro nenhum. É o que
`main.js` resolve: pega as fontes com `desktopCapturer`, abre a janela de
escolha (`picker.html`) e devolve a escolhida.

## Permissões

Microfone, câmera e captura de tela são liberados **só para a origem
configurada**. Se a janela navegar para qualquer outro endereço, as permissões
são negadas. Links externos abrem no navegador padrão, não dentro do app.

## O ícone

Gerado por código, sem dependência de design:

```bash
npm run icon
```

`make-icon.mjs` desenha por matemática, com supersampling, e escreve o PNG e o
ICO na mão. Para mudar as cores, é o gradiente em `shade()`.

## O que não foi testado

O app foi escrito e revisado, mas **não chegou a rodar**: o ambiente onde foi
desenvolvido não conseguiu baixar o binário do Electron. O `npm run verify`
existe justamente por isso — rode-o na sua máquina antes de confiar no
instalador.

Já verificados fora do Electron: `picker.html` e `server.html` (carregados num
navegador com a ponte simulada, incluindo a validação de endereço), o ícone
(PNG e ICO válidos) e a sintaxe de todos os arquivos.
