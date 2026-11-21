import { io } from 'socket.io-client';

// W produkcji (build Vite) używa tego samego origin (reverse proxy / SWAG),
// a w trybie deweloperskim (vite dev) łączy się bezpośrednio z backendem na porcie 3001.
// Można nadpisać zmienną VITE_BACKEND_URL na etapie budowania.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.DEV
    ? `http://${window.location.hostname}:3001`
    : window.location.origin);
export const socket = io(BACKEND_URL, {
  autoConnect: true,
  withCredentials: true,
});

export const ANSWER_OPTIONS = [
  { label: 'A', symbol: '▲', badgeVariant: 'danger', bgClass: 'bg-danger', hex: '#ff6b6b' },
  { label: 'B', symbol: '◆', badgeVariant: 'info', bgClass: 'bg-info', hex: '#88aaee' },
  { label: 'C', symbol: '●', badgeVariant: 'warning', bgClass: 'bg-warning', hex: '#ffdb58' },
  { label: 'D', symbol: '■', badgeVariant: 'purple', bgClass: 'bg-purple', hex: '#c4b5fd' },
];

export const TRUE_FALSE_OPTIONS = [
  { label: 'Prawda', symbol: '✓', badgeVariant: 'default', bgClass: 'bg-main', hex: '#7fbc8c' },
  { label: 'Fałsz', symbol: '✕', badgeVariant: 'danger', bgClass: 'bg-danger', hex: '#ff6b6b' },
];

export const QUIZ_MODES = {
  quiz: {
    id: 'quiz',
    code: 'Q',
    label: 'Quiz',
    fullLabel: 'Quiz (punktowany)',
    description: 'Pytania punktowane z tablicą wyników i podium.',
    badgeVariant: 'default',
    allowedTypes: ['abcd', 'true_false', 'slider'],
    defaultType: 'abcd',
  },
  opinion: {
    id: 'opinion',
    code: 'O',
    label: 'Opinie',
    fullLabel: 'Opinie (niepunktowany)',
    description: 'Ankiety z wykresem kołowym, chmury słów i slidery bez punktów.',
    badgeVariant: 'info',
    allowedTypes: ['poll', 'word_cloud', 'slider'],
    defaultType: 'poll',
  },
  mixed: {
    id: 'mixed',
    code: 'M',
    label: 'Tryb mieszany',
    fullLabel: 'Tryb mieszany',
    description: 'Łączy pytania punktowane z ankietami i chmurami słów w jednej sesji.',
    badgeVariant: 'purple',
    allowedTypes: ['abcd', 'true_false', 'slider', 'poll', 'word_cloud'],
    defaultType: 'abcd',
  },
};

export const QUESTION_TYPES = {
  abcd: {
    id: 'abcd',
    label: 'Pytanie ABCD',
    shortLabel: 'ABCD',
    badgeVariant: 'default',
    modes: ['quiz', 'mixed'],
    scoredDefault: true,
    scoredLocked: true,
  },
  true_false: {
    id: 'true_false',
    label: 'Prawda / Fałsz',
    shortLabel: 'P / F',
    badgeVariant: 'warning',
    modes: ['quiz', 'mixed'],
    scoredDefault: true,
    scoredLocked: true,
  },
  slider: {
    id: 'slider',
    label: 'Slider (przedział)',
    shortLabel: 'Slider',
    badgeVariant: 'info',
    modes: ['quiz', 'opinion', 'mixed'],
    scoredDefault: true,
    scoredLocked: false,
  },
  poll: {
    id: 'poll',
    label: 'Ankieta (wykres kołowy)',
    shortLabel: 'Ankieta',
    badgeVariant: 'purple',
    modes: ['opinion', 'mixed'],
    scoredDefault: false,
    scoredLocked: true,
  },
  word_cloud: {
    id: 'word_cloud',
    label: 'Chmura słów',
    shortLabel: 'Chmura',
    badgeVariant: 'neutral',
    modes: ['opinion', 'mixed'],
    scoredDefault: false,
    scoredLocked: true,
  },
};

export function getAllowedQuestionTypes(quizMode = 'quiz') {
  return (QUIZ_MODES[quizMode] || QUIZ_MODES.quiz).allowedTypes;
}

export function isQuestionScored(question, quizMode = 'quiz') {
  const type = question?.type || 'abcd';
  if (quizMode === 'opinion') return false;
  if (type === 'poll' || type === 'word_cloud') return false;
  if (type === 'abcd' || type === 'true_false') return true;
  if (type === 'slider') {
    if (quizMode === 'quiz') return true;
    return question?.scored !== false;
  }
  return true;
}

export const HOST_STATUS_META = {
  LOBBY: { label: 'Lobby (oczekiwanie)', variant: 'neutral' },
  COUNTDOWN: { label: 'Odliczanie startowe', variant: 'warning' },
  QUESTION_PREVIEW: { label: 'Podgląd pytania (5s)', variant: 'info' },
  QUESTION: { label: 'Aktywne pytanie', variant: 'default' },
  LEADERBOARD: { label: 'Wyniki rundy', variant: 'purple' },
  PODIUM: { label: 'Podsumowanie / Podium', variant: 'default' },
  ABORTED: { label: 'Gra przerwana', variant: 'danger' },
};

let questionUidSeq = 1;
export function createQuestionUid() {
  return `q-${Date.now()}-${questionUidSeq++}`;
}

export function createEmptyQuestion(type = 'abcd', quizMode = 'quiz') {
  const resolvedType = getAllowedQuestionTypes(quizMode).includes(type)
    ? type
    : (QUIZ_MODES[quizMode] || QUIZ_MODES.quiz).defaultType;

  const base = {
    _uid: createQuestionUid(),
    type: resolvedType,
    content: '',
    image: null,
    timeLimit: 20,
  };

  if (resolvedType === 'true_false') {
    return {
      ...base,
      answers: ['Prawda', 'Fałsz'],
      answerImages: [null, null],
      correctIndex: 0,
      scored: true,
    };
  }

  if (resolvedType === 'poll') {
    return {
      ...base,
      answers: ['', '', '', ''],
      answerImages: [null, null, null, null],
      scored: false,
    };
  }

  if (resolvedType === 'slider') {
    const scored = quizMode !== 'opinion';
    return {
      ...base,
      sliderMin: 0,
      sliderMax: 100,
      sliderStep: 1,
      sliderUnit: '',
      scored,
      sliderCorrect: 50,
      sliderTolerance: 10,
    };
  }

  if (resolvedType === 'word_cloud') {
    return {
      ...base,
      maxLength: 32,
      scored: false,
    };
  }

  // default: abcd
  return {
    ...base,
    answers: ['', '', '', ''],
    answerImages: [null, null, null, null],
    correctIndex: 0,
    scored: true,
  };
}

export function convertQuestionType(question, targetType, quizMode = 'quiz') {
  const fresh = createEmptyQuestion(targetType, quizMode);
  const preserved = {
    ...fresh,
    _uid: question._uid || fresh._uid,
    content: question.content || '',
    image: question.image || null,
    timeLimit: question.timeLimit || 20,
  };

  // Zachowaj odpowiedzi przy przełączaniu między ABCD a Ankietą
  if (
    (targetType === 'abcd' || targetType === 'poll') &&
    (question.type === 'abcd' || question.type === 'poll' || !question.type) &&
    Array.isArray(question.answers) &&
    question.answers.length >= 2
  ) {
    preserved.answers = [...question.answers];
    preserved.answerImages = question.answers.map(
      (_, idx) => question.answerImages?.[idx] || null
    );
    if (targetType === 'abcd') {
      const idx = Number(question.correctIndex);
      preserved.correctIndex =
        Number.isInteger(idx) && idx >= 0 && idx < preserved.answers.length
          ? idx
          : 0;
    }
  }

  // Zachowaj ustawienia slidera przy zmianie trybu
  if (targetType === 'slider' && question.type === 'slider') {
    preserved.sliderMin = question.sliderMin ?? 0;
    preserved.sliderMax = question.sliderMax ?? 100;
    preserved.sliderStep = question.sliderStep ?? 1;
    preserved.sliderUnit = question.sliderUnit || '';
    preserved.sliderCorrect = question.sliderCorrect ?? 50;
    preserved.sliderTolerance = question.sliderTolerance ?? 10;
    preserved.scored =
      quizMode === 'quiz'
        ? true
        : quizMode === 'opinion'
        ? false
        : question.scored !== false;
  }

  return preserved;
}
