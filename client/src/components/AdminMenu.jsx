import { useEffect, useMemo, useState } from 'react';
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
  Switch,
} from './ui';
import { QUIZ_MODES } from '../constants';

const HIDE_TEMPLATES_STORAGE_KEY = 'cyber-quiz:hide-default-templates';

function readHideTemplatesPref() {
  try {
    return window.localStorage.getItem(HIDE_TEMPLATES_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AdminMenu({
  quizzes,
  selectedQuizId,
  setSelectedQuizId,
  onCreateHostRoom,
  onOpenNewQuizEditor,
  onOpenEditQuiz,
  onCloneQuiz,
  onExportQuiz,
  onDeleteQuiz,
  onImportQuiz,
  importFileRef,
}) {
  const [hideDefaultTemplates, setHideDefaultTemplates] = useState(
    readHideTemplatesPref
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIDE_TEMPLATES_STORAGE_KEY,
        String(hideDefaultTemplates)
      );
    } catch {
      // ignore storage errors
    }
  }, [hideDefaultTemplates]);

  const templatesCount = useMemo(
    () => quizzes.filter((q) => q.isTemplate).length,
    [quizzes]
  );

  const visibleQuizzes = useMemo(
    () =>
      hideDefaultTemplates ? quizzes.filter((q) => !q.isTemplate) : quizzes,
    [quizzes, hideDefaultTemplates]
  );

  const effectiveSelectedQuizId = visibleQuizzes.some(
    (q) => q.id === selectedQuizId
  )
    ? selectedQuizId
    : '';

  useEffect(() => {
    if (quizzes.length === 0) return;

    const selectedInVisible = visibleQuizzes.some(
      (q) => q.id === selectedQuizId
    );
    if (selectedInVisible) return;

    const selectedInAll = quizzes.some((q) => q.id === selectedQuizId);
    if (visibleQuizzes.length === 0) {
      if (selectedInAll) {
        setSelectedQuizId('');
      }
      return;
    }

    if (!selectedQuizId || selectedInAll) {
      setSelectedQuizId(visibleQuizzes[0].id);
    }
  }, [quizzes, visibleQuizzes, selectedQuizId, setSelectedQuizId]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 animate-screen-enter">
      {/* Sekcja: uruchom quiz */}
      <Card>
        <CardHeader>
          <CardTitle>Uruchom sesję quizu</CardTitle>
          <CardDescription>
            Wybierz zestaw pytań (Quiz, Opinie lub Tryb mieszany) — ekran gry otworzy się w osobnym oknie, a tutaj pojawi się panel prowadzącego.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="quiz-select">Wybierz zestaw</Label>
            <Select
              id="quiz-select"
              value={effectiveSelectedQuizId}
              onChange={(e) => setSelectedQuizId(e.target.value)}
              disabled={visibleQuizzes.length === 0}
            >
              {visibleQuizzes.length === 0 ? (
                <option value="">Brak widocznych zestawów</option>
              ) : (
                visibleQuizzes.map((q) => {
                  const modeMeta = QUIZ_MODES[q.mode] || QUIZ_MODES.quiz;
                  return (
                    <option key={q.id} value={q.id}>
                      [{modeMeta.code}] {q.isTemplate ? '(Szablon) ' : ''}
                      {q.title} ({q.questionsCount || '?'} pytań)
                    </option>
                  );
                })
              )}
            </Select>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onCreateHostRoom}
            disabled={!effectiveSelectedQuizId}
            className="w-full"
          >
            Uruchom serwer sesji (Otwórz ekran gry + Panel prowadzącego)
          </Button>
        </CardContent>
      </Card>

      {/* Sekcja: zarządzanie quizami */}
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CardTitle>Twoje zestawy i szablony</CardTitle>
              <Badge variant="neutral">{visibleQuizzes.length}</Badge>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" size="sm" onClick={onOpenNewQuizEditor}>
                + Nowy zestaw
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
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-border bg-background px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <Switch
                id="hide-default-templates-switch"
                checked={hideDefaultTemplates}
                onCheckedChange={setHideDefaultTemplates}
              />
              <Label
                htmlFor="hide-default-templates-switch"
                className="cursor-pointer select-none"
              >
                Ukryj domyślne szablony
              </Label>
            </div>
            {templatesCount > 0 && (
              <span className="text-xs text-foreground/75">
                {hideDefaultTemplates
                  ? `Ukryto szablonów: ${templatesCount}`
                  : `Domyślne szablony: ${templatesCount}`}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2 pb-2">
            {quizzes.length === 0 && (
              <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
                Brak zestawów w bazie. Utwórz nowy zestaw lub zaimportuj plik JSON.
              </div>
            )}
            {quizzes.length > 0 && visibleQuizzes.length === 0 && (
              <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
                Brak własnych zestawów. Domyślne szablony są ukryte — wyłącz przełącznik powyżej, utwórz nowy zestaw lub zaimportuj plik JSON.
              </div>
            )}
            {visibleQuizzes.map((q) => {
              const modeMeta = QUIZ_MODES[q.mode] || QUIZ_MODES.quiz;
              return (
                <div
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-border bg-background p-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-base font-bold truncate">
                        {q.title}
                      </span>
                      <Badge variant={modeMeta.badgeVariant}>
                        {modeMeta.label} [{modeMeta.code}]
                      </Badge>
                      {q.isTemplate && (
                        <Badge variant="warning">Szablon</Badge>
                      )}
                      {effectiveSelectedQuizId === q.id && (
                        <Badge variant="default">Wybrany</Badge>
                      )}
                      {q.hasImages && <Badge variant="info">Zdjęcia</Badge>}
                    </div>
                    <div className="text-xs text-foreground/75">
                      {q.questionsCount || '?'} pytań •{' '}
                      {q.isTemplate
                        ? 'Wbudowany szablon (sklonuj, aby edytować)'
                        : 'Twój prywatny zestaw'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 flex-shrink-0">
                    {q.canEdit && (
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        onClick={() => onOpenEditQuiz(q.id)}
                      >
                        Edytuj
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      onClick={() => onCloneQuiz(q.id)}
                    >
                      ⧉ Klonuj
                    </Button>
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      onClick={() => onExportQuiz(q.id)}
                    >
                      ↓ Eksport
                    </Button>
                    {q.canDelete && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => onDeleteQuiz(q.id)}
                      >
                        Usuń
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
