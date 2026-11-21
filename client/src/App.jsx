import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge, Button, cn } from './components/ui';
import {
  BACKEND_URL,
  createEmptyQuestion,
  createQuestionUid,
  socket,
} from './constants';
import { GameScreenView } from './components/GameScreenView';
import { HostControlPanel } from './components/HostControlPanel';
import { PlayerView } from './components/PlayerView';
import { AdminMenu } from './components/AdminMenu';
import { QuizEditor } from './components/QuizEditor';
import { isValidImageValue } from './utils/imageUtils';

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
  // Jeśli to osobne okno ekranu gry — renderujemy dedykowany widok rzutnika
  if (isGameScreenRoute) {
    return <GameScreenView pin={initialPin} />;
  }

  return <MainApp />;
}

function MainApp() {
  // ─── TRYB APLIKACJI ───
  // Admin: MENU | EDITOR | HOST
  // Player: PLAYER (zawsze)
  const [mode, setMode] = useState(() => (isAdminRoute ? 'MENU' : 'PLAYER'));

  // ─── STAN EDYTORA ───
  const [quizzes, setQuizzes] = useState([]);
  const [selectedQuizId, setSelectedQuizId] = useState('default-cyber-quiz');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorQuestions, setEditorQuestions] = useState(() => [
    createEmptyQuestion(),
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

  // ─── Pobieranie listy quizów ───
  const fetchQuizzes = useCallback(() => {
    fetch(`${BACKEND_URL}/api/quizzes`)
      .then((r) => r.json())
      .then((data) => setQuizzes(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isAdminRoute) fetchQuizzes();
  }, [mode, fetchQuizzes]);

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

    socket.on('host_podium', ({ podium, allResults: full }) => {
      setHostStatus('PODIUM');
      setAllResults(full || podium || []);
    });

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
    };
  }, []);

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
    }

    socket.emit('host_create_room', { quizId: selectedQuizId }, (res) => {
      if (res.error) {
        if (popup && !popup.closed) popup.close();
        alert(`Błąd: ${res.error}`);
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
    setEditorQuestions([createEmptyQuestion()]);
    setMode('EDITOR');
  };

  // ─── Edytor: otwórz istniejący quiz do edycji ───
  const openEditQuiz = async (quizId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/quizzes/${quizId}`);
      if (!res.ok) throw new Error('Nie znaleziono quizu');
      const quiz = await res.json();
      setEditingQuizId(quiz.id);
      setEditorTitle(quiz.title);
      setEditorQuestions(
        quiz.questions.map((q) => ({
          _uid: createQuestionUid(),
          content: q.content || '',
          image: q.image || null,
          timeLimit: q.timeLimit,
          answers: [...q.answers],
          answerImages: q.answers.map((_, idx) => q.answerImages?.[idx] || null),
          correctIndex: q.correctIndex,
        }))
      );
      setMode('EDITOR');
    } catch (err) {
      alert(`Błąd ładowania quizu: ${err.message}`);
    }
  };

  // ─── Edytor: zapisz (nowy lub aktualizacja) ───
  const saveQuiz = async (e) => {
    e.preventDefault();
    try {
      const isEditing = editingQuizId !== null;
      const url = isEditing
        ? `${BACKEND_URL}/api/quizzes/${editingQuizId}`
        : `${BACKEND_URL}/api/quizzes`;
      const method = isEditing ? 'PUT' : 'POST';

      const payloadQuestions = editorQuestions.map((q) => {
        const clean = {
          content: q.content || '',
          timeLimit: q.timeLimit,
          answers: [...q.answers],
          correctIndex: q.correctIndex,
        };
        if (q.image) {
          clean.image = q.image;
        }
        if (Array.isArray(q.answerImages) && q.answerImages.some(Boolean)) {
          clean.answerImages = q.answers.map((_, idx) => q.answerImages[idx] || null);
        }
        return clean;
      });

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editorTitle, questions: payloadQuestions }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSelectedQuizId(saved.id);
        setEditingQuizId(null);
        setMode('MENU');
        fetchQuizzes();
      } else {
        const errBody = await res.json().catch(() => ({}));
        alert(`Nie udało się zapisać quizu: ${errBody.error || res.statusText}`);
      }
    } catch (_err) {
      alert('Błąd zapisu quizu');
    }
  };

  // ─── Usuwanie quizu ───
  const deleteQuiz = async (quizId) => {
    if (!confirm('Czy na pewno chcesz usunąć ten quiz?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/quizzes/${quizId}`, { method: 'DELETE' });
      fetchQuizzes();
      if (selectedQuizId === quizId) setSelectedQuizId('default-cyber-quiz');
    } catch (_err) {
      alert('Błąd usuwania quizu');
    }
  };

  // ─── Export quizu do JSON ───
  const exportQuiz = async (quizId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/quizzes/${quizId}`);
      if (!res.ok) throw new Error('Quiz not found');
      const quiz = await res.json();
      const exportData = {
        title: quiz.title,
        questions: quiz.questions,
        exportedAt: new Date().toISOString(),
        version: '1.1',
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
    } catch (err) {
      alert(`Błąd eksportu: ${err.message}`);
    }
  };

  // ─── Import quizu z JSON ───
  const importQuiz = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (
        !data.title ||
        !Array.isArray(data.questions) ||
        data.questions.length === 0
      ) {
        throw new Error('Nieprawidłowy format pliku JSON');
      }
      for (const q of data.questions) {
        const hasQuestionContent =
          (typeof q.content === 'string' && q.content.trim().length > 0) ||
          isValidImageValue(q.image);
        if (!hasQuestionContent || !Array.isArray(q.answers) || q.answers.length < 2) {
          throw new Error('Nieprawidłowa struktura pytań w pliku');
        }
        const allAnswersValid = q.answers.every(
          (ans, idx) =>
            (typeof ans === 'string' && ans.trim().length > 0) ||
            isValidImageValue(q.answerImages?.[idx])
        );
        if (!allAnswersValid) {
          throw new Error('Każda odpowiedź musi zawierać tekst lub zdjęcie');
        }
        if (q.correctIndex === undefined || q.correctIndex < 0) {
          throw new Error('Brak oznaczenia poprawnej odpowiedzi');
        }
      }
      const res = await fetch(`${BACKEND_URL}/api/quizzes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: data.title, questions: data.questions }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSelectedQuizId(saved.id);
        fetchQuizzes();
        alert('Quiz zaimportowany pomyślnie!');
      } else {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || res.statusText);
      }
    } catch (err) {
      alert(`Błąd importu: ${err.message}`);
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

  const handleSubmitAnswer = (qIndex, answerIndex) => {
    socket.emit('submit_answer', {
      pin: playerPin,
      qIndex,
      answerIndex,
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
    isAdminRoute &&
    (mode === 'EDITOR' || (mode === 'HOST' && hostStatus === 'PODIUM'));

  // ════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* NAGŁÓWEK APLIKACJI */}
      <header className="w-full border-b-2 border-border bg-secondary-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <button
            type="button"
            onClick={() => {
              if (mode === 'EDITOR') {
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
                    : 'Panel Admina'
                  : 'Gracz'}
              </Badge>
            </div>
          </button>

          {isAdminRoute && mode === 'EDITOR' && (
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => setMode('MENU')}
            >
              ← Powrót do menu
            </Button>
          )}
        </div>
      </header>

      {/* TREŚĆ GŁÓWNA */}
      <div className="flex flex-1 flex-col justify-center px-4 py-6 md:px-8 md:py-10">
        {isAdminRoute && mode === 'MENU' && (
          <AdminMenu
            quizzes={quizzes}
            selectedQuizId={selectedQuizId}
            setSelectedQuizId={setSelectedQuizId}
            onCreateHostRoom={createHostRoom}
            onOpenNewQuizEditor={openNewQuizEditor}
            onOpenEditQuiz={openEditQuiz}
            onExportQuiz={exportQuiz}
            onDeleteQuiz={deleteQuiz}
            onImportQuiz={importQuiz}
            importFileRef={importFileRef}
          />
        )}

        {isAdminRoute && mode === 'EDITOR' && (
          <QuizEditor
            editingQuizId={editingQuizId}
            editorTitle={editorTitle}
            setEditorTitle={setEditorTitle}
            editorQuestions={editorQuestions}
            setEditorQuestions={setEditorQuestions}
            onSaveQuiz={saveQuiz}
          />
        )}

        {isAdminRoute && mode === 'HOST' && (
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

      {/* STOPKA */}
      <footer className="border-t-2 border-border bg-secondary-background px-4 py-3 text-center text-xs font-heading font-bold text-foreground/75">
        Cyber Quiz • Platforma quizów na żywo
      </footer>
    </div>
  );
}
