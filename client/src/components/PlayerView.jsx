import { useState, useEffect } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  cn,
} from './ui';
import {
  ANSWER_OPTIONS,
  QUESTION_TYPES,
  TRUE_FALSE_OPTIONS,
} from '../constants';

function snapToStep(val, min, max, step) {
  const safeStep = step > 0 ? step : 1;
  const snapped = min + Math.round((val - min) / safeStep) * safeStep;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Number(clamped.toFixed(6));
}

export function PlayerView({
  playerState,
  playerPin,
  setPlayerPin,
  nickname,
  setNickname,
  joinError,
  playerCountdown,
  playerPreview,
  playerPreviewTimeLeft,
  padQuestion,
  playerResult,
  onJoin,
  onSubmitAnswer,
  onResetToJoin,
}) {
  const [sliderValue, setSliderValue] = useState(50);
  const [wordText, setWordText] = useState('');

  // Resetuj stan lokalnych kontrolek przy każdym nowym pytaniu
  useEffect(() => {
    if (!padQuestion) return;
    if (padQuestion.questionType === 'slider') {
      const min = Number(padQuestion.sliderMin ?? 0);
      const max = Number(padQuestion.sliderMax ?? 100);
      const step = Number(padQuestion.sliderStep ?? 1) || 1;
      setSliderValue(snapToStep((min + max) / 2, min, max, step));
    }
    if (padQuestion.questionType === 'word_cloud') {
      setWordText('');
    }
  }, [padQuestion]);

  const previewDuration = playerPreview?.previewDuration || 5;
  const previewWholeSeconds = Math.max(1, Math.ceil(playerPreviewTimeLeft));
  const previewTypeMeta =
    QUESTION_TYPES[playerPreview?.questionType || 'abcd'] || QUESTION_TYPES.abcd;

  const padType = padQuestion?.questionType || 'abcd';

  return (
    <main className="mx-auto w-full max-w-md">
      {/* FORMULARZ LOGOWANIA */}
      {playerState === 'JOIN' && (
        <Card key="player-join" className="animate-screen-enter">
          <CardHeader>
            <CardTitle>Dołącz do sesji</CardTitle>
            <CardDescription>
              Wpisz 6-cyfrowy kod PIN z ekranu głównego oraz swój nick.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onJoin} className="space-y-5">
              {joinError && (
                <Alert variant="danger" className="font-heading font-bold">
                  Błąd: {joinError}
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="player-pin">PIN sesji</Label>
                <Input
                  id="player-pin"
                  required
                  value={playerPin}
                  onChange={(e) => setPlayerPin(e.target.value)}
                  placeholder="000000"
                  className="h-14 text-center font-heading text-2xl font-extrabold tracking-[0.2em] tabular-nums"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="player-nickname">Twój nick</Label>
                <Input
                  id="player-nickname"
                  required
                  maxLength={16}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="np. ALEX_99"
                  className="h-14 text-center font-heading text-xl font-bold uppercase"
                />
              </div>

              <Button type="submit" size="lg" className="w-full py-4 text-lg">
                Dołącz do gry
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* OCZEKIWANIE W LOBBY */}
      {playerState === 'WAITING' && (
        <Card
          key="player-waiting"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          <Badge variant="default">Połączono</Badge>
          <div className="space-y-2">
            <div className="text-sm font-heading font-bold text-foreground/75">
              Grasz jako
            </div>
            <div className="font-heading text-3xl font-extrabold">
              @{nickname}
            </div>
          </div>
          <p className="rounded-base border-2 border-border bg-background p-4 text-sm font-base">
            Patrz na ekran główny. Sesja rozpocznie się, gdy prowadzący uruchomi
            grę.
          </p>
        </Card>
      )}

      {/* ODLICZANIE STARTOWE */}
      {playerState === 'COUNTDOWN' && (
        <Card
          key="player-countdown"
          className="p-8 text-center space-y-6 animate-screen-enter"
        >
          <Badge variant="warning">Start za chwilę</Badge>
          <h2 className="font-heading text-2xl font-extrabold">
            Przygotuj się!
          </h2>
          <div
            key={`p-cd-${playerCountdown}`}
            className="mx-auto flex h-36 w-36 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow font-heading text-7xl font-extrabold leading-none tabular-nums animate-countdown-pop"
          >
            {playerCountdown || '•'}
          </div>
          <p className="text-sm text-foreground/75">
            Za chwilę pojawi się pierwsze pytanie.
          </p>
        </Card>
      )}

      {/* PODGLĄD PYTANIA (5s przed ujawnieniem kontrolek) */}
      {playerState === 'PREVIEW' && playerPreview && (
        <Card
          key={`player-preview-${playerPreview.qIndex}`}
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="info" className="text-sm px-3 py-1">
              Pytanie {playerPreview.qIndex + 1} / {playerPreview.totalQuestions}
            </Badge>
            <Badge variant={previewTypeMeta.badgeVariant} className="text-sm px-3 py-1">
              {previewTypeMeta.shortLabel}
            </Badge>
          </div>
          <h2 className="font-heading text-2xl font-extrabold">
            Czytaj pytanie na ekranie!
          </h2>
          <div
            key={`p-prev-${previewWholeSeconds}`}
            className="mx-auto flex h-28 w-28 items-center justify-center rounded-base border-2 border-border bg-warning text-foreground shadow-shadow font-heading text-6xl font-extrabold leading-none tabular-nums animate-countdown-pop"
          >
            {previewWholeSeconds}
          </div>
          <div className="space-y-2">
            <Progress
              value={
                previewDuration > 0
                  ? (playerPreviewTimeLeft / previewDuration) * 100
                  : 0
              }
              indicatorClassName="bg-info"
            />
            <p className="text-xs font-heading font-bold text-foreground/75">
              Odpowiedzi odblokują się za {playerPreviewTimeLeft.toFixed(1)} s
            </p>
          </div>
        </Card>
      )}

      {/* AKTYWNE ODPOWIADANIE — RÓŻNE FORMY PYTAŃ */}
      {playerState === 'PAD' && padQuestion && (
        <>
          {/* 1. ABCD oraz ANKIETA (2–4 przyciski) */}
          {(padType === 'abcd' || padType === 'poll') && (
            <div
              key={`player-pad-${padQuestion.qIndex}`}
              className="space-y-3"
            >
              {padType === 'poll' && (
                <div className="text-center">
                  <Badge variant="purple" className="text-sm px-3 py-1">
                    Ankieta — wybierz swoją odpowiedź
                  </Badge>
                </div>
              )}
              <div
                className={cn(
                  'grid grid-cols-2 gap-4 h-[65vh] min-h-[320px] pr-1 pb-2',
                  (padQuestion.optionsCount || 4) <= 2
                    ? 'grid-rows-1'
                    : 'grid-rows-2'
                )}
              >
                {ANSWER_OPTIONS.slice(0, padQuestion.optionsCount || 4).map(
                  (btn, idx) => (
                    <button
                      key={idx}
                      type="button"
                      style={{ animationDelay: `${idx * 55}ms` }}
                      onClick={() =>
                        onSubmitAnswer({
                          qIndex: padQuestion.qIndex,
                          answerIndex: idx,
                        })
                      }
                      className={cn(
                        'flex flex-col items-center justify-center gap-2 rounded-base border-2 border-border text-foreground shadow-shadow transition-all cursor-pointer select-none hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-answer-reveal',
                        btn.bgClass
                      )}
                    >
                      <span className="text-2xl leading-none" aria-hidden="true">
                        {btn.symbol}
                      </span>
                      <span className="font-heading text-5xl font-extrabold leading-none">
                        {btn.label}
                      </span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* 2. PRAWDA / FAŁSZ */}
          {padType === 'true_false' && (
            <div
              key={`player-tf-${padQuestion.qIndex}`}
              className="grid grid-cols-1 gap-5 h-[62vh] min-h-[300px] pr-1 pb-2"
            >
              {TRUE_FALSE_OPTIONS.map((btn, idx) => (
                <button
                  key={btn.label}
                  type="button"
                  style={{ animationDelay: `${idx * 70}ms` }}
                  onClick={() =>
                    onSubmitAnswer({
                      qIndex: padQuestion.qIndex,
                      answerIndex: idx,
                    })
                  }
                  className={cn(
                    'flex items-center justify-center gap-4 rounded-base border-2 border-border text-foreground shadow-shadow transition-all cursor-pointer select-none hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none active:translate-x-boxShadowX active:translate-y-boxShadowY active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-answer-reveal',
                    btn.bgClass
                  )}
                >
                  <span className="font-heading text-4xl font-extrabold leading-none">
                    {btn.symbol}
                  </span>
                  <span className="font-heading text-3xl font-extrabold uppercase tracking-wide">
                    {padQuestion.labels?.[idx] || btn.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* 3. SLIDER */}
          {padType === 'slider' && (() => {
            const min = Number(padQuestion.sliderMin ?? 0);
            const max = Number(padQuestion.sliderMax ?? 100);
            const step = Number(padQuestion.sliderStep ?? 1) || 1;
            const unit = padQuestion.sliderUnit || '';

            return (
              <Card
                key={`player-slider-${padQuestion.qIndex}`}
                className="p-6 space-y-6 animate-screen-enter"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="info">Slider</Badge>
                  <Badge variant={padQuestion.scored ? 'warning' : 'neutral'}>
                    {padQuestion.scored ? 'Punktowane' : 'Opinia'}
                  </Badge>
                </div>

                <div className="rounded-base border-2 border-border bg-main p-5 text-center shadow-shadow">
                  <div className="text-xs font-heading font-bold uppercase text-foreground/80">
                    Twoja wartość
                  </div>
                  <div className="mt-1 font-heading text-5xl font-extrabold tabular-nums">
                    {sliderValue}
                    {unit ? (
                      <span className="ml-1.5 text-2xl font-bold">{unit}</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={sliderValue}
                    onChange={(e) => setSliderValue(Number(e.target.value))}
                    className="h-4 w-full accent-black cursor-pointer"
                    aria-label="Wybierz wartość na suwaku"
                  />
                  <div className="flex items-center justify-between text-xs font-heading font-bold tabular-nums text-foreground/80">
                    <span>
                      {min} {unit}
                    </span>
                    <span>
                      {max} {unit}
                    </span>
                  </div>

                  <div className="flex items-center justify-center gap-3 pt-1">
                    <Button
                      type="button"
                      variant="neutral"
                      size="default"
                      onClick={() =>
                        setSliderValue((prev) =>
                          snapToStep(prev - step, min, max, step)
                        )
                      }
                      className="flex-1 text-lg"
                    >
                      − {step}
                    </Button>
                    <Button
                      type="button"
                      variant="neutral"
                      size="default"
                      onClick={() =>
                        setSliderValue((prev) =>
                          snapToStep(prev + step, min, max, step)
                        )
                      }
                      className="flex-1 text-lg"
                    >
                      + {step}
                    </Button>
                  </div>
                </div>

                <Button
                  type="button"
                  size="lg"
                  className="w-full py-4 text-lg"
                  onClick={() =>
                    onSubmitAnswer({
                      qIndex: padQuestion.qIndex,
                      value: sliderValue,
                    })
                  }
                >
                  Wyślij wartość
                </Button>
              </Card>
            );
          })()}

          {/* 4. CHMURA SŁÓW */}
          {padType === 'word_cloud' && (() => {
            const maxLen = padQuestion.maxLength || 32;
            const trimmed = wordText.trim();

            return (
              <Card
                key={`player-wc-${padQuestion.qIndex}`}
                className="p-6 space-y-5 animate-screen-enter"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="purple">Chmura słów</Badge>
                  <Badge variant="neutral" className="tabular-nums">
                    {wordText.length} / {maxLen}
                  </Badge>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!trimmed) return;
                    onSubmitAnswer({
                      qIndex: padQuestion.qIndex,
                      text: trimmed,
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="player-word-input">Wpisz swoje hasło</Label>
                    <Input
                      id="player-word-input"
                      autoFocus
                      required
                      maxLength={maxLen}
                      value={wordText}
                      onChange={(e) => setWordText(e.target.value)}
                      placeholder="np. Bezpieczeństwo..."
                      className="h-14 text-center font-heading text-xl font-bold"
                    />
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={!trimmed}
                    className="w-full py-4 text-lg"
                  >
                    Wyślij hasło
                  </Button>
                </form>
              </Card>
            );
          })()}
        </>
      )}

      {/* ODPOWIEDŹ ZABLOKOWANA */}
      {playerState === 'LOCKED' && (
        <Card
          key="player-locked"
          className="p-8 text-center space-y-4 animate-screen-enter"
        >
          <Badge variant="warning">Odpowiedź zapisana</Badge>
          <h2 className="font-heading text-2xl font-extrabold">Wysłano!</h2>
          <p className="text-sm text-foreground/75">
            Oczekiwanie na zakończenie rundy i wyświetlenie wyników...
          </p>
        </Card>
      )}

      {/* WYNIK PO PYTANIU */}
      {playerState === 'RESULT' && playerResult && (
        <Card
          key="player-result"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          {playerResult.scored === false ? (
            <>
              <div className="rounded-base border-2 border-border bg-info p-4 shadow-shadow space-y-1">
                <div className="font-heading text-2xl font-extrabold">
                  {playerResult.submitted
                    ? 'Dziękujemy za głos!'
                    : 'Czas minął'}
                </div>
                {playerResult.submittedDisplay && (
                  <div className="font-heading text-sm font-bold">
                    Twoja odpowiedź: {playerResult.submittedDisplay}
                  </div>
                )}
              </div>
              <p className="text-sm text-foreground/75">
                Spójrz na ekran główny, aby zobaczyć zbiorcze wyniki wszystkich uczestników.
              </p>
              {playerResult.sessionMode === 'mixed' && (
                <div className="flex items-center justify-center gap-2 pt-1">
                  <Badge variant="neutral" className="text-sm px-3 py-1 tabular-nums">
                    Wynik quizu: {playerResult.score} pkt
                  </Badge>
                  {playerResult.rank && (
                    <Badge variant="default" className="text-sm px-3 py-1 tabular-nums">
                      Pozycja: #{playerResult.rank}
                    </Badge>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className={cn(
                  'rounded-base border-2 border-border p-4 shadow-shadow',
                  playerResult.isCorrect
                    ? 'bg-main text-main-foreground'
                    : 'bg-danger text-foreground'
                )}
              >
                <div className="font-heading text-2xl font-extrabold">
                  {playerResult.isCorrect
                    ? 'Poprawna odpowiedź!'
                    : 'Błędna odpowiedź'}
                </div>
                {playerResult.isCorrect && playerResult.earnedPoints > 0 && (
                  <div className="mt-1 font-heading text-lg font-bold tabular-nums">
                    +{playerResult.earnedPoints} pkt
                  </div>
                )}
                {playerResult.questionType === 'slider' &&
                  playerResult.correctValue !== undefined && (
                    <div className="mt-2 text-xs font-heading font-bold">
                      Poprawna: {playerResult.correctValue}
                      {playerResult.sliderUnit ? ` ${playerResult.sliderUnit}` : ''}
                      {playerResult.tolerance > 0
                        ? ` (±${playerResult.tolerance})`
                        : ''}
                      {playerResult.submittedValue !== null &&
                      playerResult.submittedValue !== undefined
                        ? ` • Twoja: ${playerResult.submittedValue}${
                            playerResult.sliderUnit
                              ? ` ${playerResult.sliderUnit}`
                              : ''
                          }`
                        : ''}
                    </div>
                  )}
              </div>

              <div className="rounded-base border-2 border-border bg-background p-4 space-y-1">
                <div className="text-xs font-heading font-bold uppercase text-foreground/75">
                  Twój wynik
                </div>
                <div className="font-heading text-3xl font-extrabold tabular-nums">
                  {playerResult.score} pkt
                </div>
              </div>

              <Badge variant="neutral" className="text-sm px-3 py-1">
                Aktualna pozycja: #{playerResult.rank}
              </Badge>
            </>
          )}
        </Card>
      )}

      {/* WYNIK KOŃCOWY */}
      {playerState === 'FINAL' && playerResult && (
        <Card
          key="player-final"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          {playerResult.hasScoredQuestions === false ||
          playerResult.sessionMode === 'opinion' ? (
            <>
              <Badge variant="info">Koniec sesji opinii</Badge>
              <div className="rounded-base border-2 border-border bg-main text-main-foreground p-6 shadow-shadow space-y-2">
                <div className="font-heading text-3xl font-extrabold">
                  Dziękujemy za udział!
                </div>
                <div className="text-sm font-heading font-bold">
                  Twoje odpowiedzi zostały uwzględnione w wynikach końcowych.
                </div>
              </div>
              {playerResult.totalPlayers > 0 && (
                <Badge variant="neutral" className="text-sm px-3 py-1">
                  Uczestników w sesji: {playerResult.totalPlayers}
                </Badge>
              )}
            </>
          ) : (
            <>
              <Badge variant="default">Koniec quizu</Badge>

              <div className="rounded-base border-2 border-border bg-main text-main-foreground p-6 shadow-shadow space-y-1">
                <div className="text-xs font-heading font-bold uppercase">
                  Końcowa pozycja
                </div>
                <div className="font-heading text-5xl font-extrabold tabular-nums">
                  #{playerResult.rank}
                </div>
                {playerResult.totalPlayers && (
                  <div className="text-sm font-heading font-bold">
                    z {playerResult.totalPlayers} uczestników
                  </div>
                )}
              </div>

              <div className="rounded-base border-2 border-border bg-background p-4 space-y-1">
                <div className="text-xs font-heading font-bold uppercase text-foreground/75">
                  Całkowity wynik
                </div>
                <div className="font-heading text-2xl font-extrabold tabular-nums">
                  {playerResult.score} pkt
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      {/* GRA PRZERWANA PRZEZ PROWADZĄCEGO */}
      {playerState === 'ABORTED' && (
        <Card
          key="player-aborted"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          <Badge variant="danger">Sesja przerwana</Badge>
          <h2 className="font-heading text-2xl font-extrabold">
            Gra została zakończona
          </h2>
          <p className="text-sm text-foreground/75">
            Prowadzący przerwał bieżącą sesję. Możesz dołączyć do nowej gry.
          </p>
          <Button
            type="button"
            variant="default"
            size="lg"
            onClick={onResetToJoin}
            className="w-full"
          >
            Dołącz do innej gry
          </Button>
        </Card>
      )}
    </main>
  );
}
