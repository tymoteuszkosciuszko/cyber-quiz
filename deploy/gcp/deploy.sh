#!/usr/bin/env bash
set -Eeuo pipefail

# Skrypt wdrożeniowy uruchamiany na VM w GCP (przez GitHub Actions lub ręcznie):
#   sudo bash /opt/cyber-quiz/deploy/gcp/deploy.sh

DEPLOY_DIR="${DEPLOY_DIR:-/opt/cyber-quiz}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.gcp.yml}"
APP_CONTAINER="${APP_CONTAINER:-cyber-quiz}"
CADDY_CONTAINER="${CADDY_CONTAINER:-cyber-quiz-caddy}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

log() {
  printf '[deploy-gcp %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '[deploy-gcp %s] BŁĄD: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

# 1. Walidacja katalogu i narzędzi
[ -d "$DEPLOY_DIR" ] || fail "Katalog wdrożeniowy nie istnieje: $DEPLOY_DIR"
cd "$DEPLOY_DIR"

[ -d .git ] || fail "Katalog $DEPLOY_DIR nie jest repozytorium Git."
[ -f "$COMPOSE_FILE" ] || fail "Brak pliku $COMPOSE_FILE w $DEPLOY_DIR."

command -v git >/dev/null 2>&1 || fail "Nie znaleziono polecenia 'git'."
command -v docker >/dev/null 2>&1 || fail "Nie znaleziono polecenia 'docker'."
docker compose version >/dev/null 2>&1 || fail "Nie znaleziono wtyczki 'docker compose'."

if [ ! -f .env ]; then
  fail "Brak pliku .env w $DEPLOY_DIR — utwórz go na bazie deploy/gcp/.env.example."
fi

# 2. Oczekiwanie na gotowość demona Docker (istotne tuż po starcie VM on-demand)
docker_deadline=$((SECONDS + 60))
while ! docker info >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$docker_deadline" ]; then
    fail "Demon Docker nie uruchomił się w ciągu 60s."
  fi
  log "Oczekiwanie na uruchomienie demona Docker..."
  sleep 2
done

# 3. Aktualizacja kodu z origin/<BRANCH> jako właściciel katalogu (unika błędów 'dubious ownership' i zachowuje klucze SSH Git)
REPO_OWNER="$(stat -c '%U' "$DEPLOY_DIR")"
run_git() {
  if [ "$(id -u)" -eq 0 ] && [ "$REPO_OWNER" != "root" ] && id "$REPO_OWNER" >/dev/null 2>&1; then
    sudo -u "$REPO_OWNER" -H git -C "$DEPLOY_DIR" "$@"
  else
    git -C "$DEPLOY_DIR" "$@"
  fi
}

log "Pobieranie najnowszych zmian z origin/${BRANCH} (właściciel repo: ${REPO_OWNER})..."
run_git fetch --prune origin "$BRANCH"
run_git checkout "$BRANCH"
run_git reset --hard "origin/${BRANCH}"

COMMIT_SHA="$(run_git rev-parse --short HEAD)"
COMMIT_MSG="$(run_git log -1 --pretty=%s)"
log "Wdrażana wersja: ${COMMIT_SHA} (${COMMIT_MSG})"

# 4. Budowa nowego obrazu i odtworzenie kontenera aplikacji
log "Budowanie nowego obrazu Docker (${COMPOSE_FILE})..."
docker compose -f "$COMPOSE_FILE" build

log "Uruchamianie stosu i odtwarzanie kontenera '${APP_CONTAINER}'..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps "$APP_CONTAINER"

# 5. Oczekiwanie na status 'healthy' aplikacji cyber-quiz
log "Oczekiwanie na healthcheck kontenera '${APP_CONTAINER}' (limit: ${HEALTH_TIMEOUT}s)..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
status="starting"

while [ "$SECONDS" -lt "$deadline" ]; do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || echo 'missing')"
  if [ "$status" = "healthy" ]; then
    break
  fi
  if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
    log "Kontener '${APP_CONTAINER}' zgłosił stan: ${status}. Ostatnie logi:"
    docker logs --tail 50 "$APP_CONTAINER" || true
    fail "Kontener '${APP_CONTAINER}' nie przeszedł kontroli zdrowia."
  fi
  sleep 2
done

if [ "$status" != "healthy" ]; then
  log "Przekroczono limit czasu oczekiwania na '${APP_CONTAINER}' (ostatni stan: ${status}). Ostatnie logi:"
  docker logs --tail 50 "$APP_CONTAINER" || true
  fail "Timeout podczas uruchamiania '${APP_CONTAINER}'."
fi

log "Kontener '${APP_CONTAINER}' działa poprawnie (status: healthy)."

# 6. Przeładowanie konfiguracji Caddy (bez przerywania połączeń i bez utraty certyfikatów TLS)
if docker container inspect "$CADDY_CONTAINER" >/dev/null 2>&1; then
  caddy_state="$(docker inspect --format='{{.State.Status}}' "$CADDY_CONTAINER" 2>/dev/null || echo 'unknown')"
  if [ "$caddy_state" != "running" ]; then
    log "Kontener '${CADDY_CONTAINER}' nie działa (${caddy_state}) — uruchamiam..."
    docker compose -f "$COMPOSE_FILE" up -d "$CADDY_CONTAINER"
  else
    log "Przeładowywanie konfiguracji Caddy..."
    docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  fi
  log "Kontener '${CADDY_CONTAINER}' działa poprawnie."
else
  fail "Kontener '${CADDY_CONTAINER}' nie został znaleziony."
fi

# 7. Porządkowanie starych warstw obrazów (oszczędność miejsca na dysku 20 GB)
log "Czyszczenie nieużywanych obrazów Docker (dangling)..."
docker image prune -f >/dev/null || true

log "Wdrożenie na GCP zakończone sukcesem! Wersja: ${COMMIT_SHA}."

