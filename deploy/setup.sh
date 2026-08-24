#!/usr/bin/env bash
#
# Instala o derecord numa VM Ubuntu do Oracle Cloud Always Free.
# Rode como root na VM:  sudo bash setup.sh SEU.DOMINIO.COM
#
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "uso: sudo bash setup.sh seu.dominio.com" >&2
  exit 1
fi

APP_DIR=/opt/derecord
APP_USER=derecord

echo "==> pacotes"
apt-get update -qq
apt-get install -y curl git coturn ufw

# Node 20 pelo repositório oficial (o do Ubuntu costuma ser velho demais)
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Caddy: é ele que tira o certificado HTTPS sozinho, sem certbot nem cron
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
fi

echo "==> usuário e diretório"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

# O segredo do TURN é gerado uma vez e reaproveitado nas próximas execuções.
ENV_FILE=/etc/derecord.env
if [ ! -f "$ENV_FILE" ]; then
  TURN_SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
PORT=8787
TURN_HOST=$DOMAIN
TURN_SECRET=$TURN_SECRET
EOF
  chmod 600 "$ENV_FILE"
  echo "    segredo do TURN gerado em $ENV_FILE"
else
  TURN_SECRET="$(grep '^TURN_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  echo "    reaproveitando o segredo já existente"
fi

echo "==> build"
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev
npm install --no-save vite @vitejs/plugin-react typescript @types/react @types/react-dom
npx vite build
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> coturn"
cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint

# Credencial temporária: o servidor do app assina, o coturn confere.
# Não existe lista de usuários — é o mesmo segredo dos dois lados.
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN

# O Caddy já cuida do certificado deste domínio; o coturn reusa o mesmo.
cert=/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN/$DOMAIN.crt
pkey=/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN/$DOMAIN.key

# Sem isto o TURN vira um relay aberto pra rede interna da Oracle.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=169.254.0.0-169.254.255.255

# Grupo pequeno: não precisa de mais que isso, e limita abuso.
user-quota=12
total-quota=100
EOF

# A VM da Oracle só enxerga o IP privado; o coturn precisa saber o público.
PUBLIC_IP="$(curl -s --max-time 5 https://api.ipify.org || true)"
PRIVATE_IP="$(hostname -I | awk '{print $1}')"
if [ -n "$PUBLIC_IP" ]; then
  echo "external-ip=$PUBLIC_IP/$PRIVATE_IP" >> /etc/turnserver.conf
  echo "    external-ip=$PUBLIC_IP/$PRIVATE_IP"
fi

sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
usermod -aG caddy turnserver 2>/dev/null || true

echo "==> Caddy"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip

	# O WebSocket precisa passar sem buffer nenhum.
	reverse_proxy localhost:8787
}
EOF

echo "==> systemd"
cp "$APP_DIR/deploy/derecord.service" /etc/systemd/system/derecord.service
systemctl daemon-reload
systemctl enable --now derecord
systemctl restart caddy
systemctl enable --now coturn
systemctl restart coturn

echo "==> firewall da VM"
# ATENÇÃO: isto libera só o firewall de DENTRO da VM.
# As mesmas portas precisam ser abertas TAMBÉM na Security List da VCN,
# no painel da Oracle. Esquecer disso é o erro nº 1 do Oracle Cloud.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
ufw --force enable

# O Ubuntu da Oracle vem com regras iptables próprias que o ufw não substitui.
iptables -I INPUT -p udp --dport 3478 -j ACCEPT
iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
iptables -I INPUT -p tcp --dport 5349 -j ACCEPT
iptables -I INPUT -p udp --dport 49152:65535 -j ACCEPT
netfilter-persistent save 2>/dev/null || true

echo
echo "pronto: https://$DOMAIN"
echo
echo "FALTA FAZER NO PAINEL DA ORACLE (Networking > VCN > Security List):"
echo "  TCP  80, 443, 3478, 5349"
echo "  UDP  3478, 49152-65535"
echo "sem isso o site não abre e a chamada não conecta."
