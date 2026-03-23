import { Flame } from "lucide-react";
import {
  formatTelemetryPercent,
  formatTelemetryTemperature,
  formatTelemetryTimestamp,
  telemetryBadgeColor,
} from "../../lib/formatters";
import type { HardwareTelemetry } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

export function HardwareHeatCard({
  hardwareTelemetry,
}: {
  hardwareTelemetry: HardwareTelemetry | null;
}) {
  return (
    <GlassCard title="Hardware Heat" icon={Flame} className="h-full">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="grid grid-cols-1 gap-3">
          {[
            { label: "GPU", sensor: hardwareTelemetry?.gpu ?? null },
            { label: "NPU", sensor: hardwareTelemetry?.npu ?? null },
          ].map(({ label, sensor }) => {
            const utilization = sensor?.utilizationPercent ?? null;

            return (
              <div
                key={label}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      {label}
                    </div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-white">
                      {formatTelemetryPercent(utilization)}
                    </div>
                  </div>
                  <Badge
                    color={telemetryBadgeColor(sensor?.status ?? "unavailable")}
                  >
                    {sensor?.status ?? "unavailable"}
                  </Badge>
                </div>

                <div className="mt-3 h-2 rounded-full bg-slate-900/80 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${utilization !== null ? "bg-gradient-to-r from-teal-400 to-amber-400" : "bg-slate-700"}`}
                    style={{
                      width:
                        utilization !== null
                          ? `${Math.max(4, Math.min(utilization, 100))}%`
                          : "18%",
                    }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                  <span>
                    Temp{" "}
                    {formatTelemetryTemperature(
                      sensor?.temperatureCelsius ?? null,
                    )}
                  </span>
                  <span>
                    {sensor?.logicalCores
                      ? `${sensor.logicalCores} logical cores`
                      : "No core map"}
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {sensor?.statusDetail ??
                    "Telemetry is unavailable for this device."}
                </p>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-teal-500/10 bg-slate-950/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            <span>
              Sampled{" "}
              {formatTelemetryTimestamp(
                hardwareTelemetry?.sampledAtEpochMs ?? 0,
              )}
            </span>
            <span>•</span>
            <span>{hardwareTelemetry?.platform ?? "unknown platform"}</span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-slate-400">
            {(hardwareTelemetry?.notes.length
              ? hardwareTelemetry.notes
              : [
                  "Persisted experiment scores, timings, proposal diffs, and inferred token usage remain available even when sensor data is partial.",
                ]
            ).map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
