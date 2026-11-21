import { Badge, cn } from '../ui';

function formatVal(val, unit = '') {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  const num = Number(val);
  const formatted = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function SliderResults({
  sliderStats,
  scored = false,
  barsAnimated = true,
  compact = false,
}) {
  if (!sliderStats) {
    return (
      <div className="rounded-base border-2 border-border bg-background p-6 text-center text-sm text-foreground/75">
        Brak danych dla pytania typu slider.
      </div>
    );
  }

  const {
    count = 0,
    avg = null,
    median = null,
    min = null,
    max = null,
    bins = [],
    sliderMin = 0,
    sliderMax = 100,
    sliderUnit = '',
    correctValue = null,
    tolerance = 0,
  } = sliderStats;

  const span = Math.max(1e-9, sliderMax - sliderMin);
  const toPercent = (v) =>
    Math.min(100, Math.max(0, ((Number(v) - sliderMin) / span) * 100));

  const maxBinCount = Math.max(...bins.map((b) => b.count), 1);

  const tolStartPct =
    scored && correctValue !== null
      ? toPercent(Math.max(sliderMin, correctValue - tolerance))
      : 0;
  const tolEndPct =
    scored && correctValue !== null
      ? toPercent(Math.min(sliderMax, correctValue + tolerance))
      : 0;
  const correctPct =
    scored && correctValue !== null ? toPercent(correctValue) : null;
  const avgPct = avg !== null ? toPercent(avg) : null;

  return (
    <div className="space-y-4">
      {/* Statystyki zbiorcze */}
      <div
        className={cn(
          'grid gap-3',
          scored
            ? 'grid-cols-2 sm:grid-cols-4'
            : 'grid-cols-2 sm:grid-cols-3'
        )}
      >
        <div className="rounded-base border-2 border-border bg-info/30 p-3 text-center">
          <div className="text-[11px] font-heading font-bold uppercase text-foreground/75">
            Średnia
          </div>
          <div className="font-heading text-xl md:text-2xl font-extrabold tabular-nums">
            {formatVal(avg, sliderUnit)}
          </div>
        </div>
        <div className="rounded-base border-2 border-border bg-purple/35 p-3 text-center">
          <div className="text-[11px] font-heading font-bold uppercase text-foreground/75">
            Mediana
          </div>
          <div className="font-heading text-xl md:text-2xl font-extrabold tabular-nums">
            {formatVal(median, sliderUnit)}
          </div>
        </div>
        <div className="rounded-base border-2 border-border bg-secondary-background p-3 text-center">
          <div className="text-[11px] font-heading font-bold uppercase text-foreground/75">
            Zakres odpowiedzi
          </div>
          <div className="font-heading text-base md:text-lg font-extrabold tabular-nums pt-0.5">
            {count > 0
              ? `${formatVal(min, sliderUnit)} – ${formatVal(max, sliderUnit)}`
              : '—'}
          </div>
        </div>
        {scored && correctValue !== null && (
          <div className="rounded-base border-2 border-border bg-main p-3 text-center shadow-shadow">
            <div className="text-[11px] font-heading font-bold uppercase text-foreground/80">
              Poprawna wartość
            </div>
            <div className="font-heading text-xl md:text-2xl font-extrabold tabular-nums">
              {formatVal(correctValue, sliderUnit)}
            </div>
            {tolerance > 0 && (
              <div className="text-[11px] font-heading font-bold">
                tolerancja ±{formatVal(tolerance, sliderUnit)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Histogram rozkładu wartości na osi */}
      <div className="rounded-base border-2 border-border bg-background p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-heading font-bold uppercase tracking-wide text-foreground/75">
            Rozkład odpowiedzi na osi ({count}{' '}
            {count === 1 ? 'odpowiedź' : 'odpowiedzi'})
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {avg !== null && (
              <Badge variant="info" className="tabular-nums">
                Średnia: {formatVal(avg, sliderUnit)}
              </Badge>
            )}
            {scored && correctValue !== null && (
              <Badge variant="default" className="tabular-nums">
                Cel: {formatVal(correctValue, sliderUnit)}
              </Badge>
            )}
          </div>
        </div>

        {/* Histogram słupkowy */}
        <div className="relative">
          {/* Strefa tolerancji w tle */}
          {scored && correctValue !== null && (
            <div
              style={{
                left: `${tolStartPct}%`,
                width: `${Math.max(tolEndPct - tolStartPct, 1.5)}%`,
              }}
              className="pointer-events-none absolute inset-y-0 bg-main/30 border-x-2 border-dashed border-border"
              title="Strefa poprawnych odpowiedzi"
            />
          )}

          <div
            className={cn(
              'relative grid items-end gap-1.5 rounded-base border-2 border-border bg-secondary-background p-2.5',
              compact ? 'h-28' : 'h-40'
            )}
            style={{
              gridTemplateColumns: `repeat(${Math.max(bins.length, 1)}, minmax(0, 1fr))`,
            }}
          >
            {bins.map((bin, idx) => {
              const pctHeight =
                count > 0 ? Math.round((bin.count / maxBinCount) * 100) : 0;
              const isInTarget =
                scored &&
                correctValue !== null &&
                bin.to >= correctValue - tolerance &&
                bin.from <= correctValue + tolerance;

              return (
                <div
                  key={idx}
                  className="flex h-full flex-col items-center justify-end gap-1"
                  title={`${formatVal(bin.from, sliderUnit)} – ${formatVal(bin.to, sliderUnit)}: ${bin.count}`}
                >
                  {bin.count > 0 && (
                    <span className="text-[10px] font-heading font-extrabold tabular-nums leading-none">
                      {bin.count}
                    </span>
                  )}
                  <div
                    style={{
                      height:
                        bin.count === 0
                          ? '4%'
                          : barsAnimated
                          ? `${Math.max(pctHeight, 12)}%`
                          : '4%',
                    }}
                    className={cn(
                      'w-full rounded-[3px] border-2 border-border transition-all duration-700 ease-out',
                      bin.count === 0
                        ? 'bg-background border-border/30'
                        : isInTarget
                        ? 'bg-main'
                        : 'bg-info'
                    )}
                  />
                </div>
              );
            })}
          </div>

          {/* Oś ze znacznikami średniej i celu */}
          <div className="relative mt-2 h-4 w-full rounded-base border-2 border-border bg-secondary-background">
            {scored && correctValue !== null && (
              <div
                style={{
                  left: `${tolStartPct}%`,
                  width: `${Math.max(tolEndPct - tolStartPct, 1.5)}%`,
                }}
                className="absolute inset-y-0 bg-main/50"
              />
            )}
            {avgPct !== null && (
              <div
                style={{ left: `${avgPct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-2.5 rounded-[2px] border-2 border-border bg-info"
                title={`Średnia: ${formatVal(avg, sliderUnit)}`}
              />
            )}
            {correctPct !== null && (
              <div
                style={{ left: `${correctPct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-3 rounded-[2px] border-2 border-border bg-main shadow-shadow"
                title={`Poprawna wartość: ${formatVal(correctValue, sliderUnit)}`}
              />
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-between text-xs font-heading font-bold tabular-nums text-foreground/80">
            <span>{formatVal(sliderMin, sliderUnit)}</span>
            <span>
              {formatVal((sliderMin + sliderMax) / 2, sliderUnit)}
            </span>
            <span>{formatVal(sliderMax, sliderUnit)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

