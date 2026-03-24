import { type ChartData, type ChartOptions } from "chart.js";
import { Radar } from "react-chartjs-2";
import "../../lib/chartjs";
import { RADAR_METRIC_COLORS } from "../../lib/chartPalette";

export function RadarChart({
  values,
  labels,
  pointColors = RADAR_METRIC_COLORS,
}: {
  values: number[];
  labels: string[];
  pointColors?: readonly string[];
}) {
  const normalizedLabels = values.map(
    (_, index) => labels[index] ?? `Metric ${index + 1}`,
  );
  const data: ChartData<"radar"> = {
    labels: normalizedLabels,
    datasets: [
      {
        label: "Metrics",
        data: values,
        borderColor: "rgba(94, 234, 212, 0.95)",
        backgroundColor: "rgba(45, 212, 191, 0.16)",
        pointBackgroundColor: values.map(
          (_, index) =>
            pointColors[index % pointColors.length] ?? RADAR_METRIC_COLORS[0],
        ),
        pointBorderColor: "#020617",
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 4.5,
        borderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<"radar"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.94)",
        borderColor: "rgba(148, 163, 184, 0.16)",
        borderWidth: 1,
        titleColor: "#e2e8f0",
        bodyColor: "#cbd5e1",
        padding: 10,
      },
    },
    scales: {
      r: {
        beginAtZero: true,
        min: 0,
        max: 1,
        angleLines: {
          color: "rgba(148, 163, 184, 0.16)",
        },
        grid: {
          color: "rgba(148, 163, 184, 0.16)",
        },
        pointLabels: {
          display: false,
        },
        ticks: {
          display: false,
          stepSize: 0.25,
        },
      },
    },
  };

  return (
    <div className="mx-auto h-44 w-full max-w-[18rem]">
      <Radar data={data} options={options} />
    </div>
  );
}
