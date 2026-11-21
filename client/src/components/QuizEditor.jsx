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
  Select,
  cn,
} from './ui';
import {
  ANSWER_OPTIONS,
  QUESTION_TYPES,
  QUIZ_MODES,
  TRUE_FALSE_OPTIONS,
  convertQuestionType,
  createEmptyQuestion,
  getAllowedQuestionTypes,
  isQuestionScored,
} from '../constants';
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
  editorMode,
  setEditorMode,
  editorQuestions,
  setEditorQuestions,
  onSaveQuiz,
}) {
  const [dragArmedIdx, setDragArmedIdx] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [imageError, setImageError] = useState('');
  const [modeNotice, setModeNotice] = useState('');
  const [processingKey, setProcessingKey] = useState('');

  const allowedTypes = getAllowedQuestionTypes(editorMode);
  const modeMeta = QUIZ_MODES[editorMode] || QUIZ_MODES.quiz;

  // ─── Zmiana trybu całego zestawu (Q / O / M) ───
  const handleModeChange = (nextMode) => {
    if (nextMode === editorMode) return;
    const nextAllowed = getAllowedQuestionTypes(nextMode);
    let convertedCount = 0;

    setEditorQuestions((prev) =>
      prev.map((q) => {
        const curType = q.type || 'abcd';
        if (!nextAllowed.includes(curType)) {
          convertedCount++;
          const targetType =
            nextMode === 'opinion'
              ? curType === 'abcd' || curType === 'true_false'
                ? 'poll'
                : 'word_cloud'
              : 'abcd';
          return convertQuestionType(q, targetType, nextMode);
        }
        if (curType === 'slider') {
          return convertQuestionType(q, 'slider', nextMode);
        }
        return q;
      })
    );

    setEditorMode(nextMode);
    if (convertedCount > 0) {
      setModeNotice(
        `Dostosowano ${convertedCount} ${
          convertedCount === 1 ? 'pytanie' : 'pytań'
        } do wybranego trybu „${QUIZ_MODES[nextMode].fullLabel}”.`
      );
    } else {
      setModeNotice('');
    }
  };

  const updateEditorQuestion = (qIdx, field, value) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy[qIdx] = { ...copy[qIdx], [field]: value };
      return copy;
    });
  };

  const changeQuestionType = (qIdx, nextType) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy[qIdx] = convertQuestionType(copy[qIdx], nextType, editorMode);
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

  const addAnswerOption = (qIdx) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const current = copy[qIdx];
      if (!Array.isArray(current.answers) || current.answers.length >= 4) {
        return prev;
      }
      const answers = [...current.answers, ''];
      const answerImages = Array.isArray(current.answerImages)
        ? [...current.answerImages, null]
        : answers.map(() => null);
      copy[qIdx] = { ...current, answers, answerImages };
      return copy;
    });
  };

  const removeAnswerOption = (qIdx, aIdx) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const current = copy[qIdx];
      if (!Array.isArray(current.answers) || current.answers.length <= 2) {
        return prev;
      }
      const answers = current.answers.filter((_, i) => i !== aIdx);
      const answerImages = (
        Array.isArray(current.answerImages)
          ? current.answerImages
          : current.answers.map(() => null)
      ).filter((_, i) => i !== aIdx);
      let correctIndex = current.correctIndex ?? 0;
      if (correctIndex === aIdx) correctIndex = 0;
      else if (correctIndex > aIdx) correctIndex -= 1;
      copy[qIdx] = { ...current, answers, answerImages, correctIndex };
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
                {editingQuizId ? 'Edycja zestawu' : 'Nowy zestaw'}
              </CardTitle>
              <CardDescription>
                Wybierz tryb (Quiz, Opinie lub Mieszany), dobieraj formy pytań, dodawaj zdjęcia i ustawiaj kolejność.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={modeMeta.badgeVariant}>
                {modeMeta.label} [{modeMeta.code}]
              </Badge>
              <Badge variant="default">
                {editorQuestions.length}{' '}
                {editorQuestions.length === 1 ? 'pytanie' : 'pytań'}
              </Badge>
            </div>
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

            {modeNotice && (
              <Alert
                variant="info"
                className="flex items-center justify-between gap-3 text-sm font-heading font-bold"
              >
                <span>{modeNotice}</span>
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setModeNotice('')}
                >
                  OK
                </Button>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="quiz-title">Nazwa zestawu</Label>
              <Input
                id="quiz-title"
                required
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                placeholder="np. Architektura systemów Linux"
              />
            </div>

            {/* Wybór trybu sesji: Quiz [Q] / Opinie [O] / Mieszany [M] */}
            <div className="space-y-2">
              <Label>Tryb sesji</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Object.values(QUIZ_MODES).map((m) => {
                  const selected = editorMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModeChange(m.id)}
                      className={cn(
                        'flex flex-col items-start gap-1.5 rounded-base border-2 border-border p-3.5 text-left transition-all cursor-pointer',
                        selected
                          ? 'bg-main shadow-shadow'
                          : 'bg-background hover:bg-secondary-background'
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="font-heading text-sm font-extrabold">
                          {m.label}
                        </span>
                        <Badge variant={selected ? 'neutral' : m.badgeVariant}>
                          {m.code}
                        </Badge>
                      </div>
                      <span className="text-xs leading-snug text-foreground/80">
                        {m.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5">
              {editorQuestions.map((q, qIdx) => {
                const qType = q.type || 'abcd';
                const typeMeta = QUESTION_TYPES[qType] || QUESTION_TYPES.abcd;
                const scored = isQuestionScored(q, editorMode);
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
                      <div className="flex flex-wrap items-center gap-2">
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
                        <Badge variant={scored ? 'warning' : 'info'}>
                          {scored ? 'Punktowane' : 'Opinia'}
                        </Badge>

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
                            Czas (s):
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

                    {/* Wybór formy pytania */}
                    <div className="space-y-1.5">
                      <Label htmlFor={`q-type-${qIdx}`} className="text-xs">
                        Forma pytania
                      </Label>
                      <Select
                        id={`q-type-${qIdx}`}
                        value={qType}
                        onChange={(e) => changeQuestionType(qIdx, e.target.value)}
                        className="h-10 text-sm"
                      >
                        {allowedTypes.map((t) => (
                          <option key={t} value={t}>
                            {QUESTION_TYPES[t].label}
                          </option>
                        ))}
                      </Select>
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

                    {/* SEKCJA SPECYFICZNA DLA FORMY PYTANIA */}

                    {/* 1. ABCD oraz 2. ANKIETA (POLL) */}
                    {(qType === 'abcd' || qType === 'poll') && (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label className="text-xs">
                            {qType === 'abcd'
                              ? 'Odpowiedzi (zaznacz poprawną — tekst, zdjęcie lub oba)'
                              : 'Opcje ankiety (niepunktowane — pod koniec pojawi się wykres kołowy)'}
                          </Label>
                          {q.answers.length < 4 && (
                            <Button
                              type="button"
                              variant="neutral"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => addAnswerOption(qIdx)}
                            >
                              + Dodaj opcję
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {q.answers.map((ans, aIdx) => {
                            const opt = ANSWER_OPTIONS[aIdx];
                            const isCorrect =
                              qType === 'abcd' && q.correctIndex === aIdx;
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
                                  {qType === 'abcd' && (
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
                                  )}
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
                                        ? `Zmień zdjęcie opcji ${opt.label}`
                                        : `Dodaj zdjęcie do opcji ${opt.label}`
                                    }
                                    aria-label={
                                      ansImage
                                        ? `Zmień zdjęcie opcji ${opt.label}`
                                        : `Dodaj zdjęcie do opcji ${opt.label}`
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
                                  {q.answers.length > 2 && (
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      title={`Usuń opcję ${opt.label}`}
                                      aria-label={`Usuń opcję ${opt.label}`}
                                      onClick={() => removeAnswerOption(qIdx, aIdx)}
                                      className="h-9 w-8 px-0 flex-shrink-0 text-xs"
                                    >
                                      ✕
                                    </Button>
                                  )}
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
                                      alt={`Podgląd zdjęcia opcji ${opt.label}`}
                                      className="max-h-28 w-auto max-w-full rounded-[3px] object-contain"
                                    />
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      onClick={() =>
                                        updateEditorAnswerImage(qIdx, aIdx, null)
                                      }
                                      title={`Usuń zdjęcie z opcji ${opt.label}`}
                                      aria-label={`Usuń zdjęcie z opcji ${opt.label}`}
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
                    )}

                    {/* 3. PRAWDA / FAŁSZ */}
                    {qType === 'true_false' && (
                      <div className="space-y-2">
                        <Label className="text-xs">
                          Poprawna odpowiedź (Prawda / Fałsz)
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                          {TRUE_FALSE_OPTIONS.map((opt, aIdx) => {
                            const isCorrect = q.correctIndex === aIdx;
                            return (
                              <label
                                key={opt.label}
                                className={cn(
                                  'flex items-center justify-center gap-3 rounded-base border-2 border-border p-3.5 cursor-pointer font-heading text-base font-extrabold transition-all',
                                  isCorrect
                                    ? `${opt.bgClass} shadow-shadow`
                                    : 'bg-secondary-background hover:bg-background'
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`correct-${qIdx}`}
                                  checked={isCorrect}
                                  onChange={() =>
                                    updateEditorQuestion(
                                      qIdx,
                                      'correctIndex',
                                      aIdx
                                    )
                                  }
                                  className="h-4 w-4 accent-black cursor-pointer"
                                />
                                <span>{opt.symbol}</span>
                                <span>{opt.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 4. SLIDER (przedział liczbowy) */}
                    {qType === 'slider' && (() => {
                      const sMin = Number(q.sliderMin ?? 0);
                      const sMax = Number(q.sliderMax ?? 100);
                      const sStep = Number(q.sliderStep ?? 1) || 1;
                      const sCorrect = Number(
                        q.sliderCorrect ?? Math.round((sMin + sMax) / 2)
                      );
                      const sTol = Number(q.sliderTolerance ?? 0);

                      return (
                        <div className="space-y-4 rounded-base border-2 border-border bg-secondary-background p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="space-y-1">
                              <Label htmlFor={`s-min-${qIdx}`} className="text-xs">
                                Minimum
                              </Label>
                              <Input
                                id={`s-min-${qIdx}`}
                                type="number"
                                step="any"
                                required
                                value={q.sliderMin ?? 0}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  updateEditorQuestion(qIdx, 'sliderMin', val);
                                }}
                                className="h-9 text-sm font-heading font-bold tabular-nums"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`s-max-${qIdx}`} className="text-xs">
                                Maksimum
                              </Label>
                              <Input
                                id={`s-max-${qIdx}`}
                                type="number"
                                step="any"
                                required
                                value={q.sliderMax ?? 100}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  updateEditorQuestion(qIdx, 'sliderMax', val);
                                }}
                                className="h-9 text-sm font-heading font-bold tabular-nums"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`s-step-${qIdx}`} className="text-xs">
                                Krok
                              </Label>
                              <Input
                                id={`s-step-${qIdx}`}
                                type="number"
                                step="any"
                                min="0.01"
                                required
                                value={q.sliderStep ?? 1}
                                onChange={(e) =>
                                  updateEditorQuestion(
                                    qIdx,
                                    'sliderStep',
                                    Number(e.target.value)
                                  )
                                }
                                className="h-9 text-sm font-heading font-bold tabular-nums"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`s-unit-${qIdx}`} className="text-xs">
                                Jednostka (opcj.)
                              </Label>
                              <Input
                                id={`s-unit-${qIdx}`}
                                maxLength={16}
                                placeholder="np. %, lat, km"
                                value={q.sliderUnit || ''}
                                onChange={(e) =>
                                  updateEditorQuestion(
                                    qIdx,
                                    'sliderUnit',
                                    e.target.value
                                  )
                                }
                                className="h-9 text-sm"
                              />
                            </div>
                          </div>

                          {editorMode === 'mixed' && (
                            <label className="flex items-center gap-2.5 text-sm font-heading font-bold cursor-pointer">
                              <input
                                type="checkbox"
                                checked={scored}
                                onChange={(e) =>
                                  updateEditorQuestion(
                                    qIdx,
                                    'scored',
                                    e.target.checked
                                  )
                                }
                                className="h-4 w-4 accent-black cursor-pointer"
                              />
                              <span>
                                Pytanie punktowane (z poprawną wartością i tolerancją)
                              </span>
                            </label>
                          )}

                          {scored ? (
                            <div className="space-y-3 border-t-2 border-border pt-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label
                                    htmlFor={`s-correct-${qIdx}`}
                                    className="text-xs"
                                  >
                                    Poprawna wartość ({sMin} – {sMax})
                                  </Label>
                                  <Input
                                    id={`s-correct-${qIdx}`}
                                    type="number"
                                    step="any"
                                    min={sMin}
                                    max={sMax}
                                    required
                                    value={q.sliderCorrect ?? sCorrect}
                                    onChange={(e) =>
                                      updateEditorQuestion(
                                        qIdx,
                                        'sliderCorrect',
                                        Number(e.target.value)
                                      )
                                    }
                                    className="h-9 text-sm font-heading font-bold tabular-nums"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label
                                    htmlFor={`s-tol-${qIdx}`}
                                    className="text-xs"
                                  >
                                    Tolerancja (± dla punktów częściowych)
                                  </Label>
                                  <Input
                                    id={`s-tol-${qIdx}`}
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={q.sliderTolerance ?? 0}
                                    onChange={(e) =>
                                      updateEditorQuestion(
                                        qIdx,
                                        'sliderTolerance',
                                        Math.max(0, Number(e.target.value))
                                      )
                                    }
                                    className="h-9 text-sm font-heading font-bold tabular-nums"
                                  />
                                </div>
                              </div>

                              {sMax > sMin && (
                                <div className="space-y-1">
                                  <input
                                    type="range"
                                    min={sMin}
                                    max={sMax}
                                    step={sStep > 0 ? sStep : 1}
                                    value={Math.min(sMax, Math.max(sMin, sCorrect))}
                                    onChange={(e) =>
                                      updateEditorQuestion(
                                        qIdx,
                                        'sliderCorrect',
                                        Number(e.target.value)
                                      )
                                    }
                                    className="w-full accent-black cursor-pointer"
                                  />
                                  <div className="flex justify-between text-xs font-heading font-bold text-foreground/75 tabular-nums">
                                    <span>
                                      {sMin} {q.sliderUnit || ''}
                                    </span>
                                    <span>
                                      Cel: {sCorrect}
                                      {sTol > 0 ? ` (±${sTol})` : ''}{' '}
                                      {q.sliderUnit || ''}
                                    </span>
                                    <span>
                                      {sMax} {q.sliderUnit || ''}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-foreground/75">
                              Tryb niepunktowany — uczestnicy wskazują wartość w przedziale, a na koniec wyświetli się rozkład, średnia i mediana odpowiedzi.
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* 5. CHMURA SŁÓW */}
                    {qType === 'word_cloud' && (
                      <div className="rounded-base border-2 border-border bg-secondary-background p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <div className="text-xs font-heading font-bold">
                              Chmura słów (niepunktowana)
                            </div>
                            <p className="text-xs text-foreground/75">
                              Każdy uczestnik wpisuje krótkie hasło na telefonie — najczęstsze odpowiedzi będą największe na ekranie głównym.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label
                              htmlFor={`wc-len-${qIdx}`}
                              className="text-xs whitespace-nowrap"
                            >
                              Maks. znaków:
                            </Label>
                            <Input
                              id={`wc-len-${qIdx}`}
                              type="number"
                              min="10"
                              max="80"
                              value={q.maxLength ?? 32}
                              onChange={(e) =>
                                updateEditorQuestion(
                                  qIdx,
                                  'maxLength',
                                  Number(e.target.value)
                                )
                              }
                              className="h-9 w-20 text-center font-heading font-bold tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-border pt-5">
              <div className="flex flex-wrap items-center gap-2">
                {allowedTypes.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() =>
                      setEditorQuestions((prev) => [
                        ...prev,
                        createEmptyQuestion(t, editorMode),
                      ])
                    }
                  >
                    + {QUESTION_TYPES[t].shortLabel}
                  </Button>
                ))}
              </div>
              <Button type="submit" size="lg">
                {editingQuizId ? 'Zapisz zmiany' : 'Utwórz zestaw'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
