import { io } from 'socket.io-client';

// W produkcji (build Vite) używa tego samego origin (reverse proxy / SWAG),
// a w trybie deweloperskim (vite dev) łączy się bezpośrednio z backendem na porcie 3001.
// Można nadpisać zmienną VITE_BACKEND_URL na etapie budowania.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV
    ? `http://${window.location.hostname}:3001`
    : window.location.origin);
export const socket = io(BACKEND_URL, { autoConnect: true });

export const ANSWER_OPTIONS = [
  { label: 'A', symbol: '▲', badgeVariant: 'danger', bgClass: 'bg-danger' },
  { label: 'B', symbol: '◆', badgeVariant: 'info', bgClass: 'bg-info' },
  { label: 'C', symbol: '●', badgeVariant: 'warning', bgClass: 'bg-warning' },
  { label: 'D', symbol: '■', badgeVariant: 'purple', bgClass: 'bg-purple' },
];

export const HOST_STATUS_META = {
  LOBBY: { label: 'Lobby (oczekiwanie)', variant: 'neutral' },
  COUNTDOWN: { label: 'Odliczanie startowe', variant: 'warning' },
  QUESTION_PREVIEW: { label: 'Podgląd pytania (5s)', variant: 'info' },
  QUESTION: { label: 'Aktywne pytanie', variant: 'default' },
  LEADERBOARD: { label: 'Wyniki rundy', variant: 'purple' },
  PODIUM: { label: 'Podium i wyniki końcowe', variant: 'default' },
  ABORTED: { label: 'Gra przerwana', variant: 'danger' },
};
