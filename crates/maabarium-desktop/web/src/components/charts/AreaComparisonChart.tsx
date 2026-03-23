import type { AnalyticsBucket } from "../../types/console";

export function AreaComparisonChart({
  buckets,
}: {
  buckets: AnalyticsBucket[];
}) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
        No persisted experiment or token data is available for this time window.
      </div>
    );
  }

  const experimentMax = Math.max(
    1,
    ...buckets.map((bucket) => bucket.experiments),
  );
  const tokenMax = Math.max(1, ...buckets.map((bucket) => bucket.tokenUsage));
  const width = 100;
  const height = 100;

  const buildPoints = (series: number[], max: number) =>
    series.map((value, index) => {
      const x =
        buckets.length === 1
          ? width / 2
          : (index / Math.max(buckets.length - 1, 1)) * width;
      const y = height - (value / max) * 78 - 8;
      return [x, y] as const;
    });

  const buildLinePath = (points: ReadonlyArray<readonly [number, number]>) =>
    points
      .map(
        ([x, y], index) =>
          `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`,
      )
      .join(" ");

  const buildAreaPath = (points: ReadonlyArray<readonly [number, number]>) => {
    const line = buildLinePath(points);
    const firstX = points[0]?.[0] ?? 0;
    const lastX = points[points.length - 1]?.[0] ?? width;
    return `${line} L${lastX.toFixed(2)},${height} L${firstX.toFixed(2)},${height} Z`;
  };

  const experimentPoints = buildPoints(
    buckets.map((bucket) => bucket.experiments),
    experimentMax,
  );
  const tokenPoints = buildPoints(
    buckets.map((bucket) => bucket.tokenUsage),
    tokenMax,
  );

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4">
      <svg viewBox="0 0 100 100" className="h-56 w-full overflow-visible">
        <defs>
          <linearGradient
            id="analytics-experiments-fill"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient
            id="analytics-tokens-fill"
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[20, 40, 60, 80].map((line) => (
          <line
            key={line}
            x1="0"
            y1={line}
            x2="100"
            y2={line}
            stroke="rgba(148,163,184,0.16)"
            strokeDasharray="2 3"
            strokeWidth="0.6"
          />
        ))}
        <path
          d={buildAreaPath(tokenPoints)}
          fill="url(#analytics-tokens-fill)"
        />
        <path
          d={buildAreaPath(experimentPoints)}
          fill="url(#analytics-experiments-fill)"
        />
        <path
          d={buildLinePath(tokenPoints)}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={buildLinePath(experimentPoints)}
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {experimentPoints.map(([x, y], index) => (
          <circle key={`exp-${index}`} cx={x} cy={y} r="1.4" fill="#2dd4bf" />
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 sm:grid-cols-7">
        {buckets.map((bucket) => (
          <div key={bucket.label} className="truncate text-center">
            {bucket.label}
          </div>
        ))}
      </div>
    </div>
  );
}
