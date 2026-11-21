# Cyber Quiz

[![pl](https://img.shields.io/badge/README-PL-red.svg)](README.md)

A real-time interactive multiplayer quiz platform with a **Neobrutalism** UI (React + Vite + Tailwind CSS, Node.js + Socket.IO + Redis), optimized for **200+ concurrent players** in a single session.

## Architecture

```
┌───────────────────────────┐       WebSocket / REST       ┌──────────────────────┐     Hashes / ZSET     ┌─────────┐
│  React + Vite + Tailwind  │ ◄──────────────────────────► │  Node.js + Express   │ ◄───────────────────► │  Redis  │
│  "/"          Player      │   Socket.IO + /api/quizzes   │  + Socket.IO         │   HSETNX / ZINCRBY    │  7-alp  │
│  "/game-admin" Host/Admin │                              │  port 3001           │   ZSCORE / ZREVRANGE  │  :6379  │
│  "/game-screen" Projector │                              │  (+ static UI prod)  │                       └─────────┘
└───────────────────────────┘                              └──────────────────────┘
```

### Application Views (SPA Routing)

| Path | Role | Description |
|---|---|---|
| `/` | **Player (Smartphone)** | Join via 6-digit PIN or QR code (`/?pin=XXXXXX`), start countdown, question preview wait screen (buttons locked), 4-button answer pad (`A/B/C/D`), per-question result & final rank |
| `/game-admin` | **Admin & Host Control Panel** | Quiz library (create, edit, delete, JSON import/export) and live session controller: opens the projector screen window, starts the game, skips phases, pauses/resumes leaderboard auto-advance, aborts the game, previews the current question with the correct answer highlighted, and shows full standings |
| `/game-screen?pin=XXXXXX` | **Game Screen (Projector)** | Dedicated presentation window with fullscreen toggle: lobby with QR code and PIN, 5-second question preview before revealing answers, staggered answer cards, animated vote distribution and Top 5, sequential podium reveal (`3 → 2 → 1`), and a scrollable full leaderboard |

## Requirements

- **Node.js** 18+ (the Docker image uses Node 22 Alpine)
- **Docker** and **Docker Compose** (for Redis in development or the full stack in production)

## Local Setup (Development)

### 1. Start Redis
```bash
docker compose up -d
```

### 2. Start the Backend
```bash
cd server
npm install    # first time only
npm run dev    # or: npm start
```
The server listens on port `3001` (`0.0.0.0`) by default and connects to Redis at `127.0.0.1:6379`.

### 3. Start the Frontend
In a new terminal:
```bash
cd client
npm install    # first time only
npm run dev
```
Vite starts the dev server on port `5173` with `--host` enabled (accessible over your local network).

### 4. Open in the Browser

- **Host Control Panel / Quiz Editor:** `http://localhost:5173/game-admin`
- **Game Screen (Projector):** opens automatically in a popup window when creating a room, or manually at `http://localhost:5173/game-screen?pin=XXXXXX`
- **Player Smartphone:** scan the QR code on the game screen or open `http://<LOCAL_IP>:5173/?pin=XXXXXX`

## Production Deployment (Docker + SWAG)

In production, the multi-stage [`Dockerfile`](Dockerfile) builds the frontend (`client/dist`) and serves it directly from the Express server on port `3001` alongside the REST API, WebSockets, and `/health` endpoint.

### Build and Run with Docker Compose

[`docker-compose.prod.yml`](docker-compose.prod.yml) runs the `cyber-quiz` application container and an isolated `cyber-quiz-redis` container (`256mb` memory limit, `allkeys-lru` eviction, persistence disabled), attaching the app to an external `SWAG_NETWORK` reverse proxy network (default: `swag`):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### SWAG Reverse Proxy (Nginx)

A sample subdomain configuration is provided in [`deploy/swag/cyber-quiz.subdomain.conf`](deploy/swag/cyber-quiz.subdomain.conf):
- proxies `/` and `/socket.io/` (with WebSocket `Upgrade` headers, buffering disabled, and `86400s` timeouts) to `cyber-quiz:3001`,
- includes an optional commented-out `auth_basic` block for `/game-admin` and `/api/`, so players on `/` and the game screen on `/game-screen` are not prompted for credentials.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP / WebSocket server port |
| `REDIS_HOST` | `127.0.0.1` | Redis host (`cyber-quiz-redis` in `docker-compose.prod.yml`) |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(none)* | Optional Redis password |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (single origin or comma-separated list) |
| `STATIC_DIR` | `../client/dist` | Directory containing the built SPA frontend (`/app/public` in Docker) |
| `VITE_BACKEND_URL` | *(auto)* | Vite build-time override; defaults to `http://<hostname>:3001` in dev, `window.location.origin` in prod |
| `SWAG_NETWORK` | `swag` | External Docker network name for the reverse proxy in `docker-compose.prod.yml` |

## Features

| Module | Description |
|---|---|
| **Quiz Editor & Library** | Create, edit, and delete quizzes (4 options A/B/C/D, `5–60s` time limit per question), built-in starter quiz (`PROTOKÓŁ: BEZPIECZEŃSTWO SIECIOWE_v1.0`), JSON quiz import and export |
| **Lobby + QR** | 6-digit session PIN, QR code generation (`qrcode.react`), `O(1)` duplicate nickname validation via Redis `ZSCORE`, live player roster |
| **Two-Stage Question Flow** | After a 3-second start countdown, each question is displayed for **5s** (`QUESTION_PREVIEW`) before revealing the answer options and unlocking player buttons (`QUESTION`) |
| **Host Control Panel** | Separate controller view: projector connection status, question preview with the correct answer marked, force-next across all phases (`host_force_next`), pause/resume leaderboard auto-advance (`host_toggle_pause`), and game abort (`host_abort_game`) |
| **Leaderboard & Podium** | Animated `A/B/C/D` answer distribution bar chart, Top 5 standings after each question (`6s` auto-advance), sequential `3 → 2 → 1` podium reveal, and a scrollable full final leaderboard |

> Note: quiz definitions are stored in Node.js process memory (`Map`), while active game sessions, scores, and answers are stored in Redis (room state keys use a `7200s` / 2-hour TTL).

## Scoring Algorithm

Response time is measured from when the **answers are revealed** (after the 5-second question preview ends):

```
P = max(500, floor(1000 × (1 − T_elapsed / (T_limit × 2))))
```

- A correct answer awards between **500 pts** (just before time expires) and **1000 pts** (instant answer).
- An incorrect or missing answer awards **0 pts**.

## Optimizations for 200+ Players

- `perMessageDeflate: false` in Socket.IO (`pingInterval: 25000`, `pingTimeout: 20000`) — lowers CPU and RAM overhead across hundreds of concurrent sockets.
- **250 ms broadcast throttling** — answer counts are emitted only to `host:<pin>` rooms at most 4 times per second and only when the count changes; the round ends early automatically once all players have answered.
- **Lightweight mobile payloads** — player smartphones receive only minimal control signals (`player_question_preview`, `player_question_start` with option count and time limit), omitting question and answer text.
- **Atomic Redis operations** — `HSETNX` prevents duplicate answers per round, `ZINCRBY` increments scores atomically, `ZSCORE` checks nickname uniqueness, and `ZREVRANGE` retrieves rankings.
- **Socket.IO room isolation** — separate channels for `host:<pin>`, `controller:<pin>`, `screen:<pin>`, and `players:<pin>`.

## Load Testing

The [`scripts/load-test.mjs`](scripts/load-test.mjs) script simulates any number of concurrent players over WebSocket or polling (it resolves `socket.io-client` from `client/node_modules`, so run `npm install` inside `client/` first).

```bash
# Autonomous mode: creates a room, runs the full quiz with 200 bots, and prints a report
node scripts/load-test.mjs --auto-host --players 200 --ramp-up 0

# Join 250 bots into an existing session in the LOBBY phase
node scripts/load-test.mjs --pin 482910 --players 250 --min-delay 100 --max-delay 3000 --ramp-up 2000

# Show all available CLI options
node scripts/load-test.mjs --help
```

The report includes connection/event errors, `JOIN` and `ANSWER` latency percentiles (`min`, `avg`, `p50`, `p95`, `p99`, `max`), round-end and podium fan-out times, and the final Top 5 simulated players.

## REST API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Server and Redis health status (`200 ok` / `503 degraded`) |
| `GET` | `/api/quizzes` | List all available quizzes |
| `GET` | `/api/quizzes/:id` | Get a specific quiz with its questions |
| `POST` | `/api/quizzes` | Create a new quiz |
| `PUT` | `/api/quizzes/:id` | Update an existing quiz |
| `DELETE` | `/api/quizzes/:id` | Delete a quiz |

## Project Structure

```
cyber-quiz/
├── Dockerfile                        # Multi-stage production build (Vite + Node 22)
├── docker-compose.yml                # Redis 7-alpine for local development
├── docker-compose.prod.yml           # Production stack: app + Redis + SWAG network
├── deploy/
│   └── swag/
│       └── cyber-quiz.subdomain.conf # SWAG Nginx reverse proxy template
├── scripts/
│   └── load-test.mjs                 # Concurrent player load-testing script
├── server/
│   ├── package.json
│   └── index.js                      # Express + Socket.IO + game engine + Redis
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── src/
        ├── App.jsx                   # Route handling and WebSocket state sync
        ├── constants.js              # Backend URL config, option & status metadata
        ├── index.css                 # Neobrutalism design tokens and CSS animations
        └── components/
            ├── AdminMenu.jsx         # Quiz selection, library management, JSON import/export
            ├── QuizEditor.jsx        # Quiz creation and editing form
            ├── HostControlPanel.jsx  # Live host controller view
            ├── GameScreenView.jsx    # Projector screen (QR, rounds, podium, full standings)
            ├── PlayerView.jsx        # Smartphone player interface
            └── ui/                   # Reusable UI primitives (Button, Card, Badge, Progress, Alert…)
```

