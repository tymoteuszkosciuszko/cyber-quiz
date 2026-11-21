#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Codzienne zarządzanie instancją Cyber Quiz w GCP (tryb on-demand)
# Użycie:
#   PROJECT_ID=cyber-quiz-prod ./deploy/gcp/vm-control.sh <start|stop|status|ssh|deploy|backup>
# Możesz też zapisać PROJECT_ID w ~/.cyber-quiz-gcp.env (opcjonalnie).
# ==============================================================================

if [ -f "${HOME}/.cyber-quiz-gcp.env" ]; then
  # shellcheck source=/dev/null
  source "${HOME}/.cyber-quiz-gcp.env"
fi

PROJECT_ID="${PROJECT_ID:?Ustaw PROJECT_ID (np. w ~/.cyber-quiz-gcp.env lub jako zmienną środowiskową)}"
ZONE="${ZONE:-europe-central2-a}"
VM_NAME="${VM_NAME:-cyber-quiz-vm}"
APP_DIR="${APP_DIR:-/opt/cyber-quiz}"
APP_DOMAIN="${APP_DOMAIN:-}"
GCS_BACKUP_BUCKET="${GCS_BACKUP_BUCKET:-}"

ACTION="${1:-}"

usage() {
  cat <<EOF
Użycie: $0 <komenda>

Komendy:
  start    Uruchamia VM, czeka na nowy ephemeral IPv4 i sprawdza /health (jeśli ustawiono APP_DOMAIN)
  stop     Zatrzymuje VM (koszt compute i IPv4 spada do \$0)
  status   Wyświetla stan VM i aktualny adres IPv4
  ssh      Łączy się z VM przez bezpieczny tunel IAP (bez publicznego portu 22)
  deploy   Aktualizuje kod na VM (git pull) i przebudowuje kontener cyber-quiz
  backup   Wykonuje zrzut bazy PostgreSQL (pg_dump) lokalnie lub do GCS_BACKUP_BUCKET
EOF
}

get_status() {
  gcloud compute instances describe "$VM_NAME" \
    --project="$PROJECT_ID" --zone="$ZONE" --format='get(status)'
}

get_ip() {
  gcloud compute instances describe "$VM_NAME" \
    --project="$PROJECT_ID" --zone="$ZONE" \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
}

case "$ACTION" in
  start)
    echo "[vm-control] Uruchamiam VM '${VM_NAME}'..."
    gcloud compute instances start "$VM_NAME" --project="$PROJECT_ID" --zone="$ZONE"
    ip="$(get_ip)"
    echo "[vm-control] VM działa. Nowy ephemeral IPv4: ${ip}"
    echo "[vm-control] Usługa cyber-quiz-dns.service zaktualizuje rekord A przy starcie (zwykle 15–45 s)."
    if [ -n "$APP_DOMAIN" ]; then
      echo "[vm-control] Czekam na gotowość https://${APP_DOMAIN}/health ..."
      for i in $(seq 1 24); do
        if curl -fsS --max-time 5 "https://${APP_DOMAIN}/health" >/dev/null 2>&1; then
          echo "[vm-control] OK! Aplikacja odpowiada pod https://${APP_DOMAIN}"
          exit 0
        fi
        sleep 5
      done
      echo "[vm-control] UWAGA: Aplikacja jeszcze nie odpowiedziała (możliwa propagacja DNS). Sprawdź ręcznie: https://${APP_DOMAIN}/health"
    fi
    ;;

  stop)
    echo "[vm-control] Zatrzymuję VM '${VM_NAME}'..."
    gcloud compute instances stop "$VM_NAME" --project="$PROJECT_ID" --zone="$ZONE"
    echo "[vm-control] VM zatrzymana. Ephemeral IPv4 został zwolniony (koszt IP i CPU = \$0)."
    ;;

  status)
    st="$(get_status)"
    ip="$(get_ip)"
    echo "VM:      ${VM_NAME} (${ZONE})"
    echo "Status:  ${st}"
    echo "IPv4:    ${ip:-brak (zatrzymana)}"
    ;;

  ssh)
    exec gcloud compute ssh "$VM_NAME" \
      --project="$PROJECT_ID" --zone="$ZONE" --tunnel-through-iap
    ;;

  deploy)
    echo "[vm-control] Wdrażam najnowszą wersję na '${VM_NAME}'..."
    gcloud compute ssh "$VM_NAME" \
      --project="$PROJECT_ID" --zone="$ZONE" --tunnel-through-iap --command \
      "sudo DEPLOY_DIR='${APP_DIR}' bash '${APP_DIR}/deploy/gcp/deploy.sh'"
    ;;

  backup)
    ts="$(date '+%Y%m%d-%H%M%S')"
    out_file="cyber-quiz-db-${ts}.sql.gz"
    echo "[vm-control] Tworzę backup PostgreSQL -> ${out_file} ..."
    gcloud compute ssh "$VM_NAME" \
      --project="$PROJECT_ID" --zone="$ZONE" --tunnel-through-iap --command \
      "sudo docker exec cyber-quiz-db sh -c 'pg_dump -U \"\${POSTGRES_USER:-cyber_quiz}\" \"\${POSTGRES_DB:-cyber_quiz}\"' | gzip -9" \
      > "$out_file"
    echo "[vm-control] Zapisano lokalny backup: ${out_file} ($(du -h "$out_file" | cut -f1))"
    if [ -n "$GCS_BACKUP_BUCKET" ]; then
      gcloud storage cp "$out_file" "${GCS_BACKUP_BUCKET%/}/${out_file}"
      echo "[vm-control] Wysłano kopię do ${GCS_BACKUP_BUCKET%/}/${out_file}"
    fi
    ;;

  *)
    usage
    exit 1
    ;;
esac

