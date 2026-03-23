import { Activity } from "lucide-react";
import { RadarChart } from "../charts/RadarChart";
import { GlassCard } from "../ui/GlassCard";

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
            <RadarChart values={metricPanel.points} />
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
            {metricPanel.labels.map((label) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
