import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
} from './ui';

export function AdminMenu({
  quizzes,
  selectedQuizId,
  setSelectedQuizId,
  onCreateHostRoom,
  onOpenNewQuizEditor,
  onOpenEditQuiz,
  onExportQuiz,
  onDeleteQuiz,
  onImportQuiz,
  importFileRef,
}) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 animate-screen-enter">
      {/* Sekcja: uruchom quiz */}
      <Card>
        <CardHeader>
          <CardTitle>Uruchom sesję quizu</CardTitle>
          <CardDescription>
            Wybierz zestaw pytań — ekran gry (rzutnik) otworzy się w osobnym oknie, a tutaj pojawi się panel prowadzącego.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="quiz-select">Wybierz quiz</Label>
            <Select
              id="quiz-select"
              value={selectedQuizId}
              onChange={(e) => setSelectedQuizId(e.target.value)}
            >
              {quizzes.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title} ({q.questionsCount || '?'} pytań)
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onCreateHostRoom}
            className="w-full"
          >
            Uruchom serwer quizu (Otwórz ekran gry + Panel prowadzącego)
          </Button>
        </CardContent>
      </Card>

      {/* Sekcja: zarządzanie quizami */}
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>Baza quizów</CardTitle>
            <Badge variant="neutral">{quizzes.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="sm" onClick={onOpenNewQuizEditor}>
              + Nowy quiz
            </Button>
            <Button as="label" variant="neutral" size="sm">
              ↑ Importuj JSON
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={onImportQuiz}
                className="hidden"
              />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-2 pb-2">
            {quizzes.length === 0 && (
              <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
                Brak quizów w bazie. Utwórz nowy quiz lub zaimportuj plik JSON.
              </div>
            )}
            {quizzes.map((q) => (
              <div
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-border bg-background p-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-base font-bold truncate">
                      {q.title}
                    </span>
                    {selectedQuizId === q.id && (
                      <Badge variant="default">Wybrany</Badge>
                    )}
                  </div>
                  <div className="text-xs text-foreground/75">
                    {q.questionsCount || '?'} pytań • ID: {q.id.slice(0, 8)}...
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => onOpenEditQuiz(q.id)}
                  >
                    Edytuj
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => onExportQuiz(q.id)}
                  >
                    ↓ Eksport
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => onDeleteQuiz(q.id)}
                  >
                    Usuń
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
