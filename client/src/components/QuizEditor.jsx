import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  cn,
} from './ui';
import { ANSWER_OPTIONS } from '../constants';

export function QuizEditor({
  editingQuizId,
  editorTitle,
  setEditorTitle,
  editorQuestions,
  setEditorQuestions,
  onSaveQuiz,
}) {
  const updateEditorQuestion = (qIdx, field, value) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy[qIdx] = { ...copy[qIdx], [field]: value };
      return copy;
    });
  };

  const updateEditorAnswer = (qIdx, aIdx, value) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const answers = [...copy[qIdx].answers];
      answers[aIdx] = value;
      copy[qIdx] = { ...copy[qIdx], answers };
      return copy;
    });
  };

  return (
    <main className="mx-auto w-full max-w-3xl pb-4 animate-screen-enter">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>
                {editingQuizId ? 'Edycja quizu' : 'Nowy quiz'}
              </CardTitle>
              <CardDescription>
                Dodaj pytania, ustaw limit czasu i wskaż poprawną odpowiedź.
              </CardDescription>
            </div>
            <Badge variant="default">
              {editorQuestions.length}{' '}
              {editorQuestions.length === 1 ? 'pytanie' : 'pytań'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSaveQuiz} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="quiz-title">Nazwa quizu</Label>
              <Input
                id="quiz-title"
                required
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                placeholder="np. Architektura systemów Linux"
              />
            </div>

            <div className="space-y-5">
              {editorQuestions.map((q, qIdx) => (
                <div
                  key={qIdx}
                  className="rounded-base border-2 border-border bg-background p-4 md:p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Badge variant="default">Pytanie #{qIdx + 1}</Badge>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`time-${qIdx}`} className="text-xs">
                          Limit czasu (s):
                        </Label>
                        <Input
                          id={`time-${qIdx}`}
                          type="number"
                          min="5"
                          max="60"
                          value={q.timeLimit}
                          onChange={(e) =>
                            updateEditorQuestion(
                              qIdx,
                              'timeLimit',
                              Number(e.target.value)
                            )
                          }
                          className="h-9 w-20 text-center font-heading font-bold tabular-nums"
                        />
                      </div>
                      {editorQuestions.length > 1 && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            setEditorQuestions((prev) =>
                              prev.filter((_, i) => i !== qIdx)
                            )
                          }
                        >
                          Usuń
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`q-content-${qIdx}`} className="text-xs">
                      Treść pytania
                    </Label>
                    <Input
                      id={`q-content-${qIdx}`}
                      required
                      placeholder="Wpisz treść pytania..."
                      value={q.content}
                      onChange={(e) =>
                        updateEditorQuestion(qIdx, 'content', e.target.value)
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">
                      Odpowiedzi (zaznacz poprawną)
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {q.answers.map((ans, aIdx) => {
                        const opt = ANSWER_OPTIONS[aIdx];
                        const isCorrect = q.correctIndex === aIdx;
                        return (
                          <div
                            key={aIdx}
                            className={cn(
                              'flex items-center gap-2 rounded-base border-2 border-border p-2 transition-colors',
                              isCorrect ? 'bg-main' : 'bg-secondary-background'
                            )}
                          >
                            <input
                              type="radio"
                              name={`correct-${qIdx}`}
                              aria-label={`Oznacz odpowiedź ${opt.label} jako poprawną`}
                              checked={isCorrect}
                              onChange={() =>
                                updateEditorQuestion(
                                  qIdx,
                                  'correctIndex',
                                  aIdx
                                )
                              }
                              className="h-4 w-4 accent-black cursor-pointer flex-shrink-0"
                            />
                            <Badge
                              variant={opt.badgeVariant}
                              className="flex-shrink-0"
                            >
                              {opt.label}
                            </Badge>
                            <Input
                              required
                              placeholder={`Opcja ${opt.label}`}
                              value={ans}
                              onChange={(e) =>
                                updateEditorAnswer(qIdx, aIdx, e.target.value)
                              }
                              className="h-9 text-sm"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-border pt-5">
              <Button
                type="button"
                variant="neutral"
                onClick={() =>
                  setEditorQuestions((prev) => [
                    ...prev,
                    {
                      content: '',
                      timeLimit: 20,
                      answers: ['', '', '', ''],
                      correctIndex: 0,
                    },
                  ])
                }
              >
                + Dodaj kolejne pytanie
              </Button>
              <Button type="submit" size="lg">
                {editingQuizId ? 'Zapisz zmiany' : 'Utwórz quiz'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
