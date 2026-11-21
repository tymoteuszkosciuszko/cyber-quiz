export const DEFAULT_QUIZ_ID = 'default-cyber-quiz';

export const SEED_TEMPLATES = [
  {
    id: DEFAULT_QUIZ_ID,
    title: 'PROTOKÓŁ: BEZPIECZEŃSTWO SIECIOWE_v1.0',
    mode: 'quiz',
    questions: [
      {
        type: 'abcd',
        content: 'Który port domyślnie odpowiada za szyfrowany ruch HTTPS?',
        timeLimit: 15,
        answers: ['Port 80', 'Port 443', 'Port 22', 'Port 8080'],
        correctIndex: 1,
        scored: true,
      },
      {
        type: 'abcd',
        content:
          'Jaka jest złożoność czasowa operacji ZADD w strukturze Sorted Set (Redis)?',
        timeLimit: 20,
        answers: ['O(1)', 'O(log N)', 'O(N)', 'O(N²)'],
        correctIndex: 1,
        scored: true,
      },
      {
        type: 'abcd',
        content:
          'Co oznacza skrót XSS w kontekście podatności aplikacji webowych?',
        timeLimit: 15,
        answers: [
          'Extreme Server Security',
          'Cross-Site Scripting',
          'XML System Socket',
          'X-Ray Socket Layer',
        ],
        correctIndex: 1,
        scored: true,
      },
      {
        type: 'abcd',
        content:
          'Który atak polega na przechwytywaniu komunikacji między dwiema stronami bez ich wiedzy?',
        timeLimit: 20,
        answers: [
          'Brute Force',
          'Phishing',
          'Man-in-the-Middle',
          'SQL Injection',
        ],
        correctIndex: 2,
        scored: true,
      },
      {
        type: 'abcd',
        content: 'Jakie rozszerzenie pliku najczęściej kojarzy się z ransomware?',
        timeLimit: 15,
        answers: ['.locked / .crypt', '.pdf', '.docx', '.html'],
        correctIndex: 0,
        scored: true,
      },
    ],
  },
  {
    id: 'demo-mixed-session',
    title: 'DEMO: WSZYSTKIE FORMY PYTAŃ (TRYB MIESZANY)',
    mode: 'mixed',
    questions: [
      {
        type: 'abcd',
        content: 'Który protokół działa w warstwie transportowej modelu OSI?',
        timeLimit: 15,
        answers: ['HTTP', 'TCP', 'ARP', 'DNS'],
        correctIndex: 1,
        scored: true,
      },
      {
        type: 'true_false',
        content:
          'Prawda czy fałsz: Protokół UDP gwarantuje dostarczenie wszystkich pakietów w kolejności.',
        timeLimit: 15,
        answers: ['Prawda', 'Fałsz'],
        correctIndex: 1,
        scored: true,
      },
      {
        type: 'slider',
        content: 'W którym roku opublikowano pierwszą wersję jądra Linux?',
        timeLimit: 20,
        sliderMin: 1980,
        sliderMax: 2005,
        sliderStep: 1,
        sliderUnit: 'r.',
        scored: true,
        sliderCorrect: 1991,
        sliderTolerance: 3,
      },
      {
        type: 'poll',
        content: 'Z jakiego systemu operacyjnego korzystasz najczęściej na co dzień?',
        timeLimit: 20,
        answers: ['Linux', 'macOS', 'Windows', 'Inny / kilka naraz'],
        scored: false,
      },
      {
        type: 'word_cloud',
        content:
          'Jednym słowem: z czym najbardziej kojarzy Ci się cyberbezpieczeństwo?',
        timeLimit: 25,
        maxLength: 28,
        scored: false,
      },
    ],
  },
  {
    id: 'demo-opinion-session',
    title: 'DEMO: SESJA OPINII I ANKIET',
    mode: 'opinion',
    questions: [
      {
        type: 'poll',
        content: 'Jaki format warsztatów preferujesz najbardziej?',
        timeLimit: 20,
        answers: [
          'Live coding',
          'Capture The Flag (CTF)',
          'Prezentacja + Q&A',
          'Case study',
        ],
        scored: false,
      },
      {
        type: 'slider',
        content:
          'Jak oceniasz swój obecny poziom wiedzy o bezpieczeństwie aplikacji webowych?',
        timeLimit: 20,
        sliderMin: 1,
        sliderMax: 10,
        sliderStep: 1,
        sliderUnit: '/10',
        scored: false,
      },
      {
        type: 'word_cloud',
        content: 'Jakie narzędzie lub technologię chcesz poznać w tym roku?',
        timeLimit: 25,
        maxLength: 32,
        scored: false,
      },
    ],
  },
];

