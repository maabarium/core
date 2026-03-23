export function MiniSparkline({
  data,
  color = "#2dd4bf",
}: {
  data: number[];
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="w-16 h-8 rounded-md border border-dashed border-white/10 text-[8px] font-bold uppercase tracking-widest text-slate-600 flex items-center justify-center">
        No data
      </div>
    );
  }

  const points = data
    .map(
      (value, index) =>
        `${(index / Math.max(data.length - 1, 1)) * 100},${100 - value}`,
    )
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" className="w-16 h-8 overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="drop-shadow-[0_0_8px_rgba(45,212,191,0.28)]"
      />
    </svg>
  );
}
