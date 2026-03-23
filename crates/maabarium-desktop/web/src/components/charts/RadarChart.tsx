export function RadarChart({ values }: { values: number[] }) {
  const axisCount = Math.max(values.length, 3);
  const points = values
    .map((value, index) => {
      const angle = (Math.PI * 2 * index) / axisCount - Math.PI / 2;
      const x = 50 + Math.cos(angle) * 40 * value;
      const y = 50 + Math.sin(angle) * 40 * value;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full opacity-40">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
        <circle
          cx="50"
          cy="50"
          r="25"
          fill="none"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
        <path
          d="M50 10 L50 90 M10 50 L90 50"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
      </svg>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient
            id="desktop-radar-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
        <polygon
          points={points}
          fill="url(#desktop-radar-gradient)"
          fillOpacity="0.22"
          stroke="url(#desktop-radar-gradient)"
          strokeWidth="1.5"
        />
        {points.split(" ").map((point, index) => {
          const [x, y] = point.split(",");
          return <circle key={index} cx={x} cy={y} r="1.8" fill="#2dd4bf" />;
        })}
      </svg>
    </div>
  );
}
