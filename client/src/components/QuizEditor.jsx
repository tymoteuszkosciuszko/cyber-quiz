import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Label,
  toast,
  cn,
} from './ui';
import {
  ANSWER_OPTIONS,
  QUESTION_TYPES,
  QUIZ_MODES,
  TRUE_FALSE_OPTIONS,
  convertQuestionType,
  createEmptyQuestion,
  createQuestionUid,
  getAllowedQuestionTypes,
  isQuestionScored,
} from '../constants';
import {
  ANSWER_IMAGE_OPTIONS,
  QUESTION_IMAGE_OPTIONS,
  isValidImageValue,
  processImageFile,
} from '../utils/imageUtils';

const TIME_PRESETS = [10, 15, 20, 30, 45, 60];

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

function CopyIcon({ className = 'h-4 w-4' }) {
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
      <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }) {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function getQuestionIssues(q, editorMode) {
  const issues = [];
  if (!q) return ['Brak danych pytania.'];

  const qType = q.type || 'abcd';
  const scored = isQuestionScored(q, editorMode);
  const hasContent =
    (typeof q.content === 'string' && q.content.trim().length > 0) ||
    isValidImageValue(q.image);

  if (!hasContent) {
    issues.push('Wpisz treść pytania lub dodaj zdjęcie.');
  }

  const timeLimit = Number(q.timeLimit);
  if (!Number.isFinite(timeLimit) || timeLimit < 5 || timeLimit > 120) {
    issues.push('Czas odpowiedzi musi wynosić od 5 do 120 sekund.');
  }

  if (qType === 'abcd' || qType === 'poll') {
    const answers = Array.isArray(q.answers) ? q.answers : [];
    if (answers.length < 2) {
      issues.push('Dodaj co najmniej 2 odpowiedzi.');
    }
    answers.forEach((ans, idx) => {
      const hasAns =
        (typeof ans === 'string' && ans.trim().length > 0) ||
        isValidImageValue(q.answerImages?.[idx]);
      if (!hasAns) {
        const label = ANSWER_OPTIONS[idx]?.label || `#${idx + 1}`;
        issues.push(`Uzupełnij odpowiedź ${label} (tekst lub zdjęcie).`);
      }
    });
    if (
      qType === 'abcd' &&
      (!Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex >= answers.length)
    ) {
      issues.push('Zaznacz poprawną odpowiedź.');
    }
  } else if (qType === 'true_false') {
    if (q.correctIndex !== 0 && q.correctIndex !== 1) {
      issues.push('Wybierz poprawną odpowiedź (Prawda lub Fałsz).');
    }
  } else if (qType === 'slider') {
    const sMin = Number(q.sliderMin);
    const sMax = Number(q.sliderMax);
    const sStep = Number(q.sliderStep);
    if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMax <= sMin) {
      issues.push('Wartość maksymalna slidera musi być większa od minimalnej.');
    }
    if (!Number.isFinite(sStep) || sStep <= 0) {
      issues.push('Krok slidera musi być liczbą dodatnią.');
    }
    if (scored) {
      const sCorrect = Number(q.sliderCorrect);
      if (
        !Number.isFinite(sCorrect) ||
        (Number.isFinite(sMin) && sCorrect < sMin) ||
        (Number.isFinite(sMax) && sCorrect > sMax)
      ) {
        issues.push('Poprawna wartość musi mieścić się w przedziale slidera.');
      }
    }
  } else if (qType === 'word_cloud') {
    const maxLen = Number(q.maxLength);
    if (!Number.isFinite(maxLen) || maxLen < 10 || maxLen > 80) {
      issues.push('Maksymalna długość hasła musi wynosić od 10 do 80 znaków.');
    }
  }

  return issues;
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dragArmedIdx, setDragArmedIdx] = useState(null);
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const [processingKey, setProcessingKey] = useState('');

  const listItemRefs = useRef([]);
  const titleInputRef = useRef(null);

  const allowedTypes = getAllowedQuestionTypes(editorMode);
  const modeMeta = QUIZ_MODES[editorMode] || QUIZ_MODES.quiz;

  const safeSelectedIdx = Math.min(
    Math.max(0, selectedIdx),
    Math.max(0, editorQuestions.length - 1)
  );
  const activeQuestion = editorQuestions[safeSelectedIdx] || null;

  // Reset wyboru po otwarciu innego zestawu
  useEffect(() => {
    setSelectedIdx(0);
    setValidationError('');
    setShowValidation(false);
  }, [editingQuizId]);

  // Pilnuj poprawnego zakresu wybranego indeksu
  useEffect(() => {
    if (selectedIdx !== safeSelectedIdx) {
      setSelectedIdx(safeSelectedIdx);
    }
  }, [selectedIdx, safeSelectedIdx]);

  // Przewiń wybrany element na liście pytań, jeśli jest poza widokiem
  useEffect(() => {
    const el = listItemRefs.current[safeSelectedIdx];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [safeSelectedIdx, editorQuestions.length]);

  // ─── Walidacja całego zestawu przed zapisem ───
  const handleFormSubmit = (e) => {
    e.preventDefault();
    setShowValidation(true);

    if (!editorTitle || !editorTitle.trim()) {
      const msg = 'Wpisz nazwę zestawu przed zapisaniem.';
      setValidationError(msg);
      toast.error('Nie można zapisać zestawu', msg);
      titleInputRef.current?.focus();
      return;
    }

    for (let i = 0; i < editorQuestions.length; i++) {
      const issues = getQuestionIssues(editorQuestions[i], editorMode);
      if (issues.length > 0) {
        setSelectedIdx(i);
        const msg = `Pytanie #${i + 1}: ${issues[0]}`;
        setValidationError(msg);
        toast.error('Popraw błędy przed zapisem', msg);
        return;
      }
    }

    setValidationError('');
    onSaveQuiz(e);
  };

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
    setValidationError('');
    if (convertedCount > 0) {
      toast.info(
        'Dostosowano typy pytań',
        `Przekonwertowano ${convertedCount} ${
          convertedCount === 1 ? 'pytanie' : 'pytań'
        } do trybu „${QUIZ_MODES[nextMode].fullLabel}”.`
      );
    }
  };

  const updateEditorQuestion = (qIdx, field, value) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy[qIdx] = { ...copy[qIdx], [field]: value };
      return copy;
    });
    if (validationError) setValidationError('');
  };

  const changeQuestionType = (qIdx, nextType) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy[qIdx] = convertQuestionType(copy[qIdx], nextType, editorMode);
      return copy;
    });
    if (validationError) setValidationError('');
  };

  const updateEditorAnswer = (qIdx, aIdx, value) => {
    setEditorQuestions((prev) => {
      const copy = [...prev];
      const answers = [...copy[qIdx].answers];
      answers[aIdx] = value;
      copy[qIdx] = { ...copy[qIdx], answers };
      return copy;
    });
    if (validationError) setValidationError('');
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
    if (validationError) setValidationError('');
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

  // ─── Dodawanie, duplikowanie i usuwanie pytań ───
  const addQuestion = (type = modeMeta.defaultType) => {
    const nextIdx = editorQuestions.length;
    setEditorQuestions((prev) => [
      ...prev,
      createEmptyQuestion(type, editorMode),
    ]);
    setSelectedIdx(nextIdx);
    setValidationError('');
  };

  const duplicateQuestion = (qIdx) => {
    const source = editorQuestions[qIdx];
    if (!source) return;
    const cloned = {
      ...source,
      _uid: createQuestionUid(),
      answers: Array.isArray(source.answers) ? [...source.answers] : undefined,
      answerImages: Array.isArray(source.answerImages)
        ? [...source.answerImages]
        : undefined,
    };
    setEditorQuestions((prev) => {
      const copy = [...prev];
      copy.splice(qIdx + 1, 0, cloned);
      return copy;
    });
    setSelectedIdx(qIdx + 1);
    toast.info('Zduplikowano pytanie', `Utworzono kopię jako pytanie #${qIdx + 2}.`);
  };

  const removeQuestion = (qIdx) => {
    if (editorQuestions.length <= 1) return;
    setEditorQuestions((prev) => prev.filter((_, i) => i !== qIdx));
    setSelectedIdx((prevSel) => {
      if (prevSel > qIdx) return prevSel - 1;
      if (prevSel === qIdx) return Math.max(0, qIdx - 1);
      return prevSel;
    });
    setValidationError('');
  };

  // ─── Zmiana kolejności pytań (z zachowaniem aktywnego wyboru) ───
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
    setSelectedIdx((prevSel) => {
      if (prevSel === fromIdx) return toIdx;
      if (fromIdx < prevSel && toIdx >= prevSel) return prevSel - 1;
      if (fromIdx > prevSel && toIdx <= prevSel) return prevSel + 1;
      return prevSel;
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
    const hadImage = Boolean(editorQuestions[qIdx]?.image);
    setProcessingKey(key);
    try {
      const dataUrl = await processImageFile(file, QUESTION_IMAGE_OPTIONS);
      updateEditorQuestion(qIdx, 'image', dataUrl);
      toast.success(
        hadImage ? 'Zmieniono zdjęcie pytania' : 'Dodano zdjęcie do pytania',
        `Pytanie #${qIdx + 1} (${file.name})`
      );
    } catch (err) {
      toast.error(
        'Nie udało się dodać zdjęcia',
        err.message || 'Nie udało się dodać zdjęcia do pytania.'
      );
    } finally {
      setProcessingKey('');
    }
  };

  const handleAnswerImageFile = async (qIdx, aIdx, file) => {
    if (!file) return;
    const key = `a-${qIdx}-${aIdx}`;
    const optLabel = ANSWER_OPTIONS[aIdx]?.label || `#${aIdx + 1}`;
    const hadImage = Boolean(editorQuestions[qIdx]?.answerImages?.[aIdx]);
    setProcessingKey(key);
    try {
      const dataUrl = await processImageFile(file, ANSWER_IMAGE_OPTIONS);
      updateEditorAnswerImage(qIdx, aIdx, dataUrl);
      toast.success(
        hadImage ? 'Zmieniono zdjęcie odpowiedzi' : 'Dodano zdjęcie do odpowiedzi',
        `Pytanie #${qIdx + 1}, odpowiedź ${optLabel} (${file.name})`
      );
    } catch (err) {
      toast.error(
        'Nie udało się dodać zdjęcia odpowiedzi',
        err.message || 'Nie udało się dodać zdjęcia do odpowiedzi.'
      );
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

  // Aktywne pytanie — dane pomocnicze
  const q = activeQuestion;
  const qIdx = safeSelectedIdx;
  const qType = q?.type || 'abcd';
  const activeTypeMeta = QUESTION_TYPES[qType] || QUESTION_TYPES.abcd;
  const activeScored = q ? isQuestionScored(q, editorMode) : true;
  const activeIssues = q && showValidation ? getQuestionIssues(q, editorMode) : [];
  const isProcessingQuestionImg = processingKey === `q-${qIdx}`;

  return (
    <main className="mx-auto w-full max-w-7xl pb-6 animate-screen-enter">
      <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
        {/* ════════════════════════════════════════════════════
            GÓRNY PASEK USTAWIEŃ ZESTAWU + ZAPIS
            ════════════════════════════════════════════════════ */}
        <Card className="p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            {/* Nazwa zestawu */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="quiz-title" className="text-xs uppercase tracking-wider">
                  {editingQuizId ? 'Edycja zestawu' : 'Nowy zestaw'}
                </Label>
                <Badge variant={modeMeta.badgeVariant}>
                  {modeMeta.label} [{modeMeta.code}]
                </Badge>
                <Badge variant="neutral">
                  {editorQuestions.length}{' '}
                  {editorQuestions.length === 1 ? 'pytanie' : 'pytań'}
                </Badge>
              </div>
              <Input
                ref={titleInputRef}
                id="quiz-title"
                required
                value={editorTitle}
                onChange={(e) => {
                  setEditorTitle(e.target.value);
                  if (validationError) setValidationError('');
                }}
                placeholder="Wpisz nazwę zestawu, np. Architektura systemów Linux"
                className={cn(
                  'h-11 font-heading text-base font-bold',
                  showValidation &&
                  !editorTitle.trim() &&
                  'border-danger ring-2 ring-danger/40'
                )}
              />
            </div>

            {/* Tryb sesji (Q / O / M) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wider">
                  Tryb sesji
                </Label>
                <span className="hidden sm:inline text-xs text-foreground/65">
                  {modeMeta.description}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(QUIZ_MODES).map((m) => {
                  const selected = editorMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      title={m.description}
                      onClick={() => handleModeChange(m.id)}
                      className={cn(
                        'inline-flex h-11 items-center justify-center gap-2 rounded-base border-2 border-border px-3 font-heading text-xs sm:text-sm font-extrabold transition-all cursor-pointer whitespace-nowrap',
                        selected
                          ? 'bg-main shadow-shadow'
                          : 'bg-background hover:bg-secondary-background'
                      )}
                    >
                      <span>{m.label}</span>
                      <Badge
                        variant={selected ? 'neutral' : m.badgeVariant}
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {m.code}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Zapisz zestaw */}
            <div className="flex-shrink-0">
              <Button
                type="submit"
                size="default"
                className="h-11 w-full xl:w-auto px-6 text-sm"
              >
                {editingQuizId ? 'Zapisz zmiany' : 'Utwórz zestaw'}
              </Button>
            </div>
          </div>
        </Card>

        {/* KOMUNIKAT WALIDACJI */}
        {validationError && (
          <Alert
            variant="danger"
            className="flex items-center justify-between gap-3 text-sm font-heading font-bold"
          >
            <span>{validationError}</span>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => setValidationError('')}
            >
              Zamknij
            </Button>
          </Alert>
        )}

        {/* ════════════════════════════════════════════════════
            DWUKOLUMNOWY UKŁAD:
            LEWO: LISTA PYTAŃ | PRAWO: DUŻY EDYTOR PYTANIA
            ════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)] gap-5 items-start">
          {/* ─── LEWA KOLUMNA: LISTA PYTAŃ ─── */}
          <aside className="lg:sticky lg:top-4">
            <Card className="flex flex-col overflow-hidden lg:max-h-[calc(100vh-8.5rem)]">
              {/* Nagłówek listy */}
              <div className="flex items-center justify-between gap-2 border-b-2 border-border bg-secondary-background px-4 py-3">
                <h2 className="font-heading text-sm font-extrabold uppercase tracking-wide">
                  Lista pytań
                </h2>
                <Badge variant="default" className="tabular-nums">
                  {editorQuestions.length}
                </Badge>
              </div>

              {/* Przewijalna lista slajdów / kart pytań */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 max-h-[320px] lg:max-h-none bg-background/40">
                {editorQuestions.map((item, idx) => {
                  const itemType = item.type || 'abcd';
                  const itemTypeMeta =
                    QUESTION_TYPES[itemType] || QUESTION_TYPES.abcd;
                  const itemScored = isQuestionScored(item, editorMode);
                  const isSelected = idx === safeSelectedIdx;
                  const isDragged = draggedIdx === idx;
                  const isDropTarget =
                    dragOverIdx === idx &&
                    draggedIdx !== null &&
                    draggedIdx !== idx;
                  const itemIssues = showValidation
                    ? getQuestionIssues(item, editorMode)
                    : [];
                  const hasIssue = itemIssues.length > 0;
                  const previewText = item.content?.trim();

                  return (
                    <div
                      key={item._uid || idx}
                      ref={(el) => {
                        listItemRefs.current[idx] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      draggable={dragArmedIdx === idx}
                      onMouseUp={() => setDragArmedIdx(null)}
                      onDragStart={(e) => handleQuestionDragStart(e, idx)}
                      onDragOver={(e) => handleQuestionDragOver(e, idx)}
                      onDrop={(e) => handleQuestionDrop(e, idx)}
                      onDragEnd={handleQuestionDragEnd}
                      onClick={() => setSelectedIdx(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIdx(idx);
                        }
                      }}
                      className={cn(
                        'group relative rounded-base border-2 border-border p-3 transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected
                          ? 'bg-main shadow-shadow'
                          : 'bg-secondary-background hover:bg-background',
                        isDragged && 'opacity-50 scale-[0.98]',
                        isDropTarget && 'ring-4 ring-main shadow-shadow',
                        hasIssue && !isSelected && 'border-danger bg-danger/10'
                      )}
                    >
                      {/* Górny wiersz karty: uchwyt, numer, typ, czas / błąd */}
                      <div className="flex items-center justify-between gap-1.5 mb-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {editorQuestions.length > 1 && (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setDragArmedIdx(idx);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title="Przeciągnij, aby zmienić kolejność"
                              aria-label={`Przeciągnij pytanie ${idx + 1}`}
                              className={cn(
                                'inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-border/70 cursor-grab active:cursor-grabbing flex-shrink-0 transition-colors',
                                isSelected
                                  ? 'bg-secondary-background/80 hover:bg-secondary-background'
                                  : 'bg-background hover:bg-main/40'
                              )}
                            >
                              <GripIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <span className="font-heading text-xs font-extrabold tabular-nums">
                            #{idx + 1}
                          </span>
                          <Badge
                            variant={
                              isSelected ? 'neutral' : itemTypeMeta.badgeVariant
                            }
                            className="px-1.5 py-0 text-[10px]"
                          >
                            {itemTypeMeta.shortLabel}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          {hasIssue && (
                            <Badge
                              variant="danger"
                              className="px-1.5 py-0 text-[10px]"
                              title={itemIssues[0]}
                            >
                              !
                            </Badge>
                          )}
                          <span className="text-[11px] font-heading font-bold tabular-nums text-foreground/75">
                            {item.timeLimit || 20}s
                          </span>
                        </div>
                      </div>

                      {/* Podgląd treści i miniatury zdjęcia */}
                      <div className="flex items-start gap-2.5 min-h-[2.25rem]">
                        <p
                          className={cn(
                            'flex-1 text-xs leading-snug line-clamp-2 break-words',
                            previewText
                              ? 'font-semibold text-foreground'
                              : 'italic text-foreground/60'
                          )}
                        >
                          {previewText ||
                            (item.image
                              ? 'Pytanie ze zdjęciem'
                              : 'Brak treści pytania...')}
                        </p>
                        {item.image && (
                          <img
                            src={item.image}
                            alt=""
                            className="h-10 w-12 flex-shrink-0 rounded-[3px] border border-border object-cover bg-secondary-background"
                          />
                        )}
                      </div>

                      {/* Dolny wiersz karty: status + szybkie akcje kolejności / usuwania */}
                      <div className="mt-2.5 pt-2 border-t border-border/25 flex items-center justify-between gap-2">
                        <span className="text-[10px] font-heading font-bold uppercase tracking-wide text-foreground/75">
                          {itemScored ? 'Punktowane' : 'Opinia'}
                        </span>

                        {editorQuestions.length > 1 && (
                          <div
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveQuestion(idx, idx - 1)}
                              title="Przesuń w górę"
                              aria-label={`Przesuń pytanie ${idx + 1} w górę`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-border bg-secondary-background text-[11px] font-heading font-bold hover:bg-background disabled:opacity-35 cursor-pointer"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={idx === editorQuestions.length - 1}
                              onClick={() => moveQuestion(idx, idx + 1)}
                              title="Przesuń w dół"
                              aria-label={`Przesuń pytanie ${idx + 1} w dół`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-border bg-secondary-background text-[11px] font-heading font-bold hover:bg-background disabled:opacity-35 cursor-pointer"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeQuestion(idx)}
                              title="Usuń pytanie"
                              aria-label={`Usuń pytanie ${idx + 1}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-border bg-secondary-background text-[11px] font-heading font-bold hover:bg-danger cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stopka listy: dodawanie pytań */}
              <div className="border-t-2 border-border bg-secondary-background p-3 space-y-2">
                <Button
                  type="button"
                  size="sm"
                  className="w-full h-10 text-xs"
                  onClick={() => addQuestion(modeMeta.defaultType)}
                >
                  + Dodaj pytanie
                </Button>
                {allowedTypes.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {allowedTypes.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addQuestion(t)}
                        className="flex-1 min-w-[4.25rem] rounded-base border-2 border-border bg-background px-2 py-1 text-[11px] font-heading font-bold hover:bg-main/40 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        + {QUESTION_TYPES[t].shortLabel}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </aside>

          {/* ─── PRAWA KOLUMNA: DUŻY EDYTOR AKTYWNEGO PYTANIA ─── */}
          {q && (
            <section className="min-w-0">
              <Card className="overflow-hidden">
                {/* Pasek nagłówkowy edytowanego pytania */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border bg-secondary-background px-5 py-4 md:px-6">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="font-heading text-xl md:text-2xl font-extrabold tracking-tight">
                      Pytanie #{qIdx + 1}
                    </h2>
                    <span className="text-xs font-heading font-bold text-foreground/60 tabular-nums">
                      z {editorQuestions.length}
                    </span>
                    <Badge variant={activeTypeMeta.badgeVariant}>
                      {activeTypeMeta.label}
                    </Badge>
                    <Badge variant={activeScored ? 'warning' : 'info'}>
                      {activeScored ? 'Punktowane' : 'Opinia'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        disabled={qIdx === 0}
                        onClick={() => setSelectedIdx(qIdx - 1)}
                        title="Poprzednie pytanie"
                        aria-label="Poprzednie pytanie"
                        className="h-9 w-9 px-0"
                      >
                        ←
                      </Button>
                      <Button
                        type="button"
                        variant="neutral"
                        size="sm"
                        disabled={qIdx === editorQuestions.length - 1}
                        onClick={() => setSelectedIdx(qIdx + 1)}
                        title="Następne pytanie"
                        aria-label="Następne pytanie"
                        className="h-9 w-9 px-0"
                      >
                        →
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      onClick={() => duplicateQuestion(qIdx)}
                      title="Duplikuj bieżące pytanie"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                      Duplikuj
                    </Button>
                    {editorQuestions.length > 1 && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => removeQuestion(qIdx)}
                        title="Usuń bieżące pytanie"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                        Usuń
                      </Button>
                    )}
                  </div>
                </div>

                {/* Zawartość edytora pytania */}
                <div className="p-5 md:p-6 space-y-6">
                  {/* Błędy walidacji tego pytania */}
                  {activeIssues.length > 0 && (
                    <Alert variant="danger" className="text-xs md:text-sm space-y-1">
                      <div className="font-heading font-extrabold">
                        Uzupełnij brakujące pola w tym pytaniu:
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 font-medium">
                        {activeIssues.map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}

                  {/* SEKCJA 1: FORMA PYTANIA I LIMIT CZASU */}
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-5 items-start rounded-base border-2 border-border bg-background p-4">
                    {/* Wybór formy pytania jako czytelne kafelki */}
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider">
                        Forma pytania
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {allowedTypes.map((t) => {
                          const meta = QUESTION_TYPES[t];
                          const isCurrent = qType === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => changeQuestionType(qIdx, t)}
                              className={cn(
                                'inline-flex h-10 items-center gap-2 rounded-base border-2 border-border px-3.5 font-heading text-xs sm:text-sm font-bold transition-all cursor-pointer',
                                isCurrent
                                  ? 'bg-main shadow-shadow'
                                  : 'bg-secondary-background hover:bg-main/25'
                              )}
                            >
                              <span>{meta.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Limit czasu z szybkimi presetami */}
                    <div className="space-y-2 xl:min-w-[235px]">
                      <Label
                        htmlFor={`time-${qIdx}`}
                        className="text-xs uppercase tracking-wider"
                      >
                        Limit czasu (sekundy)
                      </Label>
                      <div className="flex flex-wrap items-center gap-2">
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
                          className="h-10 w-20 text-center font-heading text-base font-extrabold tabular-nums"
                        />
                        <div className="flex flex-wrap gap-1">
                          {TIME_PRESETS.map((sec) => {
                            const active = Number(q.timeLimit) === sec;
                            return (
                              <button
                                key={sec}
                                type="button"
                                onClick={() =>
                                  updateEditorQuestion(qIdx, 'timeLimit', sec)
                                }
                                className={cn(
                                  'h-8 rounded-base border-2 border-border px-2 font-heading text-xs font-bold tabular-nums transition-colors cursor-pointer',
                                  active
                                    ? 'bg-main'
                                    : 'bg-secondary-background hover:bg-main/30'
                                )}
                              >
                                {sec}s
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SEKCJA 2: TREŚĆ PYTANIA I ZDJĘCIE */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor={`q-content-${qIdx}`}
                        className="text-xs uppercase tracking-wider"
                      >
                        Treść pytania{' '}
                        {q.image ? '(opcjonalna, gdy dodano zdjęcie)' : ''}
                      </Label>
                      <textarea
                        id={`q-content-${qIdx}`}
                        rows={3}
                        required={!q.image}
                        placeholder={
                          q.image
                            ? 'Opcjonalny opis lub pytanie do zdjęcia...'
                            : 'Wpisz treść pytania, które zobaczą uczestnicy...'
                        }
                        value={q.content}
                        onChange={(e) =>
                          updateEditorQuestion(qIdx, 'content', e.target.value)
                        }
                        className="flex min-h-[96px] w-full resize-y rounded-base border-2 border-border bg-secondary-background px-4 py-3 font-heading text-base md:text-lg font-bold leading-snug text-foreground selection:bg-main selection:text-main-foreground placeholder:font-sans placeholder:font-medium placeholder:text-foreground/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                    </div>

                    {/* Zdjęcie do pytania */}
                    <div
                      onDragOver={handleImageFileDragOver}
                      onDrop={(e) =>
                        handleImageFileDrop(e, (file) =>
                          handleQuestionImageFile(qIdx, file)
                        )
                      }
                    >
                      {q.image ? (
                        <div className="rounded-base border-2 border-border bg-background p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Label className="text-xs uppercase tracking-wider">
                              Zdjęcie do pytania
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
                                  : 'Zmień zdjęcie'}
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
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => {
                                  updateEditorQuestion(qIdx, 'image', null);
                                  toast.neutral(
                                    'Usunięto zdjęcie z pytania',
                                    `Pytanie #${qIdx + 1}`
                                  );
                                }}
                              >
                                Usuń zdjęcie
                              </Button>
                            </div>
                          </div>
                          <div className="flex justify-center rounded-base border-2 border-border bg-secondary-background p-2">
                            <img
                              src={q.image}
                              alt={`Podgląd zdjęcia do pytania ${qIdx + 1}`}
                              className="max-h-64 w-auto max-w-full rounded-[3px] object-contain"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-dashed border-border/70 bg-background/60 px-4 py-3 transition-colors hover:bg-background">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-base border-2 border-border bg-secondary-background">
                              <ImageIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="font-heading text-xs sm:text-sm font-bold">
                                Zdjęcie do pytania (opcjonalne)
                              </div>
                              <div className="text-xs text-foreground/65">
                                Przeciągnij obraz tutaj lub wybierz plik z dysku
                              </div>
                            </div>
                          </div>
                          <Button
                            as="label"
                            variant="neutral"
                            size="sm"
                            className="h-9 text-xs"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            {isProcessingQuestionImg
                              ? 'Przetwarzanie...'
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
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ════════════════════════════════════════════
                      SEKCJA 3: ODPOWIEDZI / KONFIGURACJA FORMY
                      ════════════════════════════════════════════ */}
                  <div className="border-t-2 border-border pt-6">
                    {/* 1. ABCD oraz 2. ANKIETA (POLL) */}
                    {(qType === 'abcd' || qType === 'poll') && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <Label className="text-xs uppercase tracking-wider">
                              {qType === 'abcd'
                                ? 'Odpowiedzi (oznacz poprawną)'
                                : 'Opcje ankiety (wykres kołowy)'}
                            </Label>
                            <p className="text-xs text-foreground/70 mt-0.5">
                              {qType === 'abcd'
                                ? 'Każda odpowiedź może zawierać tekst, zdjęcie lub oba naraz.'
                                : 'Pytanie niepunktowane — na koniec rundy wyświetli się rozkład głosów.'}
                            </p>
                          </div>
                          {q.answers.length < 4 && (
                            <Button
                              type="button"
                              variant="neutral"
                              size="sm"
                              onClick={() => addAnswerOption(qIdx)}
                            >
                              + Dodaj opcję
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                  'flex flex-col gap-3 rounded-base border-2 border-border p-3.5 transition-all',
                                  isCorrect
                                    ? 'bg-main shadow-shadow'
                                    : 'bg-background'
                                )}
                              >
                                {/* Górny pasek kafelka odpowiedzi */}
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Badge
                                      variant={opt.badgeVariant}
                                      className="flex-shrink-0 text-xs px-2.5 py-0.5"
                                    >
                                      <span>{opt.symbol}</span>
                                      <span>{opt.label}</span>
                                    </Badge>

                                    {qType === 'abcd' && (
                                      <label
                                        className={cn(
                                          'inline-flex items-center gap-1.5 rounded-base border-2 border-border px-2.5 py-1 text-xs font-heading font-bold cursor-pointer transition-colors select-none',
                                          isCorrect
                                            ? 'bg-secondary-background text-foreground'
                                            : 'bg-secondary-background/80 text-foreground/75 hover:bg-secondary-background'
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
                                          className="h-3.5 w-3.5 accent-black cursor-pointer"
                                        />
                                        <span>
                                          {isCorrect ? 'Poprawna' : 'Zaznacz'}
                                        </span>
                                      </label>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 flex-shrink-0">
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
                                      className="h-8 px-2.5 text-xs"
                                    >
                                      <ImageIcon className="h-3.5 w-3.5" />
                                      <span className="hidden sm:inline">
                                        {ansImage ? 'Zmień' : 'Zdjęcie'}
                                      </span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        disabled={isProcessingAnsImg}
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) {
                                            handleAnswerImageFile(
                                              qIdx,
                                              aIdx,
                                              file
                                            );
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
                                        onClick={() =>
                                          removeAnswerOption(qIdx, aIdx)
                                        }
                                        className="h-8 w-8 px-0 text-xs"
                                      >
                                        ✕
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Pełnoszerokościowe pole tekstowe odpowiedzi */}
                                <Input
                                  required={!ansImage}
                                  placeholder={
                                    ansImage
                                      ? `Opcjonalny podpis dla odpowiedzi ${opt.label}...`
                                      : `Wpisz treść odpowiedzi ${opt.label}...`
                                  }
                                  value={ans}
                                  onChange={(e) =>
                                    updateEditorAnswer(
                                      qIdx,
                                      aIdx,
                                      e.target.value
                                    )
                                  }
                                  className="h-11 text-sm md:text-base font-medium"
                                />

                                {isProcessingAnsImg && (
                                  <div className="text-center text-xs font-heading font-bold py-2">
                                    Przetwarzanie zdjęcia...
                                  </div>
                                )}

                                {ansImage && !isProcessingAnsImg && (
                                  <div className="relative flex items-center justify-center rounded-base border-2 border-border bg-secondary-background p-2">
                                    <img
                                      src={ansImage}
                                      alt={`Podgląd zdjęcia opcji ${opt.label}`}
                                      className="max-h-32 w-auto max-w-full rounded-[3px] object-contain"
                                    />
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      onClick={() => {
                                        updateEditorAnswerImage(
                                          qIdx,
                                          aIdx,
                                          null
                                        );
                                        toast.neutral(
                                          'Usunięto zdjęcie z odpowiedzi',
                                          `Pytanie #${qIdx + 1}, odpowiedź ${opt.label}`
                                        );
                                      }}
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
                      <div className="space-y-3">
                        <Label className="text-xs uppercase tracking-wider">
                          Poprawna odpowiedź (Prawda / Fałsz)
                        </Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {TRUE_FALSE_OPTIONS.map((opt, aIdx) => {
                            const isCorrect = q.correctIndex === aIdx;
                            return (
                              <label
                                key={opt.label}
                                className={cn(
                                  'flex items-center justify-between gap-3 rounded-base border-2 border-border p-5 cursor-pointer font-heading text-lg font-extrabold transition-all',
                                  isCorrect
                                    ? `${opt.bgClass} shadow-shadow`
                                    : 'bg-background hover:bg-secondary-background'
                                )}
                              >
                                <div className="flex items-center gap-3">
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
                                    className="h-5 w-5 accent-black cursor-pointer"
                                  />
                                  <span className="text-xl">{opt.symbol}</span>
                                  <span>{opt.label}</span>
                                </div>
                                {isCorrect && (
                                  <Badge variant="neutral">Poprawna</Badge>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 4. SLIDER (przedział liczbowy) */}
                    {qType === 'slider' &&
                      (() => {
                        const sMin = Number(q.sliderMin ?? 0);
                        const sMax = Number(q.sliderMax ?? 100);
                        const sStep = Number(q.sliderStep ?? 1) || 1;
                        const sCorrect = Number(
                          q.sliderCorrect ?? Math.round((sMin + sMax) / 2)
                        );
                        const sTol = Number(q.sliderTolerance ?? 0);

                        return (
                          <div className="space-y-5 rounded-base border-2 border-border bg-background p-4 md:p-5">
                            <div>
                              <Label className="text-xs uppercase tracking-wider">
                                Parametry przedziału (Slider)
                              </Label>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="space-y-1.5">
                                <Label htmlFor={`s-min-${qIdx}`} className="text-xs">
                                  Minimum
                                </Label>
                                <Input
                                  id={`s-min-${qIdx}`}
                                  type="number"
                                  step="any"
                                  required
                                  value={q.sliderMin ?? 0}
                                  onChange={(e) =>
                                    updateEditorQuestion(
                                      qIdx,
                                      'sliderMin',
                                      Number(e.target.value)
                                    )
                                  }
                                  className="h-10 font-heading font-bold tabular-nums"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor={`s-max-${qIdx}`} className="text-xs">
                                  Maksimum
                                </Label>
                                <Input
                                  id={`s-max-${qIdx}`}
                                  type="number"
                                  step="any"
                                  required
                                  value={q.sliderMax ?? 100}
                                  onChange={(e) =>
                                    updateEditorQuestion(
                                      qIdx,
                                      'sliderMax',
                                      Number(e.target.value)
                                    )
                                  }
                                  className="h-10 font-heading font-bold tabular-nums"
                                />
                              </div>
                              <div className="space-y-1.5">
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
                                  className="h-10 font-heading font-bold tabular-nums"
                                />
                              </div>
                              <div className="space-y-1.5">
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
                                  className="h-10"
                                />
                              </div>
                            </div>

                            {editorMode === 'mixed' && (
                              <label className="flex items-center gap-2.5 text-sm font-heading font-bold cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={activeScored}
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

                            {activeScored ? (
                              <div className="space-y-4 border-t-2 border-border pt-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
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
                                      className="h-10 font-heading font-bold tabular-nums"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
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
                                      className="h-10 font-heading font-bold tabular-nums"
                                    />
                                  </div>
                                </div>

                                {sMax > sMin && (
                                  <div className="rounded-base border-2 border-border bg-secondary-background p-3.5 space-y-2">
                                    <input
                                      type="range"
                                      min={sMin}
                                      max={sMax}
                                      step={sStep > 0 ? sStep : 1}
                                      value={Math.min(
                                        sMax,
                                        Math.max(sMin, sCorrect)
                                      )}
                                      onChange={(e) =>
                                        updateEditorQuestion(
                                          qIdx,
                                          'sliderCorrect',
                                          Number(e.target.value)
                                        )
                                      }
                                      className="w-full accent-black cursor-pointer"
                                    />
                                    <div className="flex justify-between text-xs font-heading font-bold text-foreground/80 tabular-nums">
                                      <span>
                                        {sMin} {q.sliderUnit || ''}
                                      </span>
                                      <span className="rounded-base border border-border bg-main px-2 py-0.5 text-foreground">
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
                              <p className="text-xs md:text-sm text-foreground/75">
                                Tryb niepunktowany — uczestnicy wskazują wartość w przedziale, a na koniec wyświetli się rozkład, średnia i mediana odpowiedzi.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                    {/* 5. CHMURA SŁÓW */}
                    {qType === 'word_cloud' && (
                      <div className="rounded-base border-2 border-border bg-background p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="space-y-1 max-w-xl">
                            <div className="font-heading text-sm font-extrabold">
                              Chmura słów (niepunktowana)
                            </div>
                            <p className="text-xs md:text-sm text-foreground/75">
                              Każdy uczestnik wpisuje krótkie hasło na telefonie — najczęstsze odpowiedzi będą największe na ekranie głównym.
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
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
                              className="h-10 w-20 text-center font-heading font-bold tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dolny pasek nawigacji między pytaniami */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-border bg-background/60 px-5 py-3.5 md:px-6">
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    disabled={qIdx === 0}
                    onClick={() => setSelectedIdx(qIdx - 1)}
                  >
                    ← Poprzednie pytanie
                  </Button>

                  <span className="text-xs font-heading font-bold text-foreground/70 tabular-nums">
                    Pytanie {qIdx + 1} z {editorQuestions.length}
                  </span>

                  {qIdx < editorQuestions.length - 1 ? (
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      onClick={() => setSelectedIdx(qIdx + 1)}
                    >
                      Następne pytanie →
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => addQuestion(qType)}
                    >
                      + Dodaj kolejne pytanie
                    </Button>
                  )}
                </div>
              </Card>
            </section>
          )}
        </div>
      </form>
    </main>
  );
}
