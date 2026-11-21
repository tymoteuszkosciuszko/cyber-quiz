#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Jednorazowa konfiguracja środowiska na VM w GCP (Debian 12 / Ubuntu 24.04)
# Uruchom na VM jako root:
#   sudo bash /opt/cyber-quiz/deploy/gcp/vm-setup.sh
# ==============================================================================

APP_DIR="${APP_DIR:-/opt/cyber-quiz}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"

log() {
  printf '[vm-setup] %s\n' "$*"
}

[ "$(id -u)" -eq 0 ] || {
  echo "BŁĄD: Uruchom skrypt z uprawnieniami root (sudo)." >&2
  exit 1
}

# 1. Pakiety bazowe
log "Aktualizacja indeksów apt i instalacja narzędzi bazowych..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg git jq

# 2. Instalacja Docker Engine + Docker Compose plugin
if ! command -v docker >/dev/null 2>&1; then
  log "Instalacja Docker Engine + Docker Compose plugin..."
  install -m 0755 -d /etc/apt/keyrings
  . /etc/os-release
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} \
    ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker jest już zainstalowany."
fi

systemctl enable --now docker

# Dodaj użytkownika wywołującego sudo do grupy docker
if [ -n "${SUDO_USER:-}" ] && id "$SUDO_USER" >/dev/null 2>&1; then
  usermod -aG docker "$SUDO_USER" || true
  log "Dodano użytkownika '${SUDO_USER}' do grupy docker (zaloguj się ponownie, aby zadziałało bez sudo)."
fi

# 3. Plik swap 2 GB (bezpiecznik dla docker build / Vite i Argon2id na e2-small 2 GB RAM)
if [ ! -f /swapfile ]; then
  log "Tworzenie pliku swap (${SWAP_SIZE_MB} MB)..."
  fallocate -l "${SWAP_SIZE_MB}M" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_SIZE_MB"
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  sysctl -w vm.swappiness=10 >/dev/null
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-cyber-quiz-swap.conf
else
  log "Plik /swapfile już istnieje."
fi

# 4. Instalacja usługi systemd do auto-aktualizacji DNS przy starcie VM
if [ -d "${APP_DIR}/deploy/gcp" ]; then
  chmod +x "${APP_DIR}/deploy/gcp/update-dns.sh"
  cp "${APP_DIR}/deploy/gcp/cyber-quiz-dns.service" /etc/systemd/system/cyber-quiz-dns.service
  systemctl daemon-reload
  systemctl enable cyber-quiz-dns.service
  log "Zainstalowano i włączono usługę cyber-quiz-dns.service."

  install -d -m 700 /etc/cyber-quiz
  if [ ! -f /etc/cyber-quiz/dns.env ]; then
    cp "${APP_DIR}/deploy/gcp/dns.env.example" /etc/cyber-quiz/dns.env
    chmod 600 /etc/cyber-quiz/dns.env
    log "Utworzono szablon /etc/cyber-quiz/dns.env — uzupełnij go swoimi danymi API DNS!"
  fi

  if [ ! -f "${APP_DIR}/.env" ]; then
    cp "${APP_DIR}/deploy/gcp/.env.example" "${APP_DIR}/.env"
    chmod 600 "${APP_DIR}/.env"
    if [ -n "${SUDO_USER:-}" ]; then
      chown "${SUDO_USER}:${SUDO_USER}" "${APP_DIR}/.env"
    fi
    log "Utworzono szablon ${APP_DIR}/.env — uzupełnij domenę i silne POSTGRES_PASSWORD!"
  fi
else
  log "UWAGA: Nie znaleziono katalogu ${APP_DIR}/deploy/gcp — sklonuj repozytorium do ${APP_DIR} i uruchom skrypt ponownie."
fi

cat <<EOF

========================================================================
Konfiguracja VM zakończona!
Następne kroki na VM:
  1. Uzupełnij konfigurację DNS (token API):
       sudo nano /etc/cyber-quiz/dns.env
  2. Przetestuj aktualizację DNS ręcznie:
       sudo FORCE_DNS_UPDATE=1 /opt/cyber-quiz/deploy/gcp/update-dns.sh
  3. Uzupełnij plik środowiskowy aplikacji (domena, hasło Postgresa):
       nano ${APP_DIR}/.env
  4. Zbuduj i uruchom aplikację:
       cd ${APP_DIR} && sudo docker compose -f docker-compose.gcp.yml up -d --build
  5. Utwórz konto superadmina (jednorazowo):
       sudo docker exec -it cyber-quiz node scripts/bootstrap-superadmin.mjs
========================================================================
EOF

