#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Skrypt jednorazowego przygotowania zasobów w GCP (Wariant B — Ephemeral IPv4)
# Uruchom lokalnie (wymagany zalogowany `gcloud` CLI):
#   PROJECT_ID="twoj-projekt-gcp" bash deploy/gcp/provision-gcp.sh
# ==============================================================================

PROJECT_ID="${PROJECT_ID:?Ustaw zmienną PROJECT_ID (np. PROJECT_ID=cyber-quiz-prod bash deploy/gcp/provision-gcp.sh)}"
REGION="${REGION:-europe-central2}"
ZONE="${ZONE:-europe-central2-a}"
VM_NAME="${VM_NAME:-cyber-quiz-vm}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-small}"
DISK_SIZE="${DISK_SIZE:-20GB}"
DISK_TYPE="${DISK_TYPE:-pd-standard}"
NETWORK_TAG="${NETWORK_TAG:-cyber-quiz}"
SCHEDULE_NAME="${SCHEDULE_NAME:-cyber-quiz-auto-stop}"
AUTO_STOP_CRON="${AUTO_STOP_CRON:-0 23 * * *}"
TIMEZONE="${TIMEZONE:-Europe/Warsaw}"

log() {
  printf '[gcp-provision] %s\n' "$*"
}

command -v gcloud >/dev/null 2>&1 || {
  echo "BŁĄD: Nie znaleziono narzędzia 'gcloud'. Zainstaluj Google Cloud CLI." >&2
  exit 1
}

log "Ustawiam aktywny projekt: ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null

log "Włączam wymagane API (Compute Engine, IAP)..."
gcloud services enable compute.googleapis.com iap.googleapis.com --project="$PROJECT_ID"

# 1. Reguła firewalla: ruch HTTP/HTTPS (80/443) do Caddy
if ! gcloud compute firewall-rules describe allow-cyber-quiz-http-https --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "Tworzę regułę firewalla 'allow-cyber-quiz-http-https' (TCP 80, 443)..."
  gcloud compute firewall-rules create allow-cyber-quiz-http-https \
    --project="$PROJECT_ID" \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443,udp:443 \
    --source-ranges=0.0.0.0/0 \
    --target-tags="$NETWORK_TAG"
else
  log "Reguła firewalla 'allow-cyber-quiz-http-https' już istnieje."
fi

# 2. Reguła firewalla: SSH wyłącznie przez Identity-Aware Proxy (bez wystawiania portu 22 na świat)
if ! gcloud compute firewall-rules describe allow-cyber-quiz-ssh-iap --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "Tworzę regułę firewalla 'allow-cyber-quiz-ssh-iap' (TCP 22 z zakresu IAP)..."
  gcloud compute firewall-rules create allow-cyber-quiz-ssh-iap \
    --project="$PROJECT_ID" \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 \
    --target-tags="$NETWORK_TAG"
else
  log "Reguła firewalla 'allow-cyber-quiz-ssh-iap' już istnieje."
fi

# 3. Utworzenie VM (ephemeral IPv4 + Network Tier STANDARD = najniższy koszt)
if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "Tworzę VM '${VM_NAME}' (${MACHINE_TYPE}, ${DISK_SIZE} ${DISK_TYPE}, ${ZONE}, ephemeral IPv4)..."
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT_ID" \
    --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --boot-disk-size="$DISK_SIZE" \
    --boot-disk-type="$DISK_TYPE" \
    --network-tier=STANDARD \
    --tags="$NETWORK_TAG" \
    --metadata=enable-oslogin=TRUE
else
  log "VM '${VM_NAME}' już istnieje w strefie ${ZONE}."
fi

# 4. Bezpiecznik kosztowy: automatyczne zatrzymywanie VM codziennie o 23:00 (Europe/Warsaw)
if ! gcloud compute resource-policies describe "$SCHEDULE_NAME" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "Tworzę harmonogram automatycznego zatrzymywania '${SCHEDULE_NAME}' (${AUTO_STOP_CRON} ${TIMEZONE})..."
  gcloud compute resource-policies create instance-schedule "$SCHEDULE_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --description="Automatyczne wyłączanie Cyber Quiz VM (bezpiecznik kosztowy)" \
    --vm-stop-schedule="$AUTO_STOP_CRON" \
    --timezone="$TIMEZONE"
else
  log "Harmonogram '${SCHEDULE_NAME}' już istnieje."
fi

log "Przypinam harmonogram '${SCHEDULE_NAME}' do VM '${VM_NAME}'..."
gcloud compute instances add-resource-policies "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --resource-policies="$SCHEDULE_NAME" 2>/dev/null || true

EXT_IP="$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT_ID" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

cat <<EOF

========================================================================
Zasoby GCP zostały przygotowane!
  Projekt:      ${PROJECT_ID}
  VM:           ${VM_NAME} (${ZONE}, ${MACHINE_TYPE})
  Aktualny IP:  ${EXT_IP} (ephemeral — zmienia się po stop/start)
  Auto-stop:    ${AUTO_STOP_CRON} (${TIMEZONE})

Następne kroki:
  1. Połącz się z VM przez IAP:
       gcloud compute ssh ${VM_NAME} --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap
  2. Sklonuj repozytorium do /opt/cyber-quiz i uruchom:
       sudo bash /opt/cyber-quiz/deploy/gcp/vm-setup.sh
  3. Uzupełnij /etc/cyber-quiz/dns.env oraz /opt/cyber-quiz/.env
  4. Zbuduj i uruchom stack:
       cd /opt/cyber-quiz && docker compose -f docker-compose.gcp.yml up -d --build
  5. Pamiętaj też o ustawieniu Budget Alert w konsoli GCP Billing (np. 5 USD).
========================================================================
EOF

