#!/usr/bin/env bash
set -Eeuo pipefail

# Skrypt wdrożeniowy uruchamiany na serwerze docelowym (np. 2115.2115.xyz)
# przez GitHub Actions lub ręcznie:
#   bash scripts/deploy.sh

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/containers/cyber-quiz}"
DEPLOY_DIR="${DEPLOY_DIR/#\~/$HOME}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
APP_CONTAINER="${APP_CONTAINER:-cyber-quiz}"
SWAG_CONTAINER="${SWAG_CONTAINER:-swag}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

log() {
  printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '[deploy %s] BŁĄD: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
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
  log "UWAGA: Brak pliku .env w $DEPLOY_DIR — używane będą wartości domyślne z $COMPOSE_FILE."
fi

# 2. Aktualizacja kodu z origin/<BRANCH> (bez naruszania nieśledzonego .env)
log "Pobieranie najnowszych zmian z origin/${BRANCH}..."
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"

COMMIT_SHA="$(git rev-parse --short HEAD)"
COMMIT_MSG="$(git log -1 --pretty=%s)"
log "Wdrażana wersja: ${COMMIT_SHA} (${COMMIT_MSG})"

# 3. Budowa nowego obrazu i uruchomienie / restart kontenera cyber-quiz
log "Budowanie nowego obrazu Docker (${COMPOSE_FILE})..."
docker compose -f "$COMPOSE_FILE" build

log "Uruchamianie stosu i odtwarzanie kontenera '${APP_CONTAINER}'..."
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps "$APP_CONTAINER"

# 4. Oczekiwanie na status 'healthy' aplikacji cyber-quiz
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

# 5. Restart kontenera SWAG (odświeżenie upstreamu / IP kontenera w Nginx)
if docker container inspect "$SWAG_CONTAINER" >/dev/null 2>&1; then
  log "Restartowanie kontenera '${SWAG_CONTAINER}'..."
  docker restart "$SWAG_CONTAINER" >/dev/null
  swag_state="$(docker inspect --format='{{.State.Status}}' "$SWAG_CONTAINER" 2>/dev/null || echo 'unknown')"
  if [ "$swag_state" != "running" ]; then
    fail "Kontener '${SWAG_CONTAINER}' nie uruchomił się poprawnie (stan: ${swag_state})."
  fi
  log "Kontener '${SWAG_CONTAINER}' zrestartowany (stan: ${swag_state})."
else
  fail "Kontener '${SWAG_CONTAINER}' nie został znaleziony na serwerze."
fi

# 6. Porządkowanie starych, nieużywanych warstw obrazów
log "Czyszczenie nieużywanych obrazów Docker (dangling)..."
docker image prune -f >/dev/null || true

log "Wdrożenie zakończone sukcesem! Wersja: ${COMMIT_SHA}."
