# Wdrożenie Cyber Quiz na GCP (Wariant B — On-Demand + Ephemeral IPv4 + Auto-DNS)

Ten zestaw plików wdraża cały stack (`cyber-quiz` + `postgres:16-alpine` + `redis:7-alpine` + `caddy:2-alpine`) na jednej maszynie **Compute Engine (`e2-small`, `europe-central2`)** z automatycznym HTTPS (Let's Encrypt) oraz automatyczną aktualizacją rekordu `A` w DNS przy każdym starcie VM.

Gdy VM jest zatrzymana, płacisz **wyłącznie za dysk 20 GB (~$0,96/mies.)** — ephemeral IPv4 i CPU kosztują w tym czasie **$0**.

## Zawartość katalogu

- `docker-compose.gcp.yml` *(w katalogu głównym repozytorium)* — stack produkcyjny z Caddy i izolowaną siecią dla bazy i Redisa.
- `deploy/gcp/Caddyfile` — konfiguracja reverse proxy HTTPS + WebSocket (`/socket.io/`).
- `deploy/gcp/.env.example` — szablon zmiennych środowiskowych aplikacji.
- `deploy/gcp/dns.env.example` — szablon konfiguracji API DNS (Cloudflare lub dowolny webhook / DynHost).
- `deploy/gcp/update-dns.sh` — skrypt aktualizujący rekord `A` aktualnym publicznym IPv4 z GCP Metadata Server.
- `deploy/gcp/cyber-quiz-dns.service` — usługa `systemd` uruchamiająca `update-dns.sh` przed startem Dockera/Caddy.
- `deploy/gcp/provision-gcp.sh` — jednorazowe utworzenie VM, firewalla (HTTP/HTTPS + SSH przez IAP) i harmonogramu auto-stop w GCP.
- `deploy/gcp/vm-setup.sh` — jednorazowa instalacja Dockera, 2 GB swapu i usługi DNS na VM.
- `deploy/gcp/vm-control.sh` — lokalny skrypt do codziennego `start` / `stop` / `status` / `ssh` / `deploy` / `backup`.

---

## Instrukcja wdrożenia krok po kroku

### 1. Utworzenie zasobów w GCP (lokalnie)

Wymagane: zainstalowane i zalogowane `gcloud` CLI (`gcloud auth login`).

```bash
PROJECT_ID="twoj-projekt-gcp" bash deploy/gcp/provision-gcp.sh
```

Skrypt utworzy:
- VM `cyber-quiz-vm` (`e2-small`, Debian 12, 20 GB `pd-standard`, `europe-central2-a`, Network Tier `STANDARD`, ephemeral IPv4),
- reguły firewalla: `TCP 80/443` z internetu oraz `TCP 22` **wyłącznie z zakresu IAP** (port SSH nie jest wystawiony publicznie),
- harmonogram **auto-stop** codziennie o `23:00` (`Europe/Warsaw`) jako bezpiecznik kosztowy.

> W konsoli GCP (*Billing → Budgets & alerts*) ustaw dodatkowo alert budżetowy (np. 5 USD).

### 2. Jednorazowa konfiguracja VM (przez SSH/IAP)

Połącz się z VM:

```bash
gcloud compute ssh cyber-quiz-vm --zone=europe-central2-a --project=twoj-projekt-gcp --tunnel-through-iap
```

Sklonuj repozytorium i uruchom `vm-setup.sh`:

```bash
sudo mkdir -p /opt/cyber-quiz && sudo chown "$USER:$USER" /opt/cyber-quiz
git clone <URL_TWOJEGO_REPO> /opt/cyber-quiz
sudo bash /opt/cyber-quiz/deploy/gcp/vm-setup.sh
```

### 3. Konfiguracja auto-DNS i zmiennych aplikacji na VM

1. Uzupełnij dane API DNS (np. token Cloudflare z uprawnieniem `Zone -> DNS -> Edit`):
   ```bash
   sudo nano /etc/cyber-quiz/dns.env
   ```
2. Przetestuj ręcznie aktualizację rekordu `A`:
   ```bash
   sudo FORCE_DNS_UPDATE=1 /opt/cyber-quiz/deploy/gcp/update-dns.sh
   ```
3. Uzupełnij domenę, e-mail ACME i losowe hasło PostgreSQL w `/opt/cyber-quiz/.env`:
   ```bash
   nano /opt/cyber-quiz/.env
   ```

### 4. Pierwsze uruchomienie i bootstrap superadmina

```bash
cd /opt/cyber-quiz
sudo docker compose -f docker-compose.gcp.yml up -d --build
```

Sprawdź healthcheck (po ok. 30 s, gdy Caddy pobierze certyfikat Let's Encrypt):

```bash
curl -fsS https://quiz.twojadomena.pl/health
```

Utwórz konto `superadmin` (jednorazowo):

```bash
sudo docker exec -it cyber-quiz node scripts/bootstrap-superadmin.mjs
```

Następnie zaloguj się na `https://quiz.twojadomena.pl/game-admin` i zarejestruj klucze MFA (YubiKey / Touch ID).

---

## Codzienna obsługa on-demand (lokalnie)

Opcjonalnie zapisz ustawienia w `~/.cyber-quiz-gcp.env`:

```bash
cat <<'EOF' > ~/.cyber-quiz-gcp.env
PROJECT_ID=twoj-projekt-gcp
ZONE=europe-central2-a
VM_NAME=cyber-quiz-vm
APP_DOMAIN=quiz.twojadomena.pl
EOF
```

Następnie używaj:

```bash
./deploy/gcp/vm-control.sh start    # włącza VM, aktualizuje DNS i czeka na /health
./deploy/gcp/vm-control.sh stop     # wyłącza VM (koszt CPU + IP spada do $0)
./deploy/gcp/vm-control.sh status   # stan VM i aktualny IP
./deploy/gcp/vm-control.sh ssh      # połączenie SSH przez IAP
./deploy/gcp/vm-control.sh deploy   # pobiera kod z main i przebudowuje kontener
./deploy/gcp/vm-control.sh backup   # zapisuje lokalny backup PostgreSQL (.sql.gz)
```

