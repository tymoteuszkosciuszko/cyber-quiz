#!/usr/bin/env bash
set -Eeuo pipefail

# Automatyczna aktualizacja rekordu A w DNS na podstawie aktualnego ephemeral IPv4 VM w GCP.
# Uruchamiany przy starcie systemu przez cyber-quiz-dns.service (przed startem Dockera/Caddy).

CONFIG_FILE="${DNS_CONFIG_FILE:-/etc/cyber-quiz/dns.env}"
STATE_FILE="/var/lib/cyber-quiz-last-ip"

log() {
  printf '[cyber-quiz-dns %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '[cyber-quiz-dns %s] BŁĄD: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

if [ ! -f "$CONFIG_FILE" ]; then
  log "Brak pliku konfiguracyjnego $CONFIG_FILE — pomijam aktualizację DNS."
  exit 0
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

DNS_PROVIDER="${DNS_PROVIDER:-}"
[ -n "$DNS_PROVIDER" ] || fail "Zmienna DNS_PROVIDER nie jest ustawiona w $CONFIG_FILE."

get_external_ip() {
  local ip=""
  # 1. Preferowane źródło: GCP Metadata Server (lokalne, natychmiastowe)
  ip="$(curl -fsS --max-time 5 -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" 2>/dev/null || true)"
  # 2. Fallback: zewnętrzny serwis
  if [ -z "$ip" ]; then
    ip="$(curl -fsS --max-time 5 "https://api.ipify.org" 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}

# Krótka pętla retry (sieć na starcie VM może potrzebować kilku sekund)
CURRENT_IP=""
for attempt in 1 2 3 4 5; do
  CURRENT_IP="$(get_external_ip)"
  if [[ "$CURRENT_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    break
  fi
  log "Próba $attempt/5: nie udało się pobrać publicznego IPv4, czekam 3s..."
  sleep 3
done

[[ "$CURRENT_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Nie udało się ustalić poprawnego adresu IPv4."

LAST_IP=""
if [ -f "$STATE_FILE" ]; then
  LAST_IP="$(cat "$STATE_FILE" 2>/dev/null || true)"
fi

if [ "$CURRENT_IP" = "$LAST_IP" ] && [ "${FORCE_DNS_UPDATE:-0}" != "1" ]; then
  log "Adres IP ($CURRENT_IP) nie zmienił się od ostatniego uruchomienia — pomijam."
  exit 0
fi

log "Aktualizacja DNS ($DNS_PROVIDER) -> $CURRENT_IP (poprzedni: ${LAST_IP:-brak})..."

update_cloudflare() {
  command -v jq >/dev/null 2>&1 || fail "Brak narzędzia 'jq' wymaganego dla Cloudflare."
  : "${CF_API_TOKEN:?Ustaw CF_API_TOKEN w $CONFIG_FILE}"
  : "${CF_ZONE_ID:?Ustaw CF_ZONE_ID w $CONFIG_FILE}"
  : "${CF_RECORD_NAME:?Ustaw CF_RECORD_NAME w $CONFIG_FILE}"
  local ttl="${CF_TTL:-60}"
  local proxied="${CF_PROXIED:-false}"

  local api_base="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records"

  local lookup_resp
  lookup_resp="$(curl -fsS --max-time 15 \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${api_base}?type=A&name=${CF_RECORD_NAME}")"

  local success
  success="$(printf '%s' "$lookup_resp" | jq -r '.success')"
  [ "$success" = "true" ] || fail "Błąd odczytu rekordu Cloudflare: $lookup_resp"

  local record_id
  record_id="$(printf '%s' "$lookup_resp" | jq -r '.result[0].id // empty')"

  local payload
  payload="$(jq -n \
    --arg type "A" \
    --arg name "$CF_RECORD_NAME" \
    --arg content "$CURRENT_IP" \
    --argjson ttl "$ttl" \
    --argjson proxied "$proxied" \
    '{type: $type, name: $name, content: $content, ttl: $ttl, proxied: $proxied}')"

  local write_resp
  if [ -n "$record_id" ]; then
    write_resp="$(curl -fsS --max-time 15 -X PUT \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload" \
      "${api_base}/${record_id}")"
  else
    log "Rekord A dla ${CF_RECORD_NAME} nie istnieje — tworzę nowy."
    write_resp="$(curl -fsS --max-time 15 -X POST \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$payload" \
      "${api_base}")"
  fi

  local write_ok
  write_ok="$(printf '%s' "$write_resp" | jq -r '.success')"
  [ "$write_ok" = "true" ] || fail "Błąd zapisu rekordu Cloudflare: $write_resp"

  log "Cloudflare: rekord A ${CF_RECORD_NAME} -> ${CURRENT_IP} (TTL=${ttl}, proxied=${proxied}) zaktualizowany."
}

update_custom_webhook() {
  : "${CUSTOM_WEBHOOK_URL:?Ustaw CUSTOM_WEBHOOK_URL w $CONFIG_FILE}"
  local method="${CUSTOM_WEBHOOK_METHOD:-GET}"
  local url="${CUSTOM_WEBHOOK_URL//\{IP\}/$CURRENT_IP}"

  local curl_args=(-fsS --max-time 15 -X "$method")
  if [ -n "${CUSTOM_WEBHOOK_AUTH:-}" ]; then
    curl_args+=(-u "$CUSTOM_WEBHOOK_AUTH")
  fi
  if [ -n "${CUSTOM_WEBHOOK_HEADER:-}" ]; then
    curl_args+=(-H "$CUSTOM_WEBHOOK_HEADER")
  fi

  local resp
  resp="$(curl "${curl_args[@]}" "$url")"
  log "Webhook DNS zakończony sukcesem (odpowiedź: ${resp:0:120})."
}

case "$DNS_PROVIDER" in
  cloudflare)
    update_cloudflare
    ;;
  custom_webhook)
    update_custom_webhook
    ;;
  *)
    fail "Nieobsługiwany DNS_PROVIDER: '$DNS_PROVIDER' (dozwolone: cloudflare, custom_webhook)."
    ;;
esac

printf '%s\n' "$CURRENT_IP" > "$STATE_FILE"
log "Zapisano stan IP w $STATE_FILE."

