# cyber_Quiz 🟢

> Platforma do interaktywnych quizów czasu rzeczywistego w stylistyce **Matrix / Cyberpunk**.
> Zoptymalizowana pod 200+ jednoczesnych graczy w jednej sesji.

## Architektura

```
┌──────────────┐     WebSocket      ┌──────────────┐     Sorted Sets     ┌─────────┐
│  React/Vite  │ ◄──────────────► │  Node.js +   │ ◄────────────────► │  Redis  │
│  (Frontend)  │   Socket.io       │  Express +   │    HSETNX/ZINCRBY  │  7-alp  │
│  port 5173   │                   │  Socket.io   │                    │  :6379  │
└──────────────┘                   │  port 3001   │                    └─────────┘
                                   └──────────────┘
```

## Wymagania

- **Node.js** 18+
- **Docker** (dla Redis)

## Uruchomienie

### 1. Uruchom Redis
```bash
cd cyber-quiz
docker compose up -d
```

### 2. Uruchom serwer (Backend)
```bash
cd server
npm install    # (tylko za pierwszym razem)
npm start
```

### 3. Uruchom frontend (Klient)
W nowym terminalu:
```bash
cd client
npm install    # (tylko za pierwszym razem)
npm run dev
```

### 4. Otwórz w przeglądarce

- **Ekran Hosta (rzutnik):** `http://localhost:5173`
- **Smartfon gracza:** zeskanuj kod QR lub otwórz `http://<IP_SIECI>:5173/?pin=XXXXXX`

## Funkcjonalności

| Moduł | Opis |
|---|---|
| **Edytor Pytań** | Tworzenie quizów z 4 wariantami odpowiedzi, konfiguracja limitu czasu (5–60s) |
| **Lobby + QR** | 6-cyfrowy PIN, generowanie kodu QR, walidacja duplikatów nicków w Redis |
| **Rozgrywka** | Synchronizacja czasu serwer-side, algorytm punktacji premiujący szybkość |
| **Leaderboard** | Top 5 po każdym pytaniu, rozkład odpowiedzi (A/B/C/D) |
| **Podium** | Animowane odsłanianie 3→2→1 miejsce |

## Optymalizacje dla 200+ graczy

- `perMessageDeflate: false` — oszczędność CPU/RAM
- Throttling broadcast co **250 ms** (brak rozgłaszania każdej odpowiedzi)
- Lekki mobilny klient — smartfon otrzymuje tylko sygnał startu (kilkadziesiąt bajtów)
- Atomowe operacje Redis: `HSETNX` (zapobiega podwójnemu głosowaniu), `ZINCRBY` (aktualizacja punktów)

## Algorytm punktacji

```
P = floor(1000 × (1 − T_odpowiedzi / (T_limit × 2)))
```
Minimum 500 pkt za poprawną odpowiedź, maksimum ~1000 pkt za natychmiastową.
