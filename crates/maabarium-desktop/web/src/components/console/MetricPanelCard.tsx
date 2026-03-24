import { Suspense, lazy } from "react";
import { Activity } from "lucide-react";
import { RADAR_METRIC_COLORS } from "../../lib/chartPalette";
import { GlassCard } from "../ui/GlassCard";

const RadarChart = lazy(() =>
  import("../charts/RadarChart").then((module) => ({
    default: module.RadarChart,
  })),
);

export function MetricPanelCard({
  metricPanel,
}: {
  metricPanel: {
    title: string;
    subtitle: string;
    points: number[];
    labels: string[];
  };
}) {
  return (
    <GlassCard title={metricPanel.title} icon={Activity} className="h-full">
      <div className="flex h-full flex-col justify-between">
        <div>
          {metricPanel.points.length > 0 ? (
            <Suspense
              fallback={
                <div className="mx-auto h-44 w-full max-w-[18rem] animate-pulse rounded-full border border-white/10 bg-white/5" />
              }
            >
              <RadarChart
                values={metricPanel.points}
                labels={metricPanel.labels}
                pointColors={RADAR_METRIC_COLORS}
              />
            </Suspense>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
              No configured metrics available yet.
            </div>
          )}
        </div>
        <div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 text-center">
            {metricPanel.subtitle}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] uppercase font-black tracking-[0.14em] text-slate-500">
            {metricPanel.labels.map((label, index) => (
              <div key={label} className="flex items-center gap-1">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      RADAR_METRIC_COLORS[index % RADAR_METRIC_COLORS.length],
                  }}
                />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
