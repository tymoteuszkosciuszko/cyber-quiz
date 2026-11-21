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
  Input,
  Label,
  cn,
} from './ui';
import { ANSWER_OPTIONS, createEmptyQuestion } from '../constants';
import {
  ANSWER_IMAGE_OPTIONS,
  QUESTION_IMAGE_OPTIONS,
  processImageFile,
} from '../utils/imageUtils';

function ImageIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function GripIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <circle cx="9" cy="6" r="1.75" />
      <circle cx="15" cy="6" r="1.75" />
      <circle cx="9" cy="12" r="1.75" />
      <circle cx="15" cy="12" r="1.75" />
      <circle cx="9" cy="18" r="1.75" />
      <circle cx="15" cy="18" r="1.75" />
    </svg>
  );
}

export function QuizEditor({
  editingQuizId,
  editorTitle,
  setEditorTitle,
  editorQuestions,
  setEditorQuestions,
  onSaveQuiz,
}) {
  const [dragArmedIdx, setDragArmedIdx] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [imageError, setImageError] = useState('');
  const [processingKey, setProcessingKey] = useState('');

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

  const updateEditorAnswerImage = (qIdx, aIdx, imageDataUrl) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const current = copy[qIdx];
      const answerImages = Array.isArray(current.answerImages)
        ? [...current.answerImages]
        : current.answers.map(() => null);
      answerImages[aIdx] = imageDataUrl;
      copy[qIdx] = { ...current, answerImages };
      return copy;
    });
  };

  // ─── Zmiana kolejności pytań ───
  const moveQuestion = (fromIdx, toIdx) => {
    if (
      fromIdx === toIdx ||
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= editorQuestions.length ||
      toIdx >= editorQuestions.length
    ) {
      return;
    }
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const handleQuestionDragStart = (e, idx) => {
    if (dragArmedIdx !== idx) {
      e.preventDefault();
      return;
    }
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleQuestionDragOver = (e, idx) => {
    if (draggedIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) {
      setDragOverIdx(idx);
    }
  };

  const handleQuestionDrop = (e, targetIdx) => {
    if (draggedIdx === null) return;
    e.preventDefault();
    if (draggedIdx !== targetIdx) {
      moveQuestion(draggedIdx, targetIdx);
    }
    setDraggedIdx(null);
    setDragOverIdx(null);
    setDragArmedIdx(null);
  };

  const handleQuestionDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
    setDragArmedIdx(null);
  };

  // ─── Obsługa zdjęć dla pytania i odpowiedzi ───
  const handleQuestionImageFile = async (qIdx, file) => {
    if (!file) return;
    const key = `q-${qIdx}`;
    setImageError('');
    setProcessingKey(key);
    try {
      const dataUrl = await processImageFile(file, QUESTION_IMAGE_OPTIONS);
      updateEditorQuestion(qIdx, 'image', dataUrl);
    } catch (err) {
      setImageError(err.message || 'Nie udało się dodać zdjęcia do pytania.');
    } finally {
      setProcessingKey('');
    }
  };

  const handleAnswerImageFile = async (qIdx, aIdx, file) => {
    if (!file) return;
    const key = `a-${qIdx}-${aIdx}`;
    setImageError('');
    setProcessingKey(key);
    try {
      const dataUrl = await processImageFile(file, ANSWER_IMAGE_OPTIONS);
      updateEditorAnswerImage(qIdx, aIdx, dataUrl);
    } catch (err) {
      setImageError(err.message || 'Nie udało się dodać zdjęcia do odpowiedzi.');
    } finally {
      setProcessingKey('');
    }
  };

  const handleImageFileDrop = (e, onFile) => {
    // Nie przechwytuj wewnętrznego przeciągania kolejności pytań
    if (draggedIdx !== null) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    onFile(files[0]);
  };

  const handleImageFileDragOver = (e) => {
    if (draggedIdx !== null) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
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
                Dodaj pytania i zdjęcia, zmieniaj kolejność pytań, ustaw limit czasu i wskaż poprawną odpowiedź.
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
            {imageError && (
              <Alert
                variant="danger"
                className="flex items-center justify-between gap-3 text-sm font-heading font-bold"
              >
                <span>{imageError}</span>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setImageError('')}
                >
                  Zamknij
                </Button>
              </Alert>
            )}

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
              {editorQuestions.map((q, qIdx) => {
                const isDragged = draggedIdx === qIdx;
                const isDropTarget =
                  dragOverIdx === qIdx &&
                  draggedIdx !== null &&
                  draggedIdx !== qIdx;
                const isProcessingQuestionImg = processingKey === `q-${qIdx}`;

                return (
                  <div
                    key={q._uid || qIdx}
                    draggable={dragArmedIdx === qIdx}
                    onMouseUp={() => setDragArmedIdx(null)}
                    onDragStart={(e) => handleQuestionDragStart(e, qIdx)}
                    onDragOver={(e) => handleQuestionDragOver(e, qIdx)}
                    onDrop={(e) => handleQuestionDrop(e, qIdx)}
                    onDragEnd={handleQuestionDragEnd}
                    className={cn(
                      'rounded-base border-2 border-border bg-background p-4 md:p-5 space-y-4 transition-all',
                      isDragged && 'opacity-50 scale-[0.99]',
                      isDropTarget && 'ring-4 ring-main border-border shadow-shadow'
                    )}
                  >
                    {/* Nagłówek karty pytania z kontrolkami kolejności */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {editorQuestions.length > 1 && (
                          <button
                            type="button"
                            onMouseDown={() => setDragArmedIdx(qIdx)}
                            title="Przeciągnij, aby zmienić kolejność pytania"
                            aria-label={`Przeciągnij pytanie ${qIdx + 1}, aby zmienić kolejność`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-base border-2 border-border bg-secondary-background text-foreground cursor-grab active:cursor-grabbing hover:bg-main transition-colors"
                          >
                            <GripIcon className="h-4 w-4" />
                          </button>
                        )}
                        <Badge variant="default">Pytanie #{qIdx + 1}</Badge>

                        {editorQuestions.length > 1 && (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              type="button"
                              variant="neutral"
                              size="sm"
                              disabled={qIdx === 0}
                              onClick={() => moveQuestion(qIdx, qIdx - 1)}
                              title="Przesuń pytanie w górę"
                              aria-label={`Przesuń pytanie ${qIdx + 1} w górę`}
                              className="h-8 w-8 px-0"
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              variant="neutral"
                              size="sm"
                              disabled={qIdx === editorQuestions.length - 1}
                              onClick={() => moveQuestion(qIdx, qIdx + 1)}
                              title="Przesuń pytanie w dół"
                              aria-label={`Przesuń pytanie ${qIdx + 1} w dół`}
                              className="h-8 w-8 px-0"
                            >
                              ↓
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`time-${qIdx}`} className="text-xs">
                            Limit czasu (s):
                          </Label>
                          <Input
                            id={`time-${qIdx}`}
                            type="number"
                            min="5"
                            max="120"
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

                    {/* Treść pytania */}
                    <div className="space-y-1.5">
                      <Label htmlFor={`q-content-${qIdx}`} className="text-xs">
                        Treść pytania{' '}
                        {q.image ? '(opcjonalna, gdy dodano zdjęcie)' : ''}
                      </Label>
                      <Input
                        id={`q-content-${qIdx}`}
                        required={!q.image}
                        placeholder={
                          q.image
                            ? 'Opcjonalny opis lub pytanie do zdjęcia...'
                            : 'Wpisz treść pytania...'
                        }
                        value={q.content}
                        onChange={(e) =>
                          updateEditorQuestion(qIdx, 'content', e.target.value)
                        }
                      />
                    </div>

                    {/* Zdjęcie do pytania */}
                    <div
                      className="space-y-2"
                      onDragOver={handleImageFileDragOver}
                      onDrop={(e) =>
                        handleImageFileDrop(e, (file) =>
                          handleQuestionImageFile(qIdx, file)
                        )
                      }
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-xs">
                          Zdjęcie do pytania (opcjonalne)
                        </Label>
                        <div className="flex items-center gap-2">
                          <Button
                            as="label"
                            variant="neutral"
                            size="sm"
                            className="h-8 text-xs"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            {isProcessingQuestionImg
                              ? 'Przetwarzanie...'
                              : q.image
                              ? 'Zmień zdjęcie'
                              : 'Dodaj zdjęcie'}
                            <input
                              type="file"
                              accept="image/*"
                              disabled={isProcessingQuestionImg}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleQuestionImageFile(qIdx, file);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                          </Button>
                          {q.image && (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() =>
                                updateEditorQuestion(qIdx, 'image', null)
                              }
                            >
                              Usuń zdjęcie
                            </Button>
                          )}
                        </div>
                      </div>

                      {q.image && (
                        <div className="flex justify-center rounded-base border-2 border-border bg-secondary-background p-2">
                          <img
                            src={q.image}
                            alt={`Podgląd zdjęcia do pytania ${qIdx + 1}`}
                            className="max-h-56 w-auto max-w-full rounded-[3px] object-contain"
                          />
                        </div>
                      )}
                    </div>

                    {/* Odpowiedzi z opcjonalnymi zdjęciami */}
                    <div className="space-y-2">
                      <Label className="text-xs">
                        Odpowiedzi (zaznacz poprawną — każda może zawierać tekst, zdjęcie lub oba)
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {q.answers.map((ans, aIdx) => {
                          const opt = ANSWER_OPTIONS[aIdx];
                          const isCorrect = q.correctIndex === aIdx;
                          const ansImage = q.answerImages?.[aIdx] || null;
                          const isProcessingAnsImg =
                            processingKey === `a-${qIdx}-${aIdx}`;

                          return (
                            <div
                              key={aIdx}
                              onDragOver={handleImageFileDragOver}
                              onDrop={(e) =>
                                handleImageFileDrop(e, (file) =>
                                  handleAnswerImageFile(qIdx, aIdx, file)
                                )
                              }
                              className={cn(
                                'flex flex-col gap-2 rounded-base border-2 border-border p-2 transition-colors',
                                isCorrect
                                  ? 'bg-main'
                                  : 'bg-secondary-background'
                              )}
                            >
                              <div className="flex items-center gap-2">
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
                                  required={!ansImage}
                                  placeholder={
                                    ansImage
                                      ? `Opis ${opt.label} (opcjonalny)`
                                      : `Opcja ${opt.label}`
                                  }
                                  value={ans}
                                  onChange={(e) =>
                                    updateEditorAnswer(
                                      qIdx,
                                      aIdx,
                                      e.target.value
                                    )
                                  }
                                  className="h-9 text-sm"
                                />
                                <Button
                                  as="label"
                                  variant="neutral"
                                  size="sm"
                                  title={
                                    ansImage
                                      ? `Zmień zdjęcie odpowiedzi ${opt.label}`
                                      : `Dodaj zdjęcie do odpowiedzi ${opt.label}`
                                  }
                                  aria-label={
                                    ansImage
                                      ? `Zmień zdjęcie odpowiedzi ${opt.label}`
                                      : `Dodaj zdjęcie do odpowiedzi ${opt.label}`
                                  }
                                  className="h-9 w-9 px-0 flex-shrink-0"
                                >
                                  <ImageIcon className="h-4 w-4" />
                                  <input
                                    type="file"
                                    accept="image/*"
                                    disabled={isProcessingAnsImg}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        handleAnswerImageFile(qIdx, aIdx, file);
                                      }
                                      e.target.value = '';
                                    }}
                                    className="hidden"
                                  />
                                </Button>
                              </div>

                              {isProcessingAnsImg && (
                                <div className="text-center text-xs font-heading font-bold py-2">
                                  Przetwarzanie zdjęcia...
                                </div>
                              )}

                              {ansImage && !isProcessingAnsImg && (
                                <div className="relative flex items-center justify-center rounded-base border-2 border-border bg-background p-1.5">
                                  <img
                                    src={ansImage}
                                    alt={`Podgląd zdjęcia odpowiedzi ${opt.label}`}
                                    className="max-h-28 w-auto max-w-full rounded-[3px] object-contain"
                                  />
                                  <Button
                                    type="button"
                                    variant="danger"
                                    size="sm"
                                    onClick={() =>
                                      updateEditorAnswerImage(qIdx, aIdx, null)
                                    }
                                    title={`Usuń zdjęcie z odpowiedzi ${opt.label}`}
                                    aria-label={`Usuń zdjęcie z odpowiedzi ${opt.label}`}
                                    className="absolute right-1.5 top-1.5 h-7 w-7 px-0 text-xs"
                                  >
                                    ✕
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-border pt-5">
              <Button
                type="button"
                variant="neutral"
                onClick={() =>
                  setEditorQuestions((prev) => [...prev, createEmptyQuestion()])
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
