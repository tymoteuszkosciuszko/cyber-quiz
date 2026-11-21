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
import { ANSWER_OPTIONS } from '../constants';

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
  const previewDuration = playerPreview?.previewDuration || 5;
  const previewWholeSeconds = Math.max(1, Math.ceil(playerPreviewTimeLeft));

  return (
    <main className="mx-auto w-full max-w-md">
      {/* FORMULARZ LOGOWANIA */}
      {playerState === 'JOIN' && (
        <Card key="player-join" className="animate-screen-enter">
          <CardHeader>
            <CardTitle>Dołącz do quizu</CardTitle>
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
            Patrz na ekran główny. Quiz rozpocznie się, gdy prowadzący uruchomi
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
            Quiz rozpocznie się za chwilę.
          </p>
        </Card>
      )}

      {/* PODGLĄD PYTANIA (5s przed ujawnieniem przycisków) */}
      {playerState === 'PREVIEW' && playerPreview && (
        <Card
          key={`player-preview-${playerPreview.qIndex}`}
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
          <Badge variant="info" className="text-sm px-3 py-1">
            Pytanie {playerPreview.qIndex + 1} / {playerPreview.totalQuestions}
          </Badge>
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

      {/* 4 PRZYCISKI DO ODPOWIADANIA */}
      {playerState === 'PAD' && padQuestion && (
        <div
          key={`player-pad-${padQuestion.qIndex}`}
          className="grid grid-cols-2 grid-rows-2 gap-4 h-[68vh] min-h-[340px] pr-1 pb-2"
        >
          {ANSWER_OPTIONS.slice(0, padQuestion.optionsCount).map((btn, idx) => (
            <button
              key={idx}
              type="button"
              style={{ animationDelay: `${idx * 55}ms` }}
              onClick={() => onSubmitAnswer(padQuestion.qIndex, idx)}
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
          ))}
        </div>
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
            Oczekiwanie na zakończenie pytania i ogłoszenie wyników...
          </p>
        </Card>
      )}

      {/* WYNIK PO PYTANIU */}
      {playerState === 'RESULT' && playerResult && (
        <Card
          key="player-result"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
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
        </Card>
      )}

      {/* WYNIK KOŃCOWY */}
      {playerState === 'FINAL' && playerResult && (
        <Card
          key="player-final"
          className="p-8 text-center space-y-5 animate-screen-enter"
        >
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
            Prowadzący przerwał bieżącą sesję quizu. Możesz dołączyć do nowej gry.
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
