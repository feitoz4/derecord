# derecord

Dois canais para um grupo: **#chat** (texto) e **voz** (chamada com vídeo e
tela). WebRTC em **mesh** (peer-to-peer, sem servidor de mídia) — o Supabase só
faz a apresentação entre os participantes.

Estar online no grupo e estar na chamada são coisas separadas: o mesh só conecta
quem entrou no canal de voz.

Dimensionado para **até 6 pessoas** — dentro disso o mesh é confortável e não
precisa de servidor de mídia.

- **Hospedar:** GitHub Pages (site) + Supabase (sinalização, chat e imagens).
  Tudo no plano grátis, sem servidor para manter — veja abaixo.
- **App para Windows:** [`desktop/README.md`](desktop/README.md) — Electron,
  com seletor de tela próprio e ícone na bandeja.

## Começar

**1. Crie um projeto no Supabase** (grátis, sem cartão) em
<https://supabase.com>. Anote a URL e a chave `anon` em
*Project Settings → Data API*.

**2. Rode o schema.** No painel, *SQL Editor*, cole
[`supabase/schema.sql`](supabase/schema.sql) inteiro e execute. Isso cria a
tabela de mensagens, liga o realtime e prepara o bucket de imagens.

**3. Configure e suba:**

```bash
npm install
cp .env.example .env   # preencha com a URL e a chave
npm run dev
```

Abre em `http://localhost:5173`. Para testar sozinho, abra duas abas.

**4. Publique.**

```bash
npm run deploy
```

Compila e empurra o resultado para a branch `gh-pages`. Uma vez só, no
repositório: *Settings → Pages* → **Deploy from a branch** → `gh-pages` / `root`.

As chaves entram no build a partir do seu `.env` local — por isso quem publica
precisa dele preenchido.

> A chave `anon` é pública por natureza: ela vai dentro do JavaScript que roda
> no navegador de todo mundo. Quem protege os dados são as regras de RLS do
> `schema.sql`, não o sigilo da chave. Como não há contas, **quem tem o
> endereço entra** — se quiser algo menos exposto, use um nome de sala difícil
> de adivinhar (`?sala=...`).

## O que tem

| Recurso | Onde |
|---|---|
| Canal de texto | sempre disponível, com contador de não lidas |
| Canal de voz | entra/sai à parte; o mesh só liga quem está nele |
| Chamada de voz | mesh WebRTC, um `RTCPeerConnection` por par |
| Expandir alguém | clique no tile joga a pessoa pro palco |
| Tela cheia | botão no palco, ou `F` |
| Vídeo (câmera) | liga/desliga; desligar **para a track** — o LED da webcam apaga |
| Compartilhar tela | com áudio da aba quando o SO permite; vai pro "palco" |
| Mudo (seu mic) | `track.enabled = false` — instantâneo, sem renegociar |
| Volume de cada pessoa | 0–300%, individual, **com amplificação real** acima de 100% |
| Silenciar alguém só pra você | por participante |
| Indicador de quem está falando | borda verde no tile, via `AnalyserNode` |
| Escolha de microfone/câmera | troca ao vivo, sem cair a chamada |
| Chat de texto | últimas 200 mensagens, em memória |
| Responder mensagem | citação clicável que leva até a original |
| Menções com `@` | autocomplete, `@todos`, destaque de quem foi citado |
| Anexar imagem | botão, colar (Ctrl+V) ou arrastar pro chat |
| Reconexão automática | se o WebSocket cair |

Atalhos: `Ctrl+Shift+M` microfone, `Ctrl+Shift+V` câmera, `F` tela cheia,
`Esc` recolhe o palco.

## Como funciona

### Os 4 slots fixos

O ponto mais importante do projeto. Cada par abre **uma** conexão com quatro
slots de mídia, sempre nesta ordem:

```
0: audio  -> microfone
1: audio  -> áudio da tela
2: video  -> câmera
3: video  -> tela
```

Como os slots já nascem prontos, ligar câmera ou tela é só `replaceTrack()` —
**a negociação SDP acontece uma vez só, na entrada**. Isso elimina a maior fonte
de bug de mesh, que é renegociar toda hora e dar colisão de ofertas.

**Só o lado iniciador cria os transceivers.** O outro não cria nada: adota os
que chegam na oferta, na ordem em que vieram. Isso não é estilo — se os dois
lados criarem antes de negociar, o SDP não casa os pares, ele *empilha*: a
conexão termina com 8 transceivers desalinhados, os slots deixam de
corresponder e a mídia nunca flui. Foi exatamente esse bug que travou a
chamada em `new` durante o desenvolvimento.

Se você mexer nessa ordem, tem que mexer nos dois lados. É contrato.

### Imagens

O arquivo **não** trafega pelo canal de tempo real. O cliente reduz a imagem
quando ela é maior que 1920px (GIF passa intacto, senão perderia a animação) e
sobe direto para o **Supabase Storage**, que devolve a URL pública.

A mensagem carrega só `{url, w, h}`. As medidas importam: é com elas que o chat
reserva a altura certa antes da imagem carregar, senão a lista "pula" enquanto
as fotos vão chegando.

O bucket recusa no servidor o que não for `image/*` até 8 MB — mesmo que
alguém burle o cliente.

### Menções

Não há contas: **o nome é a identidade**. Como nome pode ter espaço, `@\w+` não
serve — a menção é casada contra a lista de nomes conhecidos (quem está online
mais quem já falou no histórico), do mais longo pro mais curto, para que
`@Ana Paula` ganhe de `@Ana` quando as duas existirem.

### Por que 6 pessoas é o limite

No mesh, cada pessoa envia sua mídia separadamente para cada uma das outras.
Com 6 na chamada são 5 fluxos saindo de cada máquina — é o **upload** que
satura primeiro, não o download nem o servidor. Acima disso o certo seria um
SFU (LiveKit, mediasoup), que recebe uma vez e redistribui.

Como o limite aqui é 6, nada disso é necessário: o servidor não vê um byte de
áudio ou vídeo, e por isso cabe folgado na menor VM gratuita que existir.

### TURN (ainda não configurado)

Cerca de 10 a 20% das conexões não fecham em P2P direto (NAT simétrico) e
precisam de um relay. Hoje o app usa só STUN público, o que resolve a maioria
dos casos.

Se alguém do grupo não conseguir conectar, o caminho é a **Cloudflare Realtime
TURN**, que tem 1000 GB/mês grátis — sobra muito para 6 pessoas. É preencher
`Room.iceServers` com as credenciais que a API dela devolve.

### Volume acima de 100%

Um `<audio>` normal só vai até `volume = 1.0`. Para passar disso o áudio é
desviado por um `GainNode` do Web Audio, que aceita ganho arbitrário.

Até 100% quem toca é o elemento (caminho nativo, mais robusto). Acima de 100% o
elemento é silenciado e o `GainNode` assume — senão sairia dobrado. O
`AnalyserNode` fica sempre ligado, medindo, porque ele não produz saída.

O volume escolhido é salvo por **nome** no `localStorage`, já que o id muda a
cada sessão.

### Negociação

`PeerConn` implementa *perfect negotiation* (o padrão da WHATWG): quando os dois
lados ofertam ao mesmo tempo, o lado "polite" desfaz a própria oferta em vez de
travar. Quem é polite é decidido comparando os ids — determinístico e sempre
oposto nos dois lados.

## Estrutura

```
supabase/schema.sql    tabela de mensagens, RLS e bucket de imagens
src/lib/rtc.ts         RTCPeerConnection, transceivers, perfect negotiation
src/lib/audio.ts       volume por pessoa, boost, medidor de voz
src/lib/media.ts       getUserMedia / getDisplayMedia
src/lib/room.ts        estado da sala, mesh, controles de mídia
src/components/        interface
```

## Rodar de verdade

```bash
npm run build
npm start
```


**HTTPS é obrigatório.** Fora de `localhost`, o navegador bloqueia câmera e
microfone sem TLS. O GitHub Pages já serve em HTTPS, então isso vem resolvido.

## Limite

Mesh é N-1 streams saindo de cada pessoa. Na prática:

- **até ~6 pessoas em call** — tranquilo
- **8+** — o upload de quem tem internet fraca começa a sofrer

Passar disso pede um SFU (LiveKit, mediasoup), e aí passa a existir um servidor
processando mídia. Para um grupo, mesh é o caminho certo.
