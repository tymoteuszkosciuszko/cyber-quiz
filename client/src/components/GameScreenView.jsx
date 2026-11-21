import { useState, useEffect, useCallback } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Progress,
  cn,
} from './ui';
import { socket, ANSWER_OPTIONS } from '../constants';

export function GameScreenView({ pin }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [status, setStatus] = useState('LOADING');
  const [playersList, setPlayersList] = useState([]);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [previewTimeLeft, setPreviewTimeLeft] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(5);
  const [timeLeft, setTimeLeft] = useState(0);
  const [answerCount, setAnswerCount] = useState({ count: 0, total: 0 });
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [autoNextSeconds, setAutoNextSeconds] = useState(0);
  const [barsAnimated, setBarsAnimated] = useState(false);
  const [podiumData, setPodiumData] = useState([]);
  const [allResults, setAllResults] = useState([]);
  const [revealedPodiumStep, setRevealedPodiumStep] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const hydrateFromSnapshot = useCallback((snap) => {
    if (!snap || snap.error) {
      setError(snap?.error || 'ROOM_NOT_FOUND');
      setStatus('ERROR');
      return;
    }

    setError('');
    setConnected(true);
    setQuizTitle(snap.quizTitle || '');
    setPlayersList(snap.players || []);
    setStatus(snap.status);

    if (snap.status === 'COUNTDOWN') {
      setCountdownSeconds(snap.countdownSeconds || 3);
    } else if (snap.status === 'QUESTION_PREVIEW' && snap.currentQuestion) {
      setCurrentQuestion(snap.currentQuestion);
      setPreviewDuration(snap.currentQuestion.previewDuration || 5);
      setPreviewTimeLeft(
        snap.currentQuestion.previewRemaining ??
          snap.currentQuestion.previewDuration ??
          5
      );
    } else if (snap.status === 'QUESTION' && snap.currentQuestion) {
      setCurrentQuestion(snap.currentQuestion);
      setTimeLeft(snap.timeLeft ?? snap.currentQuestion.timeLimit ?? 0);
      setAnswerCount(
        snap.answerCount || { count: 0, total: snap.currentQuestion.totalPlayers || 0 }
      );
    } else if (snap.status === 'LEADERBOARD' && snap.leaderboardData) {
      if (snap.currentQuestion) setCurrentQuestion(snap.currentQuestion);
      setLeaderboardData(snap.leaderboardData);
      setAutoNextSeconds(snap.leaderboardData.autoNextIn || 0);
    } else if (snap.status === 'PODIUM') {
      setPodiumData(snap.podium || []);
      setAllResults(snap.allResults || snap.podium || []);
      setRevealedPodiumStep(0);
    }
  }, []);

  const joinScreenRoom = useCallback(() => {
    if (!pin) {
      setError('MISSING_PIN');
      setStatus('ERROR');
      return;
    }
    socket.emit('screen_join_room', { pin }, (snap) => {
      hydrateFromSnapshot(snap);
    });
  }, [pin, hydrateFromSnapshot]);

  // Połączenie i synchronizacja przy montowaniu oraz ponownym połączeniu
  useEffect(() => {
    joinScreenRoom();

    const handleConnect = () => joinScreenRoom();
    socket.on('connect', handleConnect);

    socket.on('player_joined', ({ nickname }) => {
      setPlayersList((prev) =>
        prev.includes(nickname) ? prev : [...prev, nickname]
      );
    });

    socket.on('host_countdown', ({ seconds }) => {
      setStatus('COUNTDOWN');
      setCountdownSeconds(seconds);
    });

    socket.on('host_question_preview', (data) => {
      setStatus('QUESTION_PREVIEW');
      setCurrentQuestion(data);
      setPreviewDuration(data.previewDuration || 5);
      setPreviewTimeLeft(data.previewDuration || 5);
      setAnswerCount({ count: 0, total: data.totalPlayers });
    });

    socket.on('host_question_start', (data) => {
      setStatus('QUESTION');
      setCurrentQuestion(data);
      setAnswerCount({ count: 0, total: data.totalPlayers });
      setTimeLeft(data.timeLimit);
      setPreviewTimeLeft(0);
    });

    socket.on('answer_count_update', (data) => {
      setAnswerCount(data);
    });

    socket.on('host_question_end', (data) => {
      setStatus('LEADERBOARD');
      setLeaderboardData(data);
      setAutoNextSeconds(data.autoNextIn || 0);
    });

    socket.on('host_auto_next_status', ({ isPaused, autoNextIn }) => {
      setLeaderboardData((prev) => (prev ? { ...prev, isPaused } : prev));
      setAutoNextSeconds(autoNextIn || 0);
    });

    socket.on('host_podium', ({ podium, allResults: full }) => {
      setStatus('PODIUM');
      setPodiumData(podium || []);
      setAllResults(full || podium || []);
      setRevealedPodiumStep(0);
    });

    socket.on('game_aborted', () => {
      setStatus('ABORTED');
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('player_joined');
      socket.off('host_countdown');
      socket.off('host_question_preview');
      socket.off('host_question_start');
      socket.off('answer_count_update');
      socket.off('host_question_end');
      socket.off('host_auto_next_status');
      socket.off('host_podium');
      socket.off('game_aborted');
    };
  }, [joinScreenRoom]);

  // Odliczanie startowe (COUNTDOWN)
  useEffect(() => {
    if (status !== 'COUNTDOWN' || countdownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [status, countdownSeconds]);

  // Odliczanie podglądu pytania (5s przed ujawnieniem odpowiedzi)
  useEffect(() => {
    if (status !== 'QUESTION_PREVIEW' || previewTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setPreviewTimeLeft((prev) => Math.max(0, +(prev - 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(timer);
  }, [status, previewTimeLeft]);

  // Odliczanie aktywnego pytania
  useEffect(() => {
    if (status !== 'QUESTION' || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, +(prev - 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(timer);
  }, [status, timeLeft]);

  // Odliczanie auto-przejścia na tablicy wyników
  useEffect(() => {
    if (
      status !== 'LEADERBOARD' ||
      leaderboardData?.isPaused ||
      autoNextSeconds <= 0
    ) {
      return;
    }
    const timer = setInterval(() => {
      setAutoNextSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [status, leaderboardData?.isPaused, autoNextSeconds]);

  // Animacja słupków rozkładu odpowiedzi na wejściu do LEADERBOARD
  useEffect(() => {
    if (status !== 'LEADERBOARD') {
      setBarsAnimated(false);
      return;
    }
    setBarsAnimated(false);
    const t = setTimeout(() => setBarsAnimated(true), 80);
    return () => clearTimeout(t);
  }, [status, leaderboardData?.qIndex]);

  // Sekwencyjne odsłanianie podium (3 → 2 → 1 → pełna lista wyników)
  useEffect(() => {
    if (status !== 'PODIUM') return;
    setRevealedPodiumStep(0);
    const t1 = setTimeout(() => setRevealedPodiumStep(1), 650);
    const t2 = setTimeout(() => setRevealedPodiumStep(2), 1650);
    const t3 = setTimeout(() => setRevealedPodiumStep(3), 2800);
    const t4 = setTimeout(() => setRevealedPodiumStep(4), 3550);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [status]);

  // Śledzenie pełnego ekranu
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const previewWholeSeconds = Math.max(1, Math.ceil(previewTimeLeft));

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* NAGŁÓWEK EKRANU GRY */}
      <header className="w-full border-b-2 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow flex-shrink-0">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-heading text-lg md:text-xl font-extrabold tracking-tight">
                Cyber Quiz
              </span>
              <Badge variant="default">Ekran gry</Badge>
              {quizTitle && (
                <span className="hidden sm:inline text-sm font-heading font-bold text-foreground/75 truncate max-w-xs">
                  • {quizTitle}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {connected && pin && (
              <Badge variant="neutral" className="text-sm px-3 py-1 tabular-nums">
                PIN: {pin}
              </Badge>
            )}
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={toggleFullscreen}
            >
              {isFullscreen ? 'Zamknij pełny ekran' : 'Pełny ekran'}
            </Button>
          </div>
        </div>
      </header>

      {/* TREŚĆ EKRANU GRY */}
      <div className="flex flex-1 flex-col justify-center px-4 py-6 md:px-8 md:py-8">
        <main className="mx-auto w-full max-w-5xl">
          {/* ŁADOWANIE */}
          {status === 'LOADING' && (
            <Card key="loading" className="mx-auto max-w-lg p-10 text-center space-y-4 animate-screen-enter">
              <Badge variant="neutral">Łączenie...</Badge>
              <h2 className="font-heading text-2xl font-extrabold">
                Synchronizacja ekranu gry
              </h2>
              <p className="text-sm text-foreground/75">
                Pobieranie stanu sesji dla PIN: <strong>{pin}</strong>
              </p>
            </Card>
          )}

          {/* BŁĄD */}
          {status === 'ERROR' && (
            <Card key="error" className="mx-auto max-w-lg p-8 text-center space-y-5 animate-screen-enter">
              <Badge variant="danger">Błąd połączenia</Badge>
              <h2 className="font-heading text-2xl font-extrabold">
                Nie znaleziono aktywnej sesji
              </h2>
              <Alert variant="danger" className="text-left text-sm font-heading font-bold">
                Kod błędu: {error}
              </Alert>
              <p className="text-sm text-foreground/75">
                Upewnij się, że prowadzący uruchomił pokój w panelu admina i kod PIN w adresie URL jest poprawny.
              </p>
              <Button type="button" variant="neutral" onClick={joinScreenRoom}>
                Spróbuj ponownie
              </Button>
            </Card>
          )}

          {/* LOBBY Z KODEM QR */}
          {status === 'LOBBY' && (
            <Card key="lobby" className="p-6 md:p-10 animate-screen-enter">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="space-y-6 text-center md:text-left">
                  <Badge variant="default" className="text-sm px-3 py-1">
                    Oczekiwanie na graczy
                  </Badge>

                  {quizTitle && (
                    <h1 className="font-heading text-2xl md:text-3xl font-extrabold leading-tight">
                      {quizTitle}
                    </h1>
                  )}

                  <div className="space-y-2">
                    <div className="text-sm font-heading font-bold uppercase tracking-wide text-foreground/75">
                      PIN dostępu
                    </div>
                    <div className="inline-block rounded-base border-2 border-border bg-background px-6 py-3 font-heading text-5xl md:text-6xl font-extrabold tracking-[0.18em] tabular-nums shadow-shadow">
                      {pin}
                    </div>
                  </div>

                  <div className="flex items-center justify-center md:justify-start gap-3">
                    <span className="font-heading text-lg font-bold">
                      Połączeni gracze:
                    </span>
                    <Badge variant="default" className="text-base px-3 py-1 tabular-nums">
                      {playersList.length}
                    </Badge>
                  </div>

                  <p className="text-sm text-foreground/75">
                    Dołącz na telefonie pod adresem{' '}
                    <span className="font-heading font-bold text-foreground">
                      {window.location.host}
                    </span>{' '}
                    lub zeskanuj kod QR.
                  </p>
                </div>

                <div className="flex flex-col items-center justify-center rounded-base border-2 border-border bg-background p-6">
                  <div className="rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
                    <QRCodeCanvas
                      size={240}
                      value={`${window.location.origin}/?pin=${pin}`}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="M"
                    />
                  </div>
                  <p className="mt-4 text-center text-sm font-heading font-bold">
                    Zeskanuj kod QR telefonem, aby dołączyć
                  </p>
                </div>

                <div className="md:col-span-2 border-t-2 border-border pt-6 space-y-3">
                  <div className="text-sm font-heading font-bold">
                    Zarejestrowani uczestnicy ({playersList.length})
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-2 pb-2">
                    {playersList.map((p) => (
                      <Badge
                        key={p}
                        variant="neutral"
                        className="px-3 py-1.5 text-sm animate-slide-up"
                      >
                        @{p}
                      </Badge>
                    ))}
                    {playersList.length === 0 && (
                      <span className="text-sm text-foreground/75">
                        Brak połączonych graczy — udostępnij PIN lub kod QR.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ODLICZANIE STARTOWE */}
          {status === 'COUNTDOWN' && (
            <Card
              key="countdown"
              className="mx-auto max-w-2xl p-10 md:p-14 text-center space-y-6 animate-screen-enter"
            >
              <Badge variant="warning" className="text-sm px-3 py-1">
                Start za chwilę
              </Badge>
              <h2 className="font-heading text-3xl md:text-4xl font-extrabold">
                Przygotuj się!
              </h2>
              <div
                key={`cd-${countdownSeconds}`}
                className="mx-auto flex h-44 w-44 md:h-56 md:w-56 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow font-heading text-8xl md:text-[9rem] font-extrabold leading-none tabular-nums animate-countdown-pop"
              >
                {countdownSeconds || '•'}
              </div>
              <p className="text-base text-foreground/75">
                Za moment pojawi się pierwsze pytanie.
              </p>
            </Card>
          )}

          {/* RUNDA: PODGLĄD PYTANIA (5s) → UJAWNIENIE ODPOWIEDZI */}
          {(status === 'QUESTION_PREVIEW' || status === 'QUESTION') &&
            currentQuestion && (
              <Card
                key={`round-${currentQuestion.qIndex}`}
                className="p-6 md:p-10 space-y-6 animate-screen-enter"
              >
                {/* Pasek górny rundy */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-border pb-5">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-sm px-3 py-1">
                      Pytanie {currentQuestion.qIndex + 1} /{' '}
                      {currentQuestion.totalQuestions}
                    </Badge>
                    {status === 'QUESTION_PREVIEW' && (
                      <Badge variant="info" className="text-sm px-3 py-1">
                        Czytaj pytanie
                      </Badge>
                    )}
                  </div>

                  {status === 'QUESTION_PREVIEW' ? (
                    <div className="flex flex-1 min-w-[220px] max-w-md items-center gap-3">
                      <Progress
                        value={
                          previewDuration > 0
                            ? (previewTimeLeft / previewDuration) * 100
                            : 0
                        }
                        indicatorClassName="bg-info"
                      />
                      <Badge
                        variant="info"
                        className="min-w-[5.25rem] text-sm py-1 tabular-nums"
                      >
                        {previewTimeLeft.toFixed(1)} s
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex flex-1 min-w-[220px] max-w-md items-center gap-3">
                      <Progress
                        value={
                          currentQuestion.timeLimit > 0
                            ? (timeLeft / currentQuestion.timeLimit) * 100
                            : 0
                        }
                        indicatorClassName={timeLeft <= 5 ? 'bg-danger' : 'bg-main'}
                      />
                      <Badge
                        variant={timeLeft <= 5 ? 'danger' : 'neutral'}
                        className="min-w-[5.25rem] text-sm py-1 tabular-nums"
                      >
                        {timeLeft.toFixed(1)} s
                      </Badge>
                    </div>
                  )}

                  <Badge variant="neutral" className="text-sm px-3 py-1 tabular-nums">
                    {status === 'QUESTION_PREVIEW'
                      ? `Limit: ${currentQuestion.timeLimit} s`
                      : `Odpowiedzi: ${answerCount.count} / ${answerCount.total}`}
                  </Badge>
                </div>

                {/* Treść pytania — płynnie dopasowuje rozmiar między podglądem a ujawnieniem odpowiedzi */}
                {currentQuestion.content && (
                  <h1
                    className={cn(
                      'font-heading font-extrabold text-center leading-tight transition-all duration-300',
                      status === 'QUESTION_PREVIEW'
                        ? currentQuestion.image
                          ? 'text-2xl md:text-4xl py-2'
                          : 'text-3xl md:text-5xl py-8'
                        : currentQuestion.image
                        ? 'text-xl md:text-3xl py-1'
                        : 'text-2xl md:text-4xl py-3'
                    )}
                  >
                    {currentQuestion.content}
                  </h1>
                )}

                {/* Zdjęcie do pytania (widoczne w podglądzie oraz podczas odpowiadania) */}
                {currentQuestion.image && (
                  <div className="flex justify-center animate-slide-up">
                    <div className="inline-flex items-center justify-center rounded-base border-2 border-border bg-background p-2 shadow-shadow max-w-full">
                      <img
                        src={currentQuestion.image}
                        alt="Ilustracja do pytania"
                        className={cn(
                          'w-auto max-w-full rounded-[3px] object-contain transition-all duration-300',
                          status === 'QUESTION_PREVIEW'
                            ? 'max-h-[38vh]'
                            : Array.isArray(currentQuestion.answerImages) &&
                              currentQuestion.answerImages.some(Boolean)
                            ? 'max-h-[24vh]'
                            : 'max-h-[34vh]'
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* FAZA 1: Odliczanie do ujawnienia odpowiedzi */}
                {status === 'QUESTION_PREVIEW' && (
                  <div
                    className={cn(
                      'mx-auto max-w-xl rounded-base border-2 border-border bg-background text-center animate-slide-up',
                      currentQuestion.image ? 'p-4 space-y-2.5' : 'p-6 space-y-4'
                    )}
                  >
                    <div className="text-sm font-heading font-bold uppercase tracking-wide text-foreground/75">
                      Odpowiedzi pojawią się za
                    </div>
                    <div
                      key={`preview-sec-${previewWholeSeconds}`}
                      className={cn(
                        'mx-auto flex items-center justify-center rounded-base border-2 border-border bg-warning text-foreground shadow-shadow font-heading font-extrabold tabular-nums animate-countdown-pop',
                        currentQuestion.image
                          ? 'h-16 w-16 text-4xl'
                          : 'h-24 w-24 text-5xl'
                      )}
                    >
                      {previewWholeSeconds}
                    </div>
                    <p className="text-sm text-foreground/75">
                      Przeczytaj uważnie treść pytania — przyciski na telefonach odblokują się za chwilę!
                    </p>
                  </div>
                )}

                {/* FAZA 2: Ujawnione odpowiedzi (kaskadowa animacja) */}
                {status === 'QUESTION' && Array.isArray(currentQuestion.answers) && (() => {
                  const hasAnyAnswerImages =
                    Array.isArray(currentQuestion.answerImages) &&
                    currentQuestion.answerImages.some(Boolean);

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 pb-1 pr-1">
                      {currentQuestion.answers.map((ans, idx) => {
                        const opt = ANSWER_OPTIONS[idx];
                        const ansImg = currentQuestion.answerImages?.[idx];

                        if (hasAnyAnswerImages) {
                          return (
                            <div
                              key={idx}
                              style={{ animationDelay: `${idx * 75}ms` }}
                              className="flex flex-col gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow animate-answer-reveal"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-base border-2 border-border font-heading text-lg font-extrabold text-foreground',
                                    opt.bgClass
                                  )}
                                >
                                  {opt.label}
                                </span>
                                {ans && (
                                  <span className="font-heading text-lg md:text-xl font-bold leading-snug">
                                    {ans}
                                  </span>
                                )}
                              </div>
                              {ansImg && (
                                <div className="flex h-36 md:h-44 w-full items-center justify-center rounded-base border-2 border-border bg-background p-1.5 overflow-hidden">
                                  <img
                                    src={ansImg}
                                    alt={`Odpowiedź ${opt.label}`}
                                    className="max-h-full max-w-full object-contain"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        }

                        return (
                          <div
                            key={idx}
                            style={{ animationDelay: `${idx * 75}ms` }}
                            className="flex items-center gap-4 rounded-base border-2 border-border bg-secondary-background p-5 shadow-shadow animate-answer-reveal"
                          >
                            <span
                              className={cn(
                                'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-base border-2 border-border font-heading text-xl font-extrabold text-foreground',
                                opt.bgClass
                              )}
                            >
                              {opt.label}
                            </span>
                            <span className="font-heading text-xl md:text-2xl font-bold leading-snug">
                              {ans}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </Card>
            )}

          {/* TABLICA WYNIKÓW PO RUNDZIE */}
          {status === 'LEADERBOARD' && leaderboardData && (
            <Card
              key={`leaderboard-${leaderboardData.qIndex ?? 'curr'}`}
              className="p-6 md:p-8 space-y-6 animate-screen-enter"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-border pb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-heading text-2xl font-extrabold">
                    Wyniki po pytaniu
                  </h2>
                  <Badge variant="neutral">Top 5</Badge>
                </div>

                {leaderboardData.isPaused ? (
                  <Badge variant="warning" className="text-sm px-3 py-1">
                    Wstrzymane przez prowadzącego
                  </Badge>
                ) : (
                  <Badge variant="neutral" className="text-sm px-3 py-1 tabular-nums">
                    {leaderboardData.isLastQuestion
                      ? `Podium za ${autoNextSeconds} s`
                      : `Następne pytanie za ${autoNextSeconds} s`}
                  </Badge>
                )}
              </div>

              <Alert variant="default" className="flex flex-wrap items-center gap-3">
                <span className="font-heading font-bold">Poprawna odpowiedź:</span>
                <Badge
                  variant={ANSWER_OPTIONS[leaderboardData.correctIndex]?.badgeVariant}
                  className="text-sm px-2.5 py-0.5"
                >
                  {ANSWER_OPTIONS[leaderboardData.correctIndex]?.label}
                </Badge>
                {currentQuestion?.answers?.[leaderboardData.correctIndex] && (
                  <strong className="font-heading text-base md:text-lg font-extrabold">
                    {currentQuestion.answers[leaderboardData.correctIndex]}
                  </strong>
                )}
                {currentQuestion?.answerImages?.[leaderboardData.correctIndex] && (
                  <img
                    src={currentQuestion.answerImages[leaderboardData.correctIndex]}
                    alt={`Poprawna odpowiedź ${ANSWER_OPTIONS[leaderboardData.correctIndex]?.label || ''}`}
                    className="h-16 md:h-20 w-auto max-w-[180px] rounded-base border-2 border-border bg-secondary-background object-contain p-1"
                  />
                )}
              </Alert>

              {/* Rozkład odpowiedzi z płynnym wzrostem słupków */}
              {leaderboardData.distribution && (
                <div className="rounded-base border-2 border-border bg-background p-4 md:p-5">
                  <div className="mb-4 text-xs font-heading font-bold uppercase tracking-wide text-foreground/75">
                    Rozkład odpowiedzi
                  </div>
                  <div className="grid grid-cols-4 gap-3 md:gap-6 text-center">
                    {leaderboardData.distribution.map((count, idx) => {
                      const total = leaderboardData.distribution.reduce(
                        (a, b) => a + b,
                        0
                      );
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      const opt = ANSWER_OPTIONS[idx];
                      const isCorrect = idx === leaderboardData.correctIndex;
                      return (
                        <div key={idx} className="flex flex-col items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Badge variant={opt.badgeVariant}>{opt.label}</Badge>
                            {isCorrect && <Badge variant="default">✓</Badge>}
                          </div>
                          <div className="flex h-28 w-full items-end justify-center rounded-base border-2 border-border bg-secondary-background p-2">
                            <div
                              style={{
                                height: barsAnimated
                                  ? `${Math.max(pct, 8)}%`
                                  : '4%',
                              }}
                              className={cn(
                                'w-full max-w-[3.5rem] rounded-base border-2 border-border transition-all duration-700 ease-out',
                                opt.bgClass
                              )}
                            />
                          </div>
                          <div className="text-xs sm:text-sm font-heading font-bold tabular-nums">
                            {count} ({pct}%)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top 5 */}
              <div className="space-y-3">
                {leaderboardData.topPlayers.map((p, idx) => (
                  <div
                    key={p.nickname}
                    style={{ animationDelay: `${idx * 70}ms` }}
                    className={cn(
                      'flex items-center justify-between gap-4 rounded-base border-2 border-border p-3.5 md:p-4 animate-list-item',
                      idx === 0 ? 'bg-main' : 'bg-secondary-background'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge
                        variant={
                          idx === 0
                            ? 'warning'
                            : idx === 1
                            ? 'info'
                            : idx === 2
                            ? 'purple'
                            : 'neutral'
                        }
                        className="text-sm px-2.5 py-1"
                      >
                        #{idx + 1}
                      </Badge>
                      <span className="font-heading text-lg md:text-xl font-bold truncate">
                        @{p.nickname}
                      </span>
                    </div>
                    <span className="font-heading text-lg md:text-xl font-extrabold tabular-nums flex-shrink-0">
                      {p.score} pkt
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* PODIUM + PRZEWIJANA LISTA WSZYSTKICH WYNIKÓW */}
          {status === 'PODIUM' && (
            <Card
              key="podium"
              className="p-6 md:p-10 text-center space-y-8 animate-screen-enter"
            >
              <div className="space-y-3">
                <Badge variant="default" className="text-sm px-3 py-1">
                  Koniec quizu
                </Badge>
                <h1 className="font-heading text-3xl md:text-5xl font-extrabold tracking-tight">
                  Podium zwycięzców
                </h1>
              </div>

              {/* TOP 3 PODIUM */}
              <div className="mx-auto grid max-w-3xl grid-cols-3 items-end gap-3 sm:gap-6 pt-4 pb-2 pr-1 min-h-[18rem]">
                {/* 2 MIEJSCE */}
                <div className="flex flex-col items-center">
                  {revealedPodiumStep >= 2 && podiumData[1] && (
                    <div className="flex h-48 w-full flex-col justify-between rounded-base border-2 border-border bg-secondary-background p-3 sm:p-4 shadow-shadow animate-podium-rise">
                      <div>
                        <Badge variant="info" className="text-sm px-3 py-1">
                          #2
                        </Badge>
                      </div>
                      <div className="font-heading text-lg sm:text-xl font-extrabold truncate">
                        @{podiumData[1].nickname}
                      </div>
                      <div className="font-heading text-sm sm:text-base font-bold tabular-nums">
                        {podiumData[1].score} pkt
                      </div>
                    </div>
                  )}
                </div>

                {/* 1 MIEJSCE */}
                <div className="flex flex-col items-center">
                  {revealedPodiumStep >= 3 && podiumData[0] && (
                    <div className="flex h-64 w-full flex-col justify-between rounded-base border-2 border-border bg-main text-main-foreground p-3 sm:p-5 shadow-shadow animate-podium-rise">
                      <div>
                        <Badge variant="warning" className="text-sm px-3 py-1">
                          #1 Zwycięzca
                        </Badge>
                      </div>
                      <div className="font-heading text-xl sm:text-2xl font-extrabold truncate">
                        @{podiumData[0].nickname}
                      </div>
                      <div className="font-heading text-base sm:text-xl font-extrabold tabular-nums">
                        {podiumData[0].score} pkt
                      </div>
                    </div>
                  )}
                </div>

                {/* 3 MIEJSCE */}
                <div className="flex flex-col items-center">
                  {revealedPodiumStep >= 1 && podiumData[2] && (
                    <div className="flex h-36 w-full flex-col justify-between rounded-base border-2 border-border bg-secondary-background p-3 sm:p-4 shadow-shadow animate-podium-rise">
                      <div>
                        <Badge variant="purple" className="text-sm px-3 py-1">
                          #3
                        </Badge>
                      </div>
                      <div className="font-heading text-base sm:text-lg font-extrabold truncate">
                        @{podiumData[2].nickname}
                      </div>
                      <div className="font-heading text-xs sm:text-sm font-bold tabular-nums">
                        {podiumData[2].score} pkt
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* LISTA WSZYSTKICH WYNIKÓW POD PODIUM (PRZEWIJANY WIDOK) */}
              {(revealedPodiumStep >= 4 || podiumData.length === 0) && (
                <div className="mx-auto max-w-3xl border-t-2 border-border pt-6 text-left space-y-4 animate-slide-up">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-heading text-xl font-extrabold">
                      Pełna klasyfikacja wyników
                    </h2>
                    <Badge variant="neutral" className="text-sm px-3 py-1 tabular-nums">
                      {allResults.length}{' '}
                      {allResults.length === 1 ? 'uczestnik' : 'uczestników'}
                    </Badge>
                  </div>

                  {allResults.length === 0 ? (
                    <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
                      Brak zapisanych wyników w tej sesji.
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto rounded-base border-2 border-border bg-background p-3 space-y-2">
                      {allResults.map((player, idx) => (
                        <div
                          key={player.nickname}
                          style={{
                            animationDelay: `${Math.min(idx, 12) * 35}ms`,
                          }}
                          className={cn(
                            'flex items-center justify-between gap-4 rounded-base border-2 border-border px-4 py-3 animate-list-item',
                            player.place === 1
                              ? 'bg-main'
                              : 'bg-secondary-background'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Badge
                              variant={
                                player.place === 1
                                  ? 'warning'
                                  : player.place === 2
                                  ? 'info'
                                  : player.place === 3
                                  ? 'purple'
                                  : 'neutral'
                              }
                              className="min-w-[2.75rem] text-sm py-0.5 tabular-nums"
                            >
                              #{player.place}
                            </Badge>
                            <span className="font-heading text-base sm:text-lg font-bold truncate">
                              @{player.nickname}
                            </span>
                          </div>
                          <span className="font-heading text-base sm:text-lg font-extrabold tabular-nums flex-shrink-0">
                            {player.score} pkt
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* GRA PRZERWANA PRZEZ PROWADZĄCEGO */}
          {status === 'ABORTED' && (
            <Card
              key="aborted"
              className="mx-auto max-w-xl p-10 text-center space-y-5 animate-screen-enter"
            >
              <Badge variant="danger" className="text-sm px-3 py-1">
                Sesja zakończona
              </Badge>
              <h2 className="font-heading text-3xl font-extrabold">
                Gra została przerwana
              </h2>
              <p className="text-base text-foreground/75">
                Prowadzący zakończył bieżącą sesję quizu. Możesz zamknąć to okno.
              </p>
              <Button
                type="button"
                variant="neutral"
                onClick={() => window.close()}
              >
                Zamknij okno
              </Button>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
