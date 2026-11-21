import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  cn,
} from './ui';
import { ANSWER_OPTIONS, HOST_STATUS_META } from '../constants';

export function HostControlPanel({
  roomPin,
  activeQuiz,
  hostStatus,
  connectedScreens,
  popupBlocked,
  playersList,
  countdownSeconds,
  currentQuestion,
  previewTimeLeft,
  previewDuration,
  timeLeft,
  answerCount,
  leaderboardData,
  autoNextSeconds,
  allResults,
  onOpenGameScreen,
  onStartGame,
  onForceNext,
  onTogglePause,
  onAbortGame,
  onFinishSession,
}) {
  const [copiedKey, setCopiedKey] = useState('');

  const statusMeta = HOST_STATUS_META[hostStatus] || {
    label: hostStatus,
    variant: 'neutral',
  };

  const screenUrl = `${window.location.origin}/game-screen?pin=${roomPin}`;
  const playerUrl = `${window.location.origin}/?pin=${roomPin}`;

  const copyToClipboard = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    });
  };

  const activeQuestionIndex = currentQuestion?.qIndex ?? -1;
  const activeQuizQuestion =
    activeQuestionIndex >= 0 && activeQuiz?.questions?.[activeQuestionIndex]
      ? activeQuiz.questions[activeQuestionIndex]
      : null;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 animate-screen-enter">
      {/* OSTRZEŻENIE O ZABLOKOWANYM POPUPIE */}
      {popupBlocked && connectedScreens === 0 && (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-heading font-bold">
            Przeglądarka zablokowała automatyczne otwarcie okna ekranu gry. Kliknij przycisk obok, aby otworzyć ekran rzutnika.
          </div>
          <Button type="button" size="sm" onClick={onOpenGameScreen}>
            ↗ Otwórz ekran gry
          </Button>
        </Alert>
      )}

      {/* PASEK STATUSU SESJI I EKRANU GRY */}
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
              <Badge
                variant={connectedScreens > 0 ? 'default' : 'warning'}
                className="tabular-nums"
              >
                {connectedScreens > 0
                  ? `Ekran gry: Połączony (${connectedScreens})`
                  : 'Ekran gry: Nieotwarty'}
              </Badge>
              <Badge variant="neutral" className="tabular-nums">
                Gracze: {playersList.length}
              </Badge>
            </div>
            <CardTitle className="truncate">
              {activeQuiz?.title || 'Aktywna sesja quizu'}
            </CardTitle>
            <CardDescription>
              Panel prowadzącego — steruj przebiegiem rundy bez przełączania się na ekran rzutnika.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3 flex-shrink-0">
            <div className="rounded-base border-2 border-border bg-background px-4 py-2 text-center">
              <div className="text-[10px] font-heading font-bold uppercase tracking-wide text-foreground/75">
                PIN sesji
              </div>
              <div className="font-heading text-2xl font-extrabold tracking-[0.15em] tabular-nums leading-tight">
                {roomPin}
              </div>
            </div>

            <Button type="button" size="default" onClick={onOpenGameScreen}>
              ↗ {connectedScreens > 0 ? 'Przywołaj ekran gry' : 'Otwórz ekran gry'}
            </Button>

            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => copyToClipboard(screenUrl, 'screen')}
            >
              {copiedKey === 'screen' ? '✓ Skopiowano' : 'Kopiuj link ekranu'}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEWA KOLUMNA: PANEL STEROWANIA (5 kolumn) */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sterowanie grą</CardTitle>
              <CardDescription>
                Dostępne akcje dla bieżącej fazy rozgrywki.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* LOBBY */}
              {hostStatus === 'LOBBY' && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    size="lg"
                    onClick={onStartGame}
                    disabled={playersList.length === 0}
                    className="w-full py-4 text-base"
                  >
                    ▶ Rozpocznij quiz
                  </Button>
                  {playersList.length === 0 && (
                    <p className="text-xs text-foreground/75 text-center">
                      Poczekaj, aż przynajmniej 1 gracz dołączy do sesji.
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => copyToClipboard(playerUrl, 'player')}
                    className="w-full"
                  >
                    {copiedKey === 'player'
                      ? '✓ Skopiowano link dla graczy'
                      : 'Kopiuj link dołączania dla graczy'}
                  </Button>
                </div>
              )}

              {/* COUNTDOWN */}
              {hostStatus === 'COUNTDOWN' && (
                <div className="space-y-4">
                  <div className="rounded-base border-2 border-border bg-background p-4 text-center">
                    <div className="text-xs font-heading font-bold uppercase text-foreground/75">
                      Odliczanie startowe
                    </div>
                    <div
                      key={`host-cd-${countdownSeconds}`}
                      className="font-heading text-5xl font-extrabold tabular-nums mt-1 animate-countdown-pop"
                    >
                      {countdownSeconds || '•'}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    onClick={onForceNext}
                    className="w-full"
                  >
                    ⏭ Pomiń odliczanie →
                  </Button>
                </div>
              )}

              {/* QUESTION_PREVIEW (5s podglądu pytania) */}
              {hostStatus === 'QUESTION_PREVIEW' && (
                <div className="space-y-4">
                  <div className="rounded-base border-2 border-border bg-background p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs font-heading font-bold uppercase">
                      <span>Podgląd pytania — ujawnienie odpowiedzi</span>
                      <span className="tabular-nums">
                        {previewTimeLeft.toFixed(1)} s
                      </span>
                    </div>
                    <Progress
                      value={
                        previewDuration > 0
                          ? (previewTimeLeft / previewDuration) * 100
                          : 0
                      }
                      indicatorClassName="bg-info"
                    />
                  </div>

                  <Button
                    type="button"
                    size="lg"
                    onClick={onForceNext}
                    className="w-full"
                  >
                    ⏭ Pokaż odpowiedzi teraz →
                  </Button>
                </div>
              )}

              {/* QUESTION (aktywne odpowiadanie) */}
              {hostStatus === 'QUESTION' && currentQuestion && (
                <div className="space-y-4">
                  <div className="rounded-base border-2 border-border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs font-heading font-bold uppercase">
                      <span>Pozostały czas</span>
                      <span className="tabular-nums">{timeLeft.toFixed(1)} s</span>
                    </div>
                    <Progress
                      value={
                        currentQuestion.timeLimit > 0
                          ? (timeLeft / currentQuestion.timeLimit) * 100
                          : 0
                      }
                      indicatorClassName={timeLeft <= 5 ? 'bg-danger' : 'bg-main'}
                    />
                    <div className="flex items-center justify-between pt-1 text-sm font-heading font-bold">
                      <span>Zebrane odpowiedzi:</span>
                      <Badge variant="neutral" className="tabular-nums">
                        {answerCount.count} / {answerCount.total}
                      </Badge>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="lg"
                    onClick={onForceNext}
                    className="w-full"
                  >
                    ⏭ Zakończ pytanie i pokaż wyniki →
                  </Button>
                </div>
              )}

              {/* LEADERBOARD */}
              {hostStatus === 'LEADERBOARD' && leaderboardData && (
                <div className="space-y-3">
                  <div className="rounded-base border-2 border-border bg-background p-4 flex items-center justify-between gap-2">
                    <span className="text-xs font-heading font-bold uppercase text-foreground/75">
                      Automatyczne przejście
                    </span>
                    {leaderboardData.isPaused ? (
                      <Badge variant="warning">Wstrzymane</Badge>
                    ) : (
                      <Badge variant="neutral" className="tabular-nums">
                        za {autoNextSeconds} s
                      </Badge>
                    )}
                  </div>

                  <Button
                    type="button"
                    size="lg"
                    onClick={onForceNext}
                    className="w-full"
                  >
                    {leaderboardData.isLastQuestion
                      ? '🏆 Przejdź do podium →'
                      : '⏭ Przewiń do następnego pytania →'}
                  </Button>

                  <Button
                    type="button"
                    variant="neutral"
                    size="default"
                    onClick={onTogglePause}
                    className="w-full"
                  >
                    {leaderboardData.isPaused
                      ? '▶ Wznów automatyczne przejście'
                      : '⏸ Wstrzymaj automatyczne przejście'}
                  </Button>
                </div>
              )}

              {/* PODIUM */}
              {hostStatus === 'PODIUM' && (
                <div className="space-y-3">
                  <Alert variant="default" className="text-sm font-heading font-bold">
                    Quiz został zakończony. Na ekranie gry wyświetlane jest podium oraz pełna lista wyników.
                  </Alert>
                  <Button
                    type="button"
                    size="lg"
                    onClick={onFinishSession}
                    className="w-full"
                  >
                    ✓ Zakończ sesję i wróć do menu
                  </Button>
                </div>
              )}

              {/* SEKCJA PRZERWANIA GRY */}
              {hostStatus !== 'PODIUM' && (
                <div className="border-t-2 border-border pt-4">
                  <Button
                    type="button"
                    variant="danger"
                    size="default"
                    onClick={onAbortGame}
                    className="w-full"
                  >
                    ✕ Przerwij grę
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PLAN PYTAŃ QUIZU */}
          {activeQuiz?.questions && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">Pytania w quizie</CardTitle>
                  <Badge variant="neutral" className="tabular-nums">
                    {activeQuiz.questions.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {activeQuiz.questions.map((q, idx) => {
                    const isCurrent =
                      idx === activeQuestionIndex &&
                      (hostStatus === 'QUESTION_PREVIEW' ||
                        hostStatus === 'QUESTION' ||
                        hostStatus === 'LEADERBOARD');
                    const isDone =
                      hostStatus === 'PODIUM' ||
                      (activeQuestionIndex > idx && hostStatus !== 'LOBBY');

                    return (
                      <div
                        key={idx}
                        className={cn(
                          'flex items-start gap-2.5 rounded-base border-2 border-border px-3 py-2 text-xs transition-colors',
                          isCurrent
                            ? 'bg-main font-bold'
                            : isDone
                            ? 'bg-background opacity-75'
                            : 'bg-secondary-background'
                        )}
                      >
                        <Badge
                          variant={
                            isCurrent
                              ? 'warning'
                              : isDone
                              ? 'default'
                              : 'neutral'
                          }
                          className="flex-shrink-0 text-[11px] px-1.5 py-0"
                        >
                          {isDone ? '✓' : `#${idx + 1}`}
                        </Badge>
                        <span className="line-clamp-2 leading-snug flex-1 min-w-0">
                          {q.content || '(Pytanie ze zdjęciem)'}
                        </span>
                        {(q.image || q.answerImages?.some(Boolean)) && (
                          <Badge
                            variant="info"
                            className="flex-shrink-0 text-[10px] px-1.5 py-0"
                            title="Pytanie zawiera zdjęcia"
                          >
                            IMG
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* PRAWA KOLUMNA: PODGLĄD PROWADZĄCEGO (7 kolumn) */}
        <div className="lg:col-span-7 space-y-6">
          {/* PODGLĄD W LOBBY: LISTA GRACZY */}
          {(hostStatus === 'LOBBY' || hostStatus === 'COUNTDOWN') && (
            <Card key="panel-lobby" className="animate-screen-enter">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Połączeni uczestnicy</CardTitle>
                  <Badge variant="default" className="tabular-nums">
                    {playersList.length}
                  </Badge>
                </div>
                <CardDescription>
                  Gracze widoczni na żywo po zeskanowaniu kodu QR lub wpisaniu PIN-u na ekranie gry.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto rounded-base border-2 border-border bg-background p-4">
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
                      Oczekiwanie na pierwszego gracza... Udostępnij PIN{' '}
                      <strong>{roomPin}</strong> lub otwórz ekran gry na rzutniku.
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* PODGLĄD AKTYWNEGO PYTANIA DLA PROWADZĄCEGO (z zaznaczoną poprawną odpowiedzią!) */}
          {(hostStatus === 'QUESTION_PREVIEW' ||
            hostStatus === 'QUESTION' ||
            hostStatus === 'LEADERBOARD') &&
            activeQuizQuestion && (
              <Card
                key={`panel-q-${activeQuestionIndex}`}
                className="animate-screen-enter"
              >
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>
                      Podgląd pytania {activeQuestionIndex + 1} /{' '}
                      {activeQuiz.questions.length}
                    </CardTitle>
                    <Badge variant="neutral">Tylko dla prowadzącego</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-base border-2 border-border bg-background p-4 space-y-3">
                    {activeQuizQuestion.content && (
                      <div className="font-heading text-lg font-extrabold leading-snug">
                        {activeQuizQuestion.content}
                      </div>
                    )}
                    {activeQuizQuestion.image && (
                      <div className="flex justify-center">
                        <img
                          src={activeQuizQuestion.image}
                          alt="Zdjęcie do pytania"
                          className="max-h-40 w-auto max-w-full rounded-base border-2 border-border bg-secondary-background object-contain p-1"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeQuizQuestion.answers.map((ans, idx) => {
                      const opt = ANSWER_OPTIONS[idx];
                      const isCorrect = idx === activeQuizQuestion.correctIndex;
                      const ansImg = activeQuizQuestion.answerImages?.[idx];
                      const distCount =
                        hostStatus === 'LEADERBOARD' && leaderboardData?.distribution
                          ? leaderboardData.distribution[idx]
                          : null;

                      return (
                        <div
                          key={idx}
                          className={cn(
                            'flex flex-col gap-2 rounded-base border-2 border-border p-3',
                            isCorrect ? 'bg-main shadow-shadow' : 'bg-secondary-background'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Badge variant={opt.badgeVariant} className="flex-shrink-0">
                                {opt.label}
                              </Badge>
                              <span className="font-heading text-sm font-bold truncate">
                                {ans || (ansImg ? `Zdjęcie ${opt.label}` : '')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {distCount !== null && (
                                <Badge variant="neutral" className="tabular-nums">
                                  {distCount}
                                </Badge>
                              )}
                              {isCorrect && <Badge variant="warning">✓ Poprawna</Badge>}
                            </div>
                          </div>
                          {ansImg && (
                            <div className="flex h-24 w-full items-center justify-center rounded-base border-2 border-border bg-background p-1 overflow-hidden">
                              <img
                                src={ansImg}
                                alt={`Zdjęcie odpowiedzi ${opt.label}`}
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Top 5 w fazie LEADERBOARD */}
                  {hostStatus === 'LEADERBOARD' && leaderboardData?.topPlayers && (
                    <div className="border-t-2 border-border pt-4 space-y-2.5">
                      <div className="text-xs font-heading font-bold uppercase tracking-wide text-foreground/75">
                        Aktualne Top 5
                      </div>
                      <div className="space-y-2">
                        {leaderboardData.topPlayers.map((p, idx) => (
                          <div
                            key={p.nickname}
                            className={cn(
                              'flex items-center justify-between rounded-base border-2 border-border px-3.5 py-2 text-sm',
                              idx === 0 ? 'bg-main' : 'bg-background'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant="neutral">#{idx + 1}</Badge>
                              <span className="font-heading font-bold truncate">
                                @{p.nickname}
                              </span>
                            </div>
                            <span className="font-heading font-extrabold tabular-nums">
                              {p.score} pkt
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          {/* PEŁNA TABELA WYNIKÓW NA KONIEC QUIZU (PODGLĄD PROWADZĄCEGO) */}
          {hostStatus === 'PODIUM' && (
            <Card key="panel-podium" className="animate-screen-enter">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Pełna klasyfikacja końcowa</CardTitle>
                  <Badge variant="default" className="tabular-nums">
                    {allResults.length} wyników
                  </Badge>
                </div>
                <CardDescription>
                  Kompletna lista wszystkich uczestników posortowana według zdobytych punktów.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {allResults.length === 0 ? (
                  <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
                    Brak wyników do wyświetlenia.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-base border-2 border-border bg-background p-3 space-y-2">
                    {allResults.map((p) => (
                      <div
                        key={p.nickname}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-base border-2 border-border px-3.5 py-2.5',
                          p.place === 1 ? 'bg-main' : 'bg-secondary-background'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Badge
                            variant={
                              p.place === 1
                                ? 'warning'
                                : p.place === 2
                                ? 'info'
                                : p.place === 3
                                ? 'purple'
                                : 'neutral'
                            }
                            className="min-w-[2.5rem] tabular-nums"
                          >
                            #{p.place}
                          </Badge>
                          <span className="font-heading font-bold truncate">
                            @{p.nickname}
                          </span>
                        </div>
                        <span className="font-heading font-extrabold tabular-nums flex-shrink-0">
                          {p.score} pkt
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
