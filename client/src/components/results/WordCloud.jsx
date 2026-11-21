import { Badge, cn } from '../ui';

const CLOUD_BG_CLASSES = [
  'bg-main',
  'bg-warning',
  'bg-info',
  'bg-purple',
  'bg-danger',
  'bg-secondary-background',
];

function hashWord(word) {
  let h = 0;
  for (let i = 0; i < word.length; i++) {
    h = (h * 31 + word.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Rozmieszcza najczęstsze hasła bliżej środka listy dla naturalnego układu chmury słów.
 */
function arrangeCenterWeighted(entries) {
  const sorted = [...entries].sort(
    (a, b) => b.count - a.count || a.word.localeCompare(b.word)
  );
  const arranged = [];
  sorted.forEach((item, idx) => {
    if (idx % 2 === 0) arranged.push(item);
    else arranged.unshift(item);
  });
  return arranged;
}

export function WordCloud({
  entries = [],
  totalResponses = 0,
  uniqueCount = 0,
  compact = false,
}) {
  if (!entries || entries.length === 0) {
    return (
      <div className="rounded-base border-2 border-border bg-background p-8 text-center text-sm font-heading font-bold text-foreground/75">
        Brak przesłanych haseł w tej rundzie.
      </div>
    );
  }

  const maxCount = Math.max(...entries.map((e) => e.count), 1);
  const minCount = Math.min(...entries.map((e) => e.count), 1);
  const arranged = arrangeCenterWeighted(entries.slice(0, compact ? 20 : 40));

  const getScaleStyle = (count) => {
    const ratio =
      maxCount === minCount ? 1 : (count - minCount) / (maxCount - minCount);
    const minPx = compact ? 13 : 16;
    const maxPx = compact ? 26 : 44;
    const fontSize = Math.round(minPx + ratio * (maxPx - minPx));
    return { fontSize: `${fontSize}px`, lineHeight: 1.15 };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-heading font-bold uppercase tracking-wide text-foreground/75">
          Chmura słów
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="tabular-nums">
            Odpowiedzi: {totalResponses}
          </Badge>
          <Badge variant="info" className="tabular-nums">
            Unikalne hasła: {uniqueCount || entries.length}
          </Badge>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-center rounded-base border-2 border-border bg-background',
          compact ? 'gap-2 p-4 min-h-[9rem]' : 'gap-3 md:gap-4 p-6 md:p-8 min-h-[15rem]'
        )}
      >
        {arranged.map((entry, idx) => {
          const colorClass =
            CLOUD_BG_CLASSES[hashWord(entry.word) % CLOUD_BG_CLASSES.length];
          const isTop = entry.count === maxCount && maxCount > 1;

          return (
            <span
              key={entry.word}
              style={{
                ...getScaleStyle(entry.count),
                animationDelay: `${Math.min(idx, 18) * 40}ms`,
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-base border-2 border-border px-3 py-1 font-heading font-extrabold text-foreground animate-answer-reveal',
                colorClass,
                isTop ? 'shadow-shadow' : ''
              )}
            >
              <span>{entry.word}</span>
              <span className="inline-flex items-center justify-center rounded-base border border-border bg-secondary-background px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums">
                ×{entry.count}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

