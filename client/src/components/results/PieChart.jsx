import { Badge, cn } from '../ui';
import { ANSWER_OPTIONS } from '../../constants';

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSlice(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M',
    cx,
    cy,
    'L',
    start.x,
    start.y,
    'A',
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    'Z',
  ].join(' ');
}

export function PieChart({
  distribution = [],
  answers = [],
  answerImages = [],
  compact = false,
}) {
  const count = Math.max(distribution.length, answers.length);
  const items = Array.from({ length: count }, (_, idx) => ({
    idx,
    count: Number(distribution[idx] || 0),
    label: answers[idx] || '',
    image: answerImages?.[idx] || null,
    opt: ANSWER_OPTIONS[idx] || ANSWER_OPTIONS[0],
  }));

  const total = items.reduce((sum, item) => sum + item.count, 0);
  const nonZero = items.filter((item) => item.count > 0);

  let currentAngle = 0;
  const slices = nonZero.map((item) => {
    const angle = total > 0 ? (item.count / total) * 360 : 0;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    const midAngle = startAngle + angle / 2;
    currentAngle = endAngle;
    const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
    return {
      ...item,
      startAngle,
      endAngle,
      midAngle,
      pct,
    };
  });

  const cx = 120;
  const cy = 120;
  const radius = 104;

  return (
    <div
      className={cn(
        'grid gap-6 items-center',
        compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-12'
      )}
    >
      {/* Wykres kołowy SVG */}
      <div
        className={cn(
          'flex flex-col items-center justify-center',
          !compact && 'md:col-span-5'
        )}
      >
        <div className="relative flex items-center justify-center">
          <svg
            viewBox="0 0 240 240"
            className={cn(
              'drop-shadow-[4px_4px_0px_#000000] animate-countdown-pop',
              compact ? 'h-44 w-44' : 'h-60 w-60 md:h-64 md:w-64'
            )}
            role="img"
            aria-label="Wykres kołowy wyników ankiety"
          >
            {total === 0 ? (
              <>
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="#ffffff"
                  stroke="#000000"
                  strokeWidth="4"
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-heading font-bold text-sm fill-black"
                >
                  Brak głosów
                </text>
              </>
            ) : slices.length === 1 ? (
              <>
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={slices[0].opt.hex}
                  stroke="#000000"
                  strokeWidth="4"
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-heading font-extrabold text-2xl fill-black"
                >
                  100%
                </text>
              </>
            ) : (
              slices.map((slice) => {
                const labelPos = polarToCartesian(
                  cx,
                  cy,
                  radius * 0.62,
                  slice.midAngle
                );
                return (
                  <g key={slice.idx}>
                    <path
                      d={describeSlice(
                        cx,
                        cy,
                        radius,
                        slice.startAngle,
                        slice.endAngle
                      )}
                      fill={slice.opt.hex}
                      stroke="#000000"
                      strokeWidth="3.5"
                      strokeLinejoin="round"
                    />
                    {slice.pct >= 8 && (
                      <text
                        x={labelPos.x}
                        y={labelPos.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="font-heading font-extrabold text-sm fill-black"
                      >
                        {slice.pct}%
                      </text>
                    )}
                  </g>
                );
              })
            )}
          </svg>
        </div>

        <Badge variant="neutral" className="mt-3 text-xs px-3 py-1 tabular-nums">
          Łącznie głosów: {total}
        </Badge>
      </div>

      {/* Legenda odpowiedzi */}
      <div className={cn('space-y-2.5', !compact && 'md:col-span-7')}>
        {items.map((item) => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
          const isLeader =
            total > 0 &&
            item.count === Math.max(...items.map((x) => x.count));

          return (
            <div
              key={item.idx}
              style={{ animationDelay: `${item.idx * 65}ms` }}
              className={cn(
                'flex items-center justify-between gap-3 rounded-base border-2 border-border p-3 animate-list-item',
                isLeader ? 'bg-secondary-background shadow-shadow' : 'bg-background'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={cn(
                    'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-base border-2 border-border font-heading text-base font-extrabold text-foreground',
                    item.opt.bgClass
                  )}
                >
                  {item.opt.label}
                </span>
                {item.image && (
                  <img
                    src={item.image}
                    alt={`Opcja ${item.opt.label}`}
                    className="h-10 w-10 flex-shrink-0 rounded-base border-2 border-border bg-secondary-background object-contain p-0.5"
                  />
                )}
                <span className="font-heading text-sm md:text-base font-bold truncate">
                  {item.label || (item.image ? `Zdjęcie ${item.opt.label}` : `Opcja ${item.opt.label}`)}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant={item.opt.badgeVariant} className="tabular-nums text-xs md:text-sm px-2.5 py-0.5">
                  {pct}%
                </Badge>
                <span className="font-heading text-xs md:text-sm font-bold tabular-nums text-foreground/80 min-w-[3rem] text-right">
                  {item.count} {item.count === 1 ? 'głos' : 'głosów'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

