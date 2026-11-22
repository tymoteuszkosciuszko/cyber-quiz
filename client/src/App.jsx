import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge, Button, Toaster, toast, cn } from './components/ui';
import {
  QUIZ_MODES,
  createEmptyQuestion,
  createQuestionUid,
  getAllowedQuestionTypes,
  isQuestionScored,
  socket,
} from './constants';
import { GameScreenView } from './components/GameScreenView';
import { HostControlPanel } from './components/HostControlPanel';
import { PlayerView } from './components/PlayerView';
import { AdminMenu } from './components/AdminMenu';
import { QuizEditor } from './components/QuizEditor';
import { LoginView } from './components/auth/LoginView';
import { ForcePasswordChangeView } from './components/auth/ForcePasswordChangeView';
import { MfaVerifyView } from './components/auth/MfaVerifyView';
import { MfaEnrollmentView } from './components/auth/MfaEnrollmentView';
import { AccountSecurityModal } from './components/auth/AccountSecurityModal';
import { SuperAdminPanel } from './components/auth/SuperAdminPanel';
import { isValidImageValue } from './utils/imageUtils';
import {
  apiFetch,
  apiJson,
  setCsrfToken,
  setUnauthorizedHandler,
} from './utils/api';

// ════════════════════════════════════════════════════
// Routing:
//   "/"            → interfejs gracza (smartfon)
//   "/game-admin"  → panel prowadzącego / edytor quizów
//   "/game-screen" → osobne okno ekranu gry (rzutnik)
// ════════════════════════════════════════════════════
const pathname = window.location.pathname;
const isAdminRoute = pathname === '/game-admin';
const isGameScreenRoute = pathname === '/game-screen';
const urlParams = new URLSearchParams(window.location.search);
const initialPin = urlParams.get('pin') || '';

export default function App() {
  return (
    <>
      {isGameScreenRoute ? <GameScreenView pin={initialPin} /> : <MainApp />}
      <Toaster />
    </>
  );
}

function MainApp() {
  // ─── STAN UWIERZYTELNIANIA (tylko /game-admin) ───
  const [authLoading, setAuthLoading] = useState(isAdminRoute);
  const [authUser, setAuthUser] = useState(null);
  const [authStatus, setAuthStatus] = useState(null); // MFA_REQUIRED | MFA_ENROLLMENT_REQUIRED | MUST_CHANGE_PASSWORD | AUTHENTICATED
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  // ─── TRYB APLIKACJI ───
  // Admin: MENU | EDITOR | HOST | SUPERADMIN
  // Player: PLAYER (zawsze)
  const [mode, setMode] = useState(() => (isAdminRoute ? 'MENU' : 'PLAYER'));

  // ─── STAN EDYTORA ───
  const [quizzes, setQuizzes] = useState([]);
  const [selectedQuizId, setSelectedQuizId] = useState('default-cyber-quiz');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorMode, setEditorMode] = useState('quiz');
  const [editorQuestions, setEditorQuestions] = useState(() => [
    createEmptyQuestion('abcd', 'quiz'),
  ]);
  const [editingQuizId, setEditingQuizId] = useState(null);
  const importFileRef = useRef(null);

  // ─── STAN PANELU PROWADZĄCEGO (HOST CONTROLLER) ───
  const [roomPin, setRoomPin] = useState('');
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [hostStatus, setHostStatus] = useState('LOBBY');
  const [connectedScreens, setConnectedScreens] = useState(0);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [playersList, setPlayersList] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [previewDuration, setPreviewDuration] = useState(5);
  const [previewTimeLeft, setPreviewTimeLeft] = useState(0);
  const [answerCount, setAnswerCount] = useState({ count: 0, total: 0 });
  const [timeLeft, setTimeLeft] = useState(0);
  const [leaderboardData, setLeaderboardData] = useState(null);
  const [autoNextSeconds, setAutoNextSeconds] = useState(0);
  const [allResults, setAllResults] = useState([]);
  const [sessionEndMeta, setSessionEndMeta] = useState({
    sessionMode: 'quiz',
    hasScoredQuestions: true,
    questionSummaries: [],
  });
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const screenWindowRef = useRef(null);

  // ─── STAN GRACZA (SMARTFON) ───
  const [playerPin, setPlayerPin] = useState(initialPin);
  const [nickname, setNickname] = useState('');
  const [playerState, setPlayerState] = useState('JOIN');
  const [joinError, setJoinError] = useState('');
  const [padQuestion, setPadQuestion] = useState(null);
  const [playerPreview, setPlayerPreview] = useState(null);
  const [playerPreviewTimeLeft, setPlayerPreviewTimeLeft] = useState(0);
  const [playerResult, setPlayerResult] = useState(null);
  const [playerCountdown, setPlayerCountdown] = useState(0);

  const reconnectSocket = useCallback(() => {
    if (socket.connected) {
      socket.disconnect();
    }
    socket.connect();
  }, []);

  const clearAuthState = useCallback(() => {
    setCsrfToken(null);
    setAuthUser(null);
    setAuthStatus(null);
    setShowSecurityModal(false);
    setQuizzes([]);
    setMode('MENU');
    reconnectSocket();
  }, [reconnectSocket]);

  // ─── Sprawdzanie sesji przy starcie (/game-admin) ───
  useEffect(() => {
    if (!isAdminRoute) return undefined;

    setUnauthorizedHandler(() => {
      clearAuthState();
    });

    let cancelled = false;
    (async () => {
      try {
        const { res, data } = await apiJson('/api/auth/me', {
          skipAuthRedirect: true,
        });
        if (cancelled) return;
        if (res.ok && data.user) {
          setCsrfToken(data.csrfToken);
          setAuthUser(data.user);
          setAuthStatus(data.status || 'AUTHENTICATED');
        } else {
          setCsrfToken(null);
          setAuthUser(null);
          setAuthStatus(null);
        }
      } catch {
        if (!cancelled) {
          setCsrfToken(null);
          setAuthUser(null);
          setAuthStatus(null);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [clearAuthState]);

  const handleAuthenticated = useCallback(
    (payload) => {
      const nextUser = payload?.user ?? payload;
      const nextStatus =
        payload?.status ||
        (nextUser?.mustChangePassword ? 'MUST_CHANGE_PASSWORD' : 'AUTHENTICATED');
      setAuthUser(nextUser);
      setAuthStatus(nextStatus);
      setMode('MENU');
      if (nextStatus === 'AUTHENTICATED') {
        reconnectSocket();
      }
    },
    [reconnectSocket]
  );

  const handleLogout = useCallback(async () => {
    try {
      await apiJson('/api/auth/logout', {
        method: 'POST',
        skipAuthRedirect: true,
      });
    } catch {
      // ignore
    } finally {
      clearAuthState();
      toast.info('Wylogowano', 'Twoja sesja została zakończona.');
    }
  }, [clearAuthState]);

  const handleMfaCountChanged = useCallback((count) => {
    setAuthUser((prev) => {
      if (!prev || prev.mfaCredentialsCount === count) return prev;
      return { ...prev, mfaCredentialsCount: count };
    });
  }, []);

  const isFullyAuthenticatedAdmin =
    isAdminRoute && Boolean(authUser) && authStatus === 'AUTHENTICATED';

  // ─── Pobieranie listy quizów (tylko zalogowany admin) ───
  const fetchQuizzes = useCallback(async () => {
    if (!isFullyAuthenticatedAdmin) return;
    try {
      const res = await apiFetch('/api/quizzes');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setQuizzes(data);
        setSelectedQuizId((prev) =>
          data.some((q) => q.id === prev) ? prev : data[0]?.id || ''
        );
      }
    } catch {
      // ignore
    }
  }, [isFullyAuthenticatedAdmin]);

  useEffect(() => {
    if (isFullyAuthenticatedAdmin && mode === 'MENU') {
      fetchQuizzes();
    }
  }, [isFullyAuthenticatedAdmin, mode, fetchQuizzes]);

  // ─── Nasłuchiwanie zdarzeń WebSocket ───
  useEffect(() => {
    // Zdarzenia Prowadzącego (Host Controller)
    socket.on('screen_status_update', ({ connectedScreens: count }) => {
      setConnectedScreens(count);
      if (count > 0) setPopupBlocked(false);
    });

    socket.on('player_joined', ({ nickname: newNick }) => {
      setPlayersList((prev) =>
        prev.includes(newNick) ? prev : [...prev, newNick]
      );
    });

    socket.on('host_countdown', ({ seconds }) => {
      setHostStatus('COUNTDOWN');
      setCountdownSeconds(seconds);
    });

    socket.on('host_question_preview', (data) => {
      setHostStatus('QUESTION_PREVIEW');
      setCurrentQuestion(data);
      setPreviewDuration(data.previewDuration || 5);
      setPreviewTimeLeft(data.previewDuration || 5);
      setAnswerCount({ count: 0, total: data.totalPlayers });
    });

    socket.on('host_question_start', (data) => {
      setHostStatus('QUESTION');
      setCurrentQuestion(data);
      setAnswerCount({ count: 0, total: data.totalPlayers });
      setTimeLeft(data.timeLimit);
      setPreviewTimeLeft(0);
    });

    socket.on('answer_count_update', (data) => {
      setAnswerCount(data);
    });

    socket.on('host_question_end', (data) => {
      setHostStatus('LEADERBOARD');
      setLeaderboardData(data);
      setAutoNextSeconds(data.autoNextIn || 0);
    });

    socket.on('host_auto_next_status', ({ isPaused, autoNextIn }) => {
      setLeaderboardData((prev) => (prev ? { ...prev, isPaused } : prev));
      setAutoNextSeconds(autoNextIn || 0);
    });

    socket.on(
      'host_podium',
      ({
        podium,
        allResults: full,
        sessionMode = 'quiz',
        hasScoredQuestions = true,
        questionSummaries = [],
      }) => {
        setHostStatus('PODIUM');
        setAllResults(full || podium || []);
        setSessionEndMeta({
          sessionMode,
          hasScoredQuestions,
          questionSummaries,
        });
      }
    );

    // Zdarzenia Gracza
    socket.on('player_countdown', ({ seconds }) => {
      setPlayerCountdown(seconds);
      setPlayerState('COUNTDOWN');
    });

    socket.on('player_question_preview', (data) => {
      setPlayerPreview(data);
      setPlayerPreviewTimeLeft(data.previewDuration || 5);
      setPlayerCountdown(0);
      setPlayerState('PREVIEW');
    });

    socket.on('player_question_start', (data) => {
      setPadQuestion(data);
      setPlayerState('PAD');
      setPlayerCountdown(0);
      setPlayerPreviewTimeLeft(0);
    });

    socket.on('answer_locked', () => {
      setPlayerState('LOCKED');
    });

    socket.on('player_question_end', (data) => {
      setPlayerResult(data);
      setPlayerState('RESULT');
    });

    socket.on('player_podium', (data) => {
      setPlayerResult(data);
      setPlayerState('FINAL');
    });

    socket.on('game_aborted', () => {
      if (!isAdminRoute) {
        setPlayerState('ABORTED');
      }
    });

    socket.on('host_auth_error', ({ error }) => {
      if (isAdminRoute && error === 'UNAUTHORIZED') {
        clearAuthState();
      }
    });

    return () => {
      socket.off('screen_status_update');
      socket.off('player_joined');
      socket.off('host_countdown');
      socket.off('host_question_preview');
      socket.off('host_question_start');
      socket.off('answer_count_update');
      socket.off('host_question_end');
      socket.off('host_auto_next_status');
      socket.off('host_podium');
      socket.off('player_countdown');
      socket.off('player_question_preview');
      socket.off('player_question_start');
      socket.off('answer_locked');
      socket.off('player_question_end');
      socket.off('player_podium');
      socket.off('game_aborted');
      socket.off('host_auth_error');
    };
  }, [clearAuthState]);

  // ─── Odliczanie czasu podglądu pytania (Host Panel) ───
  useEffect(() => {
    if (hostStatus !== 'QUESTION_PREVIEW' || previewTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setPreviewTimeLeft((prev) => Math.max(0, +(prev - 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(timer);
  }, [hostStatus, previewTimeLeft]);

  // ─── Odliczanie czasu aktywnego pytania (Host Panel) ───
  useEffect(() => {
    if (hostStatus !== 'QUESTION' || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, +(prev - 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(timer);
  }, [hostStatus, timeLeft]);

  // ─── Odliczanie startowe (Host Panel) ───
  useEffect(() => {
    if (hostStatus !== 'COUNTDOWN' || countdownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [hostStatus, countdownSeconds]);

  // ─── Odliczanie auto-przejścia po wynikach (Host Panel) ───
  useEffect(() => {
    if (
      hostStatus !== 'LEADERBOARD' ||
      leaderboardData?.isPaused ||
      autoNextSeconds <= 0
    ) {
      return;
    }
    const timer = setInterval(() => {
      setAutoNextSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [hostStatus, leaderboardData?.isPaused, autoNextSeconds]);

  // ─── Odliczanie startowe gracza ───
  useEffect(() => {
    if (playerState !== 'COUNTDOWN' || playerCountdown <= 0) return;
    const timer = setInterval(() => {
      setPlayerCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [playerState, playerCountdown]);

  // ─── Odliczanie podglądu pytania gracza (5s przed odblokowaniem przycisków) ───
  useEffect(() => {
    if (playerState !== 'PREVIEW' || playerPreviewTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setPlayerPreviewTimeLeft((prev) => Math.max(0, +(prev - 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(timer);
  }, [playerState, playerPreviewTimeLeft]);

  // ════════════════════════════════════════════════════
  // AKCJE — HOST / PROWADZĄCY
  // ════════════════════════════════════════════════════

  const openGameScreenWindow = (pinToOpen) => {
    const targetPin = pinToOpen || roomPin;
    if (!targetPin) return;
    const url = `${window.location.origin}/game-screen?pin=${targetPin}`;

    if (screenWindowRef.current && !screenWindowRef.current.closed) {
      try {
        if (screenWindowRef.current.location.href !== url) {
          screenWindowRef.current.location.href = url;
        }
        screenWindowRef.current.focus();
        setPopupBlocked(false);
        return;
      } catch (_err) {
        // Fallback: otwórz nowe okno poniżej
      }
    }

    const win = window.open(
      url,
      'cyber-quiz-game-screen',
      'width=1280,height=800,menubar=no,toolbar=no,location=no'
    );
    if (win) {
      screenWindowRef.current = win;
      win.focus();
      setPopupBlocked(false);
    } else {
      setPopupBlocked(true);
    }
  };

  const createHostRoom = () => {
    // Otwieramy okno synchronicznie w obsłudze kliknięcia, żeby przeglądarka nie zablokowała popupu
    const popup = window.open(
      '',
      'cyber-quiz-game-screen',
      'width=1280,height=800,menubar=no,toolbar=no,location=no'
    );

    if (popup) {
      screenWindowRef.current = popup;
      setPopupBlocked(false);
      try {
        popup.document.title = 'Cyber Quiz — Ekran gry';
        popup.document.body.innerHTML =
          '<div style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f2f7f3;font-weight:700;font-size:20px;">Uruchamianie ekranu gry...</div>';
      } catch (_err) {
        // ignore cross-origin if reused
      }
    } else {
      setPopupBlocked(true);
      toast.warning(
        'Zablokowano okno ekranu gry',
        'Kliknij „Otwórz ekran gry” w panelu prowadzącego.'
      );
    }

    socket.emit('host_create_room', { quizId: selectedQuizId }, (res) => {
      if (res.error) {
        if (popup && !popup.closed) popup.close();
        if (res.error === 'UNAUTHORIZED') {
          clearAuthState();
          toast.warning('Sesja wygasła', 'Zaloguj się ponownie.');
          return;
        }
        toast.error('Nie udało się uruchomić sesji', res.error);
        return;
      }

      setRoomPin(res.pin);
      setActiveQuiz(res.quiz);
      setPlayersList([]);
      setCurrentQuestion(null);
      setLeaderboardData(null);
      setAllResults([]);
      setConnectedScreens(0);
      setHostStatus('LOBBY');
      setMode('HOST');
      toast.success(
        'Uruchomiono sesję',
        `Kod PIN pokoju: ${res.pin}`
      );

      const screenUrl = `${window.location.origin}/game-screen?pin=${res.pin}`;
      if (popup && !popup.closed) {
        popup.location.href = screenUrl;
        popup.focus();
      }
    });
  };

  const resetHostStateToMenu = () => {
    setRoomPin('');
    setActiveQuiz(null);
    setPlayersList([]);
    setCurrentQuestion(null);
    setLeaderboardData(null);
    setAllResults([]);
    setConnectedScreens(0);
    setPopupBlocked(false);
    setHostStatus('LOBBY');
    setMode('MENU');
  };

  const handleAbortGame = () => {
    if (
      !confirm(
        'Czy na pewno chcesz przerwać grę? Wszyscy uczestnicy zostaną rozłączeni z bieżącej sesji.'
      )
    ) {
      return;
    }
    socket.emit('host_abort_game', { pin: roomPin }, () => {
      resetHostStateToMenu();
      toast.warning(
        'Przerwano sesję',
        'Wszyscy uczestnicy zostali rozłączeni.'
      );
    });
  };

  const handleFinishSession = () => {
    socket.emit('host_leave_room', { pin: roomPin }, () => {
      resetHostStateToMenu();
    });
  };

  // ─── Edytor: otwórz nowy quiz ───
  const openNewQuizEditor = () => {
    setEditingQuizId(null);
    setEditorTitle('');
    setEditorMode('quiz');
    setEditorQuestions([createEmptyQuestion('abcd', 'quiz')]);
    setMode('EDITOR');
  };

  // ─── Edytor: otwórz istniejący quiz do edycji ───
  const openEditQuiz = async (quizId) => {
    try {
      const res = await apiFetch(`/api/quizzes/${quizId}`);
      if (!res.ok) throw new Error('Nie znaleziono zestawu');
      const quiz = await res.json();
      if (!quiz.canEdit) {
        toast.warning(
          'Szablon tylko do odczytu',
          'Sklonuj ten szablon, aby móc go edytować.'
        );
        return;
      }
      const quizMode = QUIZ_MODES[quiz.mode] ? quiz.mode : 'quiz';
      setEditingQuizId(quiz.id);
      setEditorTitle(quiz.title);
      setEditorMode(quizMode);
      setEditorQuestions(
        quiz.questions.map((q) => {
          const type = q.type || 'abcd';
          const base = {
            _uid: createQuestionUid(),
            type,
            content: q.content || '',
            image: q.image || null,
            timeLimit: q.timeLimit || 20,
            scored: isQuestionScored(q, quizMode),
          };
          if (type === 'abcd' || type === 'true_false' || type === 'poll') {
            const answers = Array.isArray(q.answers)
              ? [...q.answers]
              : type === 'true_false'
                ? ['Prawda', 'Fałsz']
                : ['', '', '', ''];
            base.answers = answers;
            base.answerImages = answers.map((_, idx) => q.answerImages?.[idx] || null);
            if (type === 'abcd' || type === 'true_false') {
              base.correctIndex = q.correctIndex ?? 0;
            }
          } else if (type === 'slider') {
            base.sliderMin = q.sliderMin ?? 0;
            base.sliderMax = q.sliderMax ?? 100;
            base.sliderStep = q.sliderStep ?? 1;
            base.sliderUnit = q.sliderUnit || '';
            if (base.scored) {
              base.sliderCorrect = q.sliderCorrect ?? 50;
              base.sliderTolerance = q.sliderTolerance ?? 0;
            }
          } else if (type === 'word_cloud') {
            base.maxLength = q.maxLength ?? 32;
          }
          return base;
        })
      );
      setMode('EDITOR');
    } catch (err) {
      toast.error('Błąd ładowania zestawu', err.message);
    }
  };

  // ─── Edytor: zapisz (nowy lub aktualizacja) ───
  const saveQuiz = async (e) => {
    e.preventDefault();
    try {
      const isEditing = editingQuizId !== null;
      const url = isEditing
        ? `/api/quizzes/${editingQuizId}`
        : `/api/quizzes`;
      const method = isEditing ? 'PUT' : 'POST';

      const payloadQuestions = editorQuestions.map((q) => {
        const type = q.type || 'abcd';
        const scored = isQuestionScored(q, editorMode);
        const clean = {
          type,
          content: q.content || '',
          timeLimit: q.timeLimit,
          scored,
        };
        if (q.image) {
          clean.image = q.image;
        }
        if (type === 'abcd' || type === 'true_false' || type === 'poll') {
          clean.answers = [...(q.answers || [])];
          if (Array.isArray(q.answerImages) && q.answerImages.some(Boolean)) {
            clean.answerImages = clean.answers.map(
              (_, idx) => q.answerImages[idx] || null
            );
          }
          if (type === 'abcd' || type === 'true_false') {
            clean.correctIndex = q.correctIndex ?? 0;
          }
        } else if (type === 'slider') {
          clean.sliderMin = Number(q.sliderMin);
          clean.sliderMax = Number(q.sliderMax);
          clean.sliderStep = Number(q.sliderStep);
          clean.sliderUnit = q.sliderUnit || '';
          if (scored) {
            clean.sliderCorrect = Number(q.sliderCorrect);
            clean.sliderTolerance = Number(q.sliderTolerance ?? 0);
          }
        } else if (type === 'word_cloud') {
          clean.maxLength = Number(q.maxLength || 32);
        }
        return clean;
      });

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editorTitle,
          mode: editorMode,
          questions: payloadQuestions,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSelectedQuizId(saved.id);
        setEditingQuizId(null);
        setMode('MENU');
        fetchQuizzes();
        toast.success(
          isEditing ? 'Zapisano zmiany w zestawie' : 'Utworzono nowy zestaw',
          saved.title || editorTitle
        );
      } else {
        const errBody = await res.json().catch(() => ({}));
        toast.error(
          'Nie udało się zapisać zestawu',
          errBody.error || res.statusText
        );
      }
    } catch (_err) {
      toast.error('Błąd zapisu zestawu', 'Sprawdź połączenie z serwerem.');
    }
  };

  // ─── Klonowanie szablonu / quizu ───
  const cloneQuiz = async (quizId) => {
    try {
      const res = await apiFetch(`/api/quizzes/${quizId}/clone`, {
        method: 'POST',
      });
      if (res.ok) {
        const cloned = await res.json();
        setSelectedQuizId(cloned.id);
        fetchQuizzes();
        toast.success('Sklonowano zestaw', cloned.title);
      } else {
        const errBody = await res.json().catch(() => ({}));
        toast.error(
          'Nie udało się sklonować zestawu',
          errBody.error || res.statusText
        );
      }
    } catch {
      toast.error('Błąd klonowania zestawu', 'Sprawdź połączenie z serwerem.');
    }
  };

  // ─── Usuwanie quizu ───
  const deleteQuiz = async (quizId) => {
    if (!confirm('Czy na pewno chcesz usunąć ten zestaw?')) return;
    const targetQuiz = quizzes.find((q) => q.id === quizId);
    try {
      const res = await apiFetch(`/api/quizzes/${quizId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        toast.error(
          'Nie udało się usunąć zestawu',
          errBody.error || res.statusText
        );
        return;
      }
      fetchQuizzes();
      if (selectedQuizId === quizId) setSelectedQuizId('default-cyber-quiz');
      toast.success(
        'Usunięto zestaw',
        targetQuiz?.title ? `Usunięto „${targetQuiz.title}”.` : undefined
      );
    } catch (_err) {
      toast.error('Błąd usuwania zestawu', 'Sprawdź połączenie z serwerem.');
    }
  };

  // ─── Export quizu do JSON ───
  const exportQuiz = async (quizId) => {
    try {
      const res = await apiFetch(`/api/quizzes/${quizId}`);
      if (!res.ok) throw new Error('Quiz not found');
      const quiz = await res.json();
      const exportData = {
        title: quiz.title,
        mode: quiz.mode || 'quiz',
        questions: quiz.questions,
        exportedAt: new Date().toISOString(),
        version: '2.0',
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quiz.title.replace(
        /[^a-zA-Z0-9_ąćęłńóśżźĄĆĘŁŃÓŚŻŹ ]/g,
        '_'
      )}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Wyeksportowano zestaw do JSON', quiz.title);
    } catch (err) {
      toast.error('Błąd eksportu', err.message);
    }
  };

  // ─── Import quizu z JSON ───
  const importQuiz = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const importMode = QUIZ_MODES[data.mode] ? data.mode : 'quiz';
      const allowedTypes = getAllowedQuestionTypes(importMode);

      if (
        !data.title ||
        !Array.isArray(data.questions) ||
        data.questions.length === 0
      ) {
        throw new Error('Nieprawidłowy format pliku JSON');
      }
      for (const q of data.questions) {
        const qType = q.type || 'abcd';
        if (!allowedTypes.includes(qType)) {
          throw new Error(`Nieobsługiwany typ pytania (${qType}) dla trybu ${importMode}`);
        }
        const hasQuestionContent =
          (typeof q.content === 'string' && q.content.trim().length > 0) ||
          isValidImageValue(q.image);
        if (!hasQuestionContent) {
          throw new Error('Każde pytanie musi zawierać treść lub zdjęcie');
        }
        if (qType === 'abcd' || qType === 'true_false' || qType === 'poll') {
          if (!Array.isArray(q.answers) || q.answers.length < 2) {
            throw new Error('Nieprawidłowa struktura odpowiedzi w pliku');
          }
          const allAnswersValid = q.answers.every(
            (ans, idx) =>
              (typeof ans === 'string' && ans.trim().length > 0) ||
              isValidImageValue(q.answerImages?.[idx])
          );
          if (!allAnswersValid) {
            throw new Error('Każda odpowiedź musi zawierać tekst lub zdjęcie');
          }
          if (
            (qType === 'abcd' || qType === 'true_false') &&
            (q.correctIndex === undefined || q.correctIndex < 0)
          ) {
            throw new Error('Brak oznaczenia poprawnej odpowiedzi');
          }
        } else if (qType === 'slider') {
          if (
            !Number.isFinite(Number(q.sliderMin)) ||
            !Number.isFinite(Number(q.sliderMax)) ||
            Number(q.sliderMax) <= Number(q.sliderMin)
          ) {
            throw new Error('Nieprawidłowy zakres dla pytania typu slider');
          }
        }
      }
      const res = await apiFetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          mode: importMode,
          questions: data.questions,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSelectedQuizId(saved.id);
        fetchQuizzes();
        toast.success(
          'Zestaw zaimportowany pomyślnie',
          saved.title || data.title
        );
      } else {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || res.statusText);
      }
    } catch (err) {
      toast.error('Błąd importu zestawu', err.message);
    }
    if (importFileRef.current) importFileRef.current.value = '';
  };

  // ════════════════════════════════════════════════════
  // AKCJE — GRACZ
  // ════════════════════════════════════════════════════

  const handlePlayerJoin = (e) => {
    e.preventDefault();
    setJoinError('');
    socket.emit('player_join', { pin: playerPin, nickname }, (res) => {
      if (res.error) setJoinError(res.error);
      else {
        setNickname(res.nickname);
        setPlayerState('WAITING');
      }
    });
  };

  const handleSubmitAnswer = (answerPayload) => {
    socket.emit('submit_answer', {
      pin: playerPin,
      ...answerPayload,
    });
  };

  const handleResetPlayerToJoin = () => {
    setPlayerPin('');
    setJoinError('');
    setPlayerResult(null);
    setPadQuestion(null);
    setPlayerPreview(null);
    setPlayerState('JOIN');
  };

  const canReturnToMenu =
    isFullyAuthenticatedAdmin &&
    (mode === 'EDITOR' ||
      mode === 'SUPERADMIN' ||
      (mode === 'HOST' && hostStatus === 'PODIUM'));

  // ════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* NAGŁÓWEK APLIKACJI */}
      <header className="w-full border-b-2 border-border bg-secondary-background">
        <div
          className={cn(
            'mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8',
            isAdminRoute && mode === 'EDITOR' ? 'max-w-7xl' : 'max-w-6xl'
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (mode === 'EDITOR' || mode === 'SUPERADMIN') {
                setMode('MENU');
              } else if (mode === 'HOST' && hostStatus === 'PODIUM') {
                handleFinishSession();
              }
            }}
            className={cn(
              'flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-base',
              canReturnToMenu ? 'cursor-pointer' : 'cursor-default'
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow flex-shrink-0">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-xl font-extrabold tracking-tight md:text-2xl">
                Cyber Quiz
              </span>
              <Badge variant={isAdminRoute ? 'default' : 'neutral'}>
                {isAdminRoute
                  ? mode === 'HOST'
                    ? 'Panel Prowadzącego'
                    : mode === 'SUPERADMIN'
                      ? 'Administracja'
                      : 'Panel Admina'
                  : 'Gracz'}
              </Badge>
            </div>
          </button>

          {isFullyAuthenticatedAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'EDITOR' && (
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setMode('MENU')}
                >
                  ← Powrót do menu
                </Button>
              )}
              {authUser.role === 'superadmin' && mode !== 'HOST' && (
                <Button
                  type="button"
                  variant={mode === 'SUPERADMIN' ? 'default' : 'warning'}
                  size="sm"
                  onClick={() =>
                    setMode(mode === 'SUPERADMIN' ? 'MENU' : 'SUPERADMIN')
                  }
                >
                  {mode === 'SUPERADMIN' ? 'Quizy' : 'Admini i Audyt'}
                </Button>
              )}
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() => setShowSecurityModal(true)}
              >
                {authUser.username} (
                {authUser.role === 'superadmin' ? 'Superadmin' : 'Admin'})
              </Button>
              {mode !== 'HOST' && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={handleLogout}
                >
                  Wyloguj
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* TREŚĆ GŁÓWNA */}
      <div
        className={cn(
          'flex flex-1 flex-col',
          isAdminRoute && mode === 'EDITOR'
            ? 'justify-start px-4 py-4 md:px-8 md:py-6'
            : 'justify-center px-4 py-6 md:px-8 md:py-10'
        )}
      >
        {isAdminRoute && authLoading && (
          <div className="mx-auto text-sm font-heading font-bold text-foreground/75">
            Sprawdzanie sesji...
          </div>
        )}

        {isAdminRoute && !authLoading && !authUser && (
          <LoginView onAuthenticated={handleAuthenticated} />
        )}

        {isAdminRoute && !authLoading && authUser && authStatus === 'MFA_REQUIRED' && (
          <MfaVerifyView
            user={authUser}
            onAuthenticated={handleAuthenticated}
            onLogout={handleLogout}
            onSessionExpired={clearAuthState}
          />
        )}

        {isAdminRoute &&
          !authLoading &&
          authUser &&
          authStatus === 'MFA_ENROLLMENT_REQUIRED' && (
            <MfaEnrollmentView
              user={authUser}
              onCompleted={handleAuthenticated}
              onLogout={handleLogout}
              onSessionExpired={clearAuthState}
            />
          )}

        {isAdminRoute &&
          !authLoading &&
          authUser &&
          authStatus === 'MUST_CHANGE_PASSWORD' && (
            <ForcePasswordChangeView
              user={authUser}
              onPasswordChanged={handleAuthenticated}
              onLogout={handleLogout}
            />
          )}

        {isFullyAuthenticatedAdmin && mode === 'SUPERADMIN' && (
          <SuperAdminPanel onBack={() => setMode('MENU')} />
        )}

        {isFullyAuthenticatedAdmin && mode === 'MENU' && (
          <AdminMenu
            quizzes={quizzes}
            selectedQuizId={selectedQuizId}
            setSelectedQuizId={setSelectedQuizId}
            onCreateHostRoom={createHostRoom}
            onOpenNewQuizEditor={openNewQuizEditor}
            onOpenEditQuiz={openEditQuiz}
            onCloneQuiz={cloneQuiz}
            onExportQuiz={exportQuiz}
            onDeleteQuiz={deleteQuiz}
            onImportQuiz={importQuiz}
            importFileRef={importFileRef}
          />
        )}

        {isFullyAuthenticatedAdmin && mode === 'EDITOR' && (
          <QuizEditor
            editingQuizId={editingQuizId}
            editorTitle={editorTitle}
            setEditorTitle={setEditorTitle}
            editorMode={editorMode}
            setEditorMode={setEditorMode}
            editorQuestions={editorQuestions}
            setEditorQuestions={setEditorQuestions}
            onSaveQuiz={saveQuiz}
          />
        )}

        {isFullyAuthenticatedAdmin && mode === 'HOST' && (
          <HostControlPanel
            roomPin={roomPin}
            activeQuiz={activeQuiz}
            hostStatus={hostStatus}
            connectedScreens={connectedScreens}
            popupBlocked={popupBlocked}
            playersList={playersList}
            countdownSeconds={countdownSeconds}
            currentQuestion={currentQuestion}
            previewTimeLeft={previewTimeLeft}
            previewDuration={previewDuration}
            timeLeft={timeLeft}
            answerCount={answerCount}
            leaderboardData={leaderboardData}
            autoNextSeconds={autoNextSeconds}
            allResults={allResults}
            sessionEndMeta={sessionEndMeta}
            onOpenGameScreen={() => openGameScreenWindow(roomPin)}
            onStartGame={() => socket.emit('host_start_game', { pin: roomPin })}
            onForceNext={() => socket.emit('host_force_next', { pin: roomPin })}
            onTogglePause={() =>
              socket.emit('host_toggle_pause', { pin: roomPin })
            }
            onAbortGame={handleAbortGame}
            onFinishSession={handleFinishSession}
          />
        )}

        {!isAdminRoute && (
          <PlayerView
            playerState={playerState}
            playerPin={playerPin}
            setPlayerPin={setPlayerPin}
            nickname={nickname}
            setNickname={setNickname}
            joinError={joinError}
            playerCountdown={playerCountdown}
            playerPreview={playerPreview}
            playerPreviewTimeLeft={playerPreviewTimeLeft}
            padQuestion={padQuestion}
            playerResult={playerResult}
            onJoin={handlePlayerJoin}
            onSubmitAnswer={handleSubmitAnswer}
            onResetToJoin={handleResetPlayerToJoin}
          />
        )}
      </div>

      {authUser && isFullyAuthenticatedAdmin && (
        <AccountSecurityModal
          open={showSecurityModal}
          onOpenChange={setShowSecurityModal}
          user={authUser}
          onPasswordChanged={(updatedUser) => {
            setAuthUser(updatedUser);
            setAuthStatus('AUTHENTICATED');
            reconnectSocket();
          }}
          onMfaCountChanged={handleMfaCountChanged}
          onLoggedOutAll={clearAuthState}
        />
      )}

      {/* STOPKA */}
      <footer className="border-t-2 border-border bg-secondary-background px-4 py-3 text-center text-xs font-heading font-bold text-foreground/75">
        Cyber Quiz | <a className="text-emerald-500" href="https://github.com/tymoteuszkosciuszko/cyber-quiz">Repo GitHub</a>
      </footer>
    </div>
  );
}
