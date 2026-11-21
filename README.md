# Cyber Quiz

[![en](https://img.shields.io/badge/README-EN-blue.svg)](README.en.md)

Platforma do interaktywnych quizów wieloosobowych czasu rzeczywistego z interfejsem w stylu **Neobrutalism** (React + Vite + Tailwind CSS, Node.js + Socket.IO + Redis), zoptymalizowana pod **200+ jednoczesnych graczy** w jednej sesji.

## Architektura

```
┌───────────────────────────┐       WebSocket / REST       ┌──────────────────────┐     Hashes / ZSET     ┌─────────┐
│  React + Vite + Tailwind  │ ◄──────────────────────────► │  Node.js + Express   │ ◄───────────────────► │  Redis  │
│  "/"          Gracz       │   Socket.IO + /api/quizzes   │  + Socket.IO         │   HSETNX / ZINCRBY    │  7-alp  │
│  "/game-admin" Prowadzący │                              │  port 3001           │   ZSCORE / ZREVRANGE  │  :6379  │
│  "/game-screen" Rzutnik   │                              │  (+ static UI prod)  │                       └─────────┘
└───────────────────────────┘                              └──────────────────────┘
```

### Widoki aplikacji (routing SPA)

| Ścieżka | Rola | Opis |
|---|---|---|
| `/` | **Gracz (smartfon)** | Dołączanie kodem PIN lub przez kod QR (`/?pin=XXXXXX`), odliczanie, podgląd pytania (przyciski zablokowane), 4-przyciskowy pad odpowiedzi (`A/B/C/D`), wynik rundy i pozycja końcowa |
| `/game-admin` | **Panel Admina i Prowadzącego** | Baza quizów (tworzenie, edycja, usuwanie, import/eksport JSON) oraz sterowanie sesją na żywo: otwieranie okna rzutnika, start gry, pomijanie faz, pauza/wznowienie auto-przejścia, przerywanie gry, podgląd poprawnej odpowiedzi i pełnych wyników |
| `/game-screen?pin=XXXXXX` | **Ekran gry (rzutnik)** | Osobne okno prezentacyjne z trybem pełnoekranowym: lobby z kodem QR i PIN-em, 5-sekundowy podgląd treści pytania przed ujawnieniem odpowiedzi, kaskadowe karty odpowiedzi, animowany rozkład głosów i Top 5, sekwencyjne podium (`3 → 2 → 1`) oraz przewijana lista wszystkich wyników |

## Wymagania

- **Node.js** 18+ (w obrazie Docker używany jest Node 22 Alpine)
- **Docker** i **Docker Compose** (dla Redis w trybie deweloperskim lub całego stacku w produkcji)

## Uruchomienie lokalne (tryb deweloperski)

### 1. Uruchom Redis i PostgreSQL
```bash
docker compose up -d
```

### 2. Utwórz jedyne konto superadmina (jednorazowo)
```bash
cd server
npm install    # tylko za pierwszym razem
npm run bootstrap-superadmin
```
Skrypt interaktywnie zapyta o login i silne hasło (min. 12 znaków). W razie potrzeby hasło superadmina można awaryjnie zresetować z poziomu serwera poleceniem `npm run reset-superadmin`.

### 3. Uruchom backend
```bash
npm run dev    # lub: npm start
```
Serwer nasłuchuje domyślnie na porcie `3001` (`0.0.0.0`), łączy się z Redisem pod `127.0.0.1:6379` oraz PostgreSQL pod `127.0.0.1:5432` (automatycznie wykonując migracje i seed 3 wbudowanych szablonów quizów).

### 4. Uruchom frontend
W nowym terminalu:
```bash
cd client
npm install    # tylko za pierwszym razem
npm run dev
```
Vite uruchamia serwer deweloperski na porcie `5173` z flagą `--host` (dostępny w sieci lokalnej).

### 5. Otwórz w przeglądarce

- **Panel Prowadzącego / Edytor quizów (wymaga logowania):** `http://localhost:5173/game-admin`
- **Ekran gry (rzutnik, publiczny):** otwiera się automatycznie w nowym oknie po utworzeniu pokoju albo pod `http://localhost:5173/game-screen?pin=XXXXXX`
- **Smartfon gracza (publiczny):** zeskanuj kod QR z ekranu gry lub otwórz `http://<IP_SIECI>:5173/?pin=XXXXXX`

## Bezpieczeństwo i konta administratorów (OWASP ASVS)

Panel `/game-admin`, wszystkie endpointy `/api/*` oraz zdarzenia prowadzącego Socket.IO (`host_*`) są chronione wbudowanym systemem uwierzytelniania i kontroli dostępu:

- **Role:**
  - `superadmin` (twardy limit **jednego konta** wymuszony unikalnym indeksem częściowym w PostgreSQL): pełny dostęp + zakładka **Admini i Audyt** (tworzenie kont `admin` z jednorazowym hasłem tymczasowym, dezaktywacja z natychmiastowym odcięciem sesji, reset haseł, usuwanie, dziennik `audit_logs`).
  - `admin`: zarządzanie wyłącznie własnymi quizami (izolacja per użytkownik + możliwość uruchamiania i klonowania wbudowanych szablonów) oraz prowadzenie własnych sesji gry.
- **Mechanizmy bezpieczeństwa:** hashowanie haseł **Argon2id**, polityka haseł min. 12 znaków (NFKC + lista słabych haseł), sesje serwerowe w Redisie (256-bitowe `sid` w ciasteczku `HttpOnly` / `Secure` / `SameSite=Lax` / prefiks `__Host-`), ochrona **CSRF** (`X-CSRF-Token` + weryfikacja `Origin`), progresywny lockout i rate-limiting IP, nagłówki `helmet` (CSP, HSTS, `nosniff`) oraz walidacja właściciela pokoju gry w Socket.IO.
- **Bootstrap na produkcji (Docker):**
  ```bash
  docker exec -it cyber-quiz node scripts/bootstrap-superadmin.mjs
  ```
- **Zmiana loginu i/lub awaryjny reset hasła superadmina (SSH):**
  ```bash
  docker exec -it cyber-quiz node scripts/reset-superadmin.mjs
  # lub zmiana samego loginu:
  docker exec -it cyber-quiz node scripts/reset-superadmin.mjs --username nowy_login --keep-password
  ```

## Wdrożenie produkcyjne (Docker + SWAG)

W trybie produkcyjnym wieloetapowy [`Dockerfile`](Dockerfile) buduje frontend (`client/dist`) i serwuje go bezpośrednio z serwera Express na porcie `3001` razem z API REST, WebSocketami i endpointem `/health`.

### Budowanie i uruchomienie przez Docker Compose

Plik [`docker-compose.prod.yml`](docker-compose.prod.yml) uruchamia kontener aplikacji `cyber-quiz` oraz izolowany `cyber-quiz-redis` (limit `256mb`, polityka `allkeys-lru`, bez zapisu na dysk), podłączając aplikację do zewnętrznej sieci reverse proxy `SWAG_NETWORK` (domyślnie `swag`):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Reverse proxy SWAG (Nginx)

Przykładowa konfiguracja subdomeny znajduje się w [`deploy/swag/cyber-quiz.subdomain.conf`](deploy/swag/cyber-quiz.subdomain.conf):
- kieruje ruch `/` oraz `/socket.io/` (z obsługą `Upgrade` / WebSocket, wyłączonym buforowaniem i timeoutami `86400s`) do kontenera `cyber-quiz:3001`,
- zawiera opcjonalny zakomentowany blok `auth_basic` dla ścieżek `/game-admin` oraz `/api/`, dzięki czemu gracze na `/` i ekran rzutnika `/game-screen` nie są pytani o hasło.

## Zmienne środowiskowe

| Zmienna | Domyślna wartość | Opis |
|---|---|---|
| `PORT` | `3001` | Port serwera HTTP / WebSocket |
| `REDIS_HOST` | `127.0.0.1` | Host serwera Redis (w `docker-compose.prod.yml`: `cyber-quiz-redis`) |
| `REDIS_PORT` | `6379` | Port serwera Redis |
| `REDIS_PASSWORD` | *(brak)* | Opcjonalne hasło do Redisa |
| `CORS_ORIGIN` | `*` | Dozwolone originy CORS (pojedynczy adres lub lista rozdzielona przecinkami) |
| `STATIC_DIR` | `../client/dist` | Katalog ze zbudowanym frontendem SPA (w Dockerze: `/app/public`) |
| `VITE_BACKEND_URL` | *(auto)* | Zmienna czasu budowania Vite; domyślnie w dev `http://<hostname>:3001`, w prod `window.location.origin` |
| `SWAG_NETWORK` | `swag` | Nazwa zewnętrznej sieci Docker dla reverse proxy w `docker-compose.prod.yml` |

## Funkcjonalności

| Moduł | Opis |
|---|---|
| **Edytor i baza quizów** | Tworzenie, edycja i usuwanie quizów (4 odpowiedzi A/B/C/D, limit czasu `5–60 s` na pytanie), wbudowany quiz startowy (`PROTOKÓŁ: BEZPIECZEŃSTWO SIECIOWE_v1.0`), import i eksport quizów w formacie JSON |
| **Lobby + QR** | 6-cyfrowy PIN sesji, generowanie kodu QR (`qrcode.react`), walidacja duplikatów nicków w czasie `O(1)` (`ZSCORE`), podgląd listy graczy na żywo |
| **Dwufazowa runda** | Po 3-sekundowym odliczaniu startowym każde pytanie wyświetla się przez **5 s** (`QUESTION_PREVIEW`) przed ujawnieniem odpowiedzi i odblokowaniem przycisków na telefonach (`QUESTION`) |
| **Panel Prowadzącego** | Sterowanie grą z osobnego okna: status połączenia ekranu rzutnika, podgląd pytania z zaznaczoną poprawną odpowiedzią, wymuszanie przejścia dalej (`host_force_next`), wstrzymanie/wznowienie auto-przejścia po wynikach (`host_toggle_pause`), przerwanie sesji (`host_abort_game`) |
| **Leaderboard i Podium** | Rozkład odpowiedzi `A/B/C/D` z animowanymi słupkami, Top 5 po każdej rundzie (auto-przejście po `6 s`), sekwencyjne podium `3 → 2 → 1` oraz przewijana tabela pełnej klasyfikacji końcowej |

> Uwaga: definicje quizów przechowywane są w pamięci procesu Node.js (`Map`), natomiast aktywne sesje gier, wyniki i głosy zapisywane są w Redisie (klucz stanu pokoju ma TTL `7200 s` / 2 godziny).

## Algorytm punktacji

Czas reakcji liczony jest od momentu **ujawnienia odpowiedzi** (po zakończeniu 5-sekundowego podglądu pytania):

```
P = max(500, floor(1000 × (1 − T_odpowiedzi / (T_limit × 2))))
```

- Poprawna odpowiedź daje od **500 pkt** (tuż przed końcem czasu) do **1000 pkt** (odpowiedź natychmiastowa).
- Błędna odpowiedź lub brak odpowiedzi daje **0 pkt**.

## Optymalizacje dla 200+ graczy

- `perMessageDeflate: false` w Socket.IO (`pingInterval: 25000`, `pingTimeout: 20000`) — niższe zużycie CPU i RAM przy setkach połączeń.
- **Throttling co 250 ms** — licznik oddanych odpowiedzi wysyłany jest wyłącznie do pokojów `host:<pin>` maksymalnie 4 razy na sekundę i tylko wtedy, gdy liczba odpowiedzi uległa zmianie; gdy wszyscy gracze odpowiedzą, runda kończy się automatycznie przed czasem.
- **Lekki payload mobilny** — telefony graczy otrzymują jedynie minimalne komunikaty sterujące (`player_question_preview`, `player_question_start` z liczbą opcji i limitem czasu), bez treści pytania i tekstów odpowiedzi.
- **Atomowe operacje Redis** — `HSETNX` blokuje wielokrotne głosowanie w tej samej rundzie, `ZINCRBY` aktualizuje wynik, `ZSCORE` weryfikuje unikalność nicka, a `ZREVRANGE` zwraca ranking.
- **Separacja pokojów Socket.IO** — osobne kanały `host:<pin>`, `controller:<pin>`, `screen:<pin>` oraz `players:<pin>`.

## Testy obciążeniowe

Skrypt [`scripts/load-test.mjs`](scripts/load-test.mjs) symuluje dowolną liczbę jednoczesnych graczy przez WebSocket/polling (wykorzystuje `socket.io-client` z `client/node_modules`, więc przed uruchomieniem wymagane jest `npm install` w katalogu `client/`).

```bash
# Tryb autonomiczny: skrypt sam tworzy pokój, uruchamia grę dla 200 botów i raportuje wyniki
node scripts/load-test.mjs --auto-host --players 200 --ramp-up 0

# Dołączenie 250 botów do istniejącej sesji w fazie LOBBY
node scripts/load-test.mjs --pin 482910 --players 250 --min-delay 100 --max-delay 3000 --ramp-up 2000

# Wszystkie dostępne opcje
node scripts/load-test.mjs --help
```

Skrypt raportuje m.in. błędy połączeń, rozkład latencji `JOIN` i `ANSWER` (`min`, `avg`, `p50`, `p95`, `p99`, `max`), czas fan-outu zdarzeń końca rundy i podium oraz końcowe Top 5 symulowanych graczy.

## Endpointy REST API

| Metoda | Ścieżka | Opis |
|---|---|---|
| `GET` | `/health` | Stan serwera i połączenia z Redisem (`200 ok` / `503 degraded`) |
| `GET` | `/api/quizzes` | Lista dostępnych quizów |
| `GET` | `/api/quizzes/:id` | Szczegóły wybranego quizu wraz z pytaniami |
| `POST` | `/api/quizzes` | Utworzenie nowego quizu |
| `PUT` | `/api/quizzes/:id` | Aktualizacja istniejącego quizu |
| `DELETE` | `/api/quizzes/:id` | Usunięcie quizu |

## Struktura projektu

```
cyber-quiz/
├── Dockerfile                        # Wieloetapowy build produkcyjny (Vite + Node 22)
├── docker-compose.yml                # Redis 7-alpine do pracy lokalnej
├── docker-compose.prod.yml           # Produkcja: aplikacja + Redis + sieć SWAG
├── deploy/
│   └── swag/
│       └── cyber-quiz.subdomain.conf # Szablon reverse proxy Nginx dla SWAG
├── scripts/
│   └── load-test.mjs                 # Symulator obciążenia dla X graczy
├── server/
│   ├── package.json
│   └── index.js                      # Express + Socket.IO + logika gry + Redis
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                   # Routing widoków i synchronizacja WebSocket
        ├── constants.js              # Konfiguracja połączenia i metadane faz/opcji
        ├── index.css                 # System stylów Neobrutalism i animacje CSS
        └── components/
            ├── AdminMenu.jsx         # Wybór quizu, baza quizów, import/eksport JSON
            ├── QuizEditor.jsx        # Tworzenie i edycja quizów
            ├── HostControlPanel.jsx  # Panel prowadzącego sesję na żywo
            ├── GameScreenView.jsx    # Ekran gry (rzutnik) + QR + podium + pełna tabela
            ├── PlayerView.jsx        # Interfejs gracza (smartfon)
            └── ui/                   # Komponenty UI (Button, Card, Badge, Progress, Alert…)
```
