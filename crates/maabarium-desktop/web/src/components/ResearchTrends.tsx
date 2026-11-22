import { Disclosure } from "./ui/Disclosure";
export type TrendDay = {
  day: string;
  completed: number;
  failed: number;
  input: number | null;
  output: number | null;
};

const shortDate = (date: string) => new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", timeZone: "UTC",
}).format(new Date(date + "T00:00:00Z"));
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

type Metric = { key: "completed" | "failed" | "input" | "output"; label: string; color: string };
const outcomes: [Metric, Metric] = [
  { key: "completed", label: "Completed", color: "var(--accent)" },
  { key: "failed", label: "Failed", color: "var(--danger)" },
];
const tokens: [Metric, Metric] = [
  { key: "input", label: "Input", color: "var(--accent)" },
  { key: "output", label: "Output", color: "var(--trend-secondary)" },
];

function TrendCard({ title, metrics, days }: { title: string; metrics: [Metric, Metric]; days: TrendDay[] }) {
  const max = Math.max(1, ...days.flatMap((day) => metrics.map(({ key }) => day[key] ?? 0)));
  const cell = 305 / days.length;
  return (
    <figure className="research-trend-card min-w-0 rounded-xl border p-3 sm:p-4">
      <figcaption className="font-semibold">{title}</figcaption>
      <div className="my-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {metrics.map(({ key, label, color }) => <span key={key} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
        </span>)}
      </div>
      <svg viewBox="0 0 350 118" className="w-full" aria-hidden="true">
        {[0, 1, 2].map((index) => {
          const y = 14 + index * 40;
          return <g key={index}>
            <line x1={34} x2={339} y1={y} y2={y} stroke="var(--line)" strokeDasharray={index === 2 ? undefined : "3 3"} />
            <text x={28} y={y + 3} textAnchor="end" fontSize="8" fill="var(--muted)">{compact.format(max * (1 - index / 2))}</text>
          </g>;
        })}
        {days.flatMap((day, index) => metrics.map(({ key, label, color }, series) => {
          const value = day[key];
          if (value === null || value === 0) return null;
          const height = value / max * 80;
          return <rect key={day.day + key} x={34 + index * cell + cell * (0.17 + series * 0.34)}
            y={94 - height} width={cell * 0.29} height={height} rx={Math.min(2.5, height / 2)} fill={color}>
            <title>{shortDate(day.day)} · {label}: {value.toLocaleString()}</title>
          </rect>;
        }))}
        {[...new Set([0, Math.floor(days.length / 2), days.length - 1])].map((index) =>
          <text key={index} x={34 + (index + 0.5) * cell} y={111} textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
            fontSize="8" fill="var(--muted)">{shortDate(days[index].day)}</text>)}
      </svg>
    </figure>
  );
}

export function ResearchTrends({ days }: { days: TrendDay[] }) {
  if (!days.length) return null;
  const hasOutcomes = days.some(({ completed, failed }) => completed || failed);
  const hasTokens = days.some(({ input, output }) => input !== null || output !== null);
  return <Disclosure className="mt-3" title="14-day trends">
    <p className="mb-3 mt-2 text-sm">Dates use UTC. Older jobs without a recorded date are only in the summary above. Blank spaces mean no token count was reported.</p>
    {!hasOutcomes && !hasTokens ? <p className="text-sm">New job results will appear here once they finish.</p> : <>
      <div className="grid gap-3 lg:grid-cols-2">
        {hasOutcomes && <TrendCard title="Job outcomes" metrics={outcomes} days={days} />}
        {hasTokens ? <TrendCard title="Reported token usage" metrics={tokens} days={days} /> : <p className="self-center text-sm">No token counters reported for this period.</p>}
      </div>
      <Disclosure className="mt-3" title="View daily values">
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-left text-xs tabular-nums">
            <caption className="sr-only">Daily research queue activity in UTC</caption>
            <thead><tr>{["Date", "Completed", "Failed", "Input", "Output"].map((label) => <th key={label} scope="col" className="p-1">{label}</th>)}</tr></thead>
            <tbody>{days.map((day) => <tr className="border-t" key={day.day}>
              <th scope="row" className="whitespace-nowrap p-1">{shortDate(day.day)}</th>
              <td className="p-1">{day.completed}</td><td className="p-1">{day.failed}</td>
              <td className="p-1">{day.input?.toLocaleString() ?? "Not reported"}</td>
              <td className="p-1">{day.output?.toLocaleString() ?? "Not reported"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </Disclosure>
    </>}
  </Disclosure>;
}
