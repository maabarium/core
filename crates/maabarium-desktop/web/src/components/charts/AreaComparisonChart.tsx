import { type ChartData, type ChartOptions, type TooltipItem } from "chart.js";
import { Line } from "react-chartjs-2";
import "../../lib/chartjs";
import { formatCountLabel, formatTokenUsage } from "../../lib/formatters";
import type { AnalyticsBucket } from "../../types/console";

export function AreaComparisonChart({
  buckets,
  jobs,
}: {
  buckets?: AnalyticsBucket[];
  jobs?: { label: string; completed: number; tokens: number | null }[];
}) {
  const rows = jobs?.map(job => ({ label: job.label, experiments: job.completed, tokenUsage: job.tokens })) ?? buckets ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
        No persisted experiment or token data is available for this time window.
      </div>
    );
  }

  const data: ChartData<"line"> = {
    labels: rows.map((bucket) => bucket.label),
    datasets: [
      {
        label: jobs ? "Completed jobs (cumulative)" : "Experiments",
        data: rows.map((bucket) => bucket.experiments),
        yAxisID: "experiments",
        borderColor: "#2dd4bf",
        backgroundColor: "rgba(45, 212, 191, 0.18)",
        pointBackgroundColor: "#2dd4bf",
        pointBorderColor: "#0f172a",
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        tension: 0.34,
        fill: true,
      },
      {
        label: "Tokens",
        data: rows.map((bucket) => bucket.tokenUsage),
        yAxisID: "tokens",
        borderColor: "#fbbf24",
        backgroundColor: "rgba(251, 191, 36, 0.12)",
        pointBackgroundColor: "#fbbf24",
        pointBorderColor: "#0f172a",
        pointBorderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 4.5,
        borderWidth: 2,
        tension: 0.34,
        fill: true,
      },
    ],
  };

  // Read the active theme so axis text keeps its contrast in light and dark.
  const themeRoot = typeof document === "undefined" ? null : document.querySelector(".maabarium-app");
  const muted = (themeRoot && getComputedStyle(themeRoot).getPropertyValue("--muted").trim()) || "#94a3b8";
  const countLabel = jobs ? "Completed jobs" : "Experiments";
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    layout: {
      padding: {
        top: 8,
        left: 8,
        right: 8,
        bottom: 0,
      },
    },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: {
          color: muted,
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          boxHeight: 8,
          padding: 18,
          font: {
            size: 12,
            weight: 600,
          },
        },
      },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.94)",
        borderColor: "rgba(148, 163, 184, 0.16)",
        borderWidth: 1,
        titleColor: "#e2e8f0",
        bodyColor: "#cbd5e1",
        padding: 12,
        displayColors: true,
        callbacks: {
          title(items) {
            return items[0]?.label ?? "";
          },
          label(context: TooltipItem<"line">) {
            const bucket = rows[context.dataIndex];
            if (!bucket) {
              return context.dataset.label ?? "";
            }

            if (context.dataset.yAxisID === "experiments") {
              return formatCountLabel(bucket.experiments, jobs ? "completed job" : "experiment");
            }

            return bucket.tokenUsage == null ? "Tokens not reported" : `${formatTokenUsage(bucket.tokenUsage)} tokens`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: muted,
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          padding: 10,
          font: {
            size: 10,
            weight: 700,
          },
        },
        border: {
          display: false,
        },
      },
      experiments: {
        position: "left",
        beginAtZero: true,
        grace: "12%",
        title: { display: true, text: countLabel, color: muted, font: { size: 11, weight: 600 } },
        ticks: {
          color: muted,
          precision: 0,
          maxTicksLimit: 6,
          font: { size: 11 },
        },
        grid: {
          color: "rgba(148, 163, 184, 0.16)",
          drawTicks: false,
        },
        border: {
          display: false,
        },
      },
      tokens: {
        position: "right",
        beginAtZero: true,
        grace: "12%",
        title: { display: true, text: "Tokens", color: muted, font: { size: 11, weight: 600 } },
        ticks: {
          color: muted,
          maxTicksLimit: 6,
          font: { size: 11 },
          callback: (value) => formatTokenUsage(Number(value)),
        },
        grid: {
          display: false,
          drawTicks: false,
        },
        border: {
          display: false,
        },
      },
    },
    elements: {
      line: {
        capBezierPoints: true,
      },
    },
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4">
      <div className="h-72 w-full">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
