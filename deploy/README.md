# Hospedar no Oracle Cloud Always Free

Grátis pra sempre, servidor ligado 24h, com TURN próprio. São uns 30 minutos,
quase todos esperando o cadastro da Oracle.

## 1. Criar a conta

<https://www.oracle.com/cloud/free/>

Pede cartão de crédito **só para verificar identidade** — não cobra, e a conta
não vira paga sozinha. Escolha a região mais perto (São Paulo ou Vinhedo).

## 2. Criar a VM

Compute → Instances → **Create instance**

| Campo | Valor |
|---|---|
| Image | Ubuntu 22.04 |
| Shape | **VM.Standard.A1.Flex** (ARM) — 2 OCPU, 12 GB |
| SSH keys | gere e **salve a chave privada** |

Se a região estiver sem capacidade ARM (acontece), use
**VM.Standard.E2.1.Micro** — dá conta de 6 pessoas tranquilamente, já que a
mídia é P2P e não passa pelo servidor.

Anote o **IP público** ao final.

## 3. Abrir as portas na VCN

**Este é o passo que todo mundo esquece, e sem ele nada funciona.** A Oracle
tem dois firewalls: o da nuvem e o de dentro da VM. O `setup.sh` cuida do
segundo; este é o primeiro.

Networking → Virtual Cloud Networks → sua VCN → Security Lists → Default →
**Add Ingress Rules**, com Source `0.0.0.0/0`:

| Protocolo | Portas | Para quê |
|---|---|---|
| TCP | 80, 443 | site e HTTPS |
| TCP | 3478, 5349 | TURN |
| UDP | 3478 | TURN |
| UDP | 49152-65535 | mídia via TURN |

## 4. Apontar um domínio

Precisa de um domínio pro HTTPS (o Let's Encrypt não emite pra IP puro). Um
`.com` sai uns R$ 40/ano; de graça dá pra usar **DuckDNS** ou um subdomínio do
**Cloudflare** se você já tiver algum domínio.

Crie um registro **A** apontando pro IP público da VM. Espere propagar
(`ping seu.dominio.com` deve responder o IP certo).

## 5. Instalar

```bash
ssh -i sua-chave.key ubuntu@SEU_IP
sudo apt-get update && sudo apt-get install -y git
sudo git clone SEU_REPO /opt/derecord
cd /opt/derecord
sudo bash deploy/setup.sh seu.dominio.com
```

O script instala Node, Caddy e coturn, gera o segredo do TURN, compila o front,
cria o serviço do systemd e libera o firewall interno.

Abra `https://seu.dominio.com`. O certificado sai sozinho no primeiro acesso.

## 6. Conferir se o TURN está de pé

```bash
sudo systemctl status coturn derecord caddy
journalctl -u derecord -n 30
```

O log do app deve dizer `TURN em seu.dominio.com`. Se disser
`sem TURN (só STUN)`, o `/etc/derecord.env` não foi lido.

Teste o TURN de fora, pelo navegador — em
<https://icetest.info> coloque:

- URL: `turn:seu.dominio.com:3478`
- usuário e senha: pegue de `curl -s https://seu.dominio.com/` ... não: abra o
  app, F12 → Console → `room.iceServers` mostra a credencial do momento.

Se aparecer um candidato do tipo **relay**, está funcionando.

## Atualizar depois

```bash
cd /opt/derecord
sudo git pull
sudo npx vite build
sudo systemctl restart derecord
```

## Custo real

Zero. O Always Free não expira e não vira cobrança. O único gasto possível é o
domínio, se você optar por um pago.

## Sobre as imagens enviadas

Ficam em `/opt/derecord/uploads/` e sobrevivem a reinício. Não há limpeza
automática — para um grupo de 6 isso leva anos pra incomodar, mas se quiser
podar:

```bash
find /opt/derecord/uploads -mtime +90 -delete
```
