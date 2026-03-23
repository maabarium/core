import type { HardwareSensorStatus, ResearchSource } from "../types/console";

export function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${durationMs}ms`;
}

export function formatTokenUsage(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return `${tokens}`;
}

export function telemetryBadgeColor(
  status: HardwareSensorStatus,
): "blue" | "emerald" | "rose" {
  if (status === "live") {
    return "emerald";
  }
  if (status === "partial") {
    return "blue";
  }
  return "rose";
}

export function formatTelemetryPercent(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

export function formatTelemetryTemperature(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}°C`;
}

export function formatTelemetryTimestamp(epochMs: number): string {
  if (!epochMs) {
    return "Awaiting sample";
  }

  return new Date(epochMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatSourceHost(source: ResearchSource): string {
  return source.host || source.finalUrl || source.url;
}

export function formatExperimentTimestamp(timestamp: string): string {
  if (!timestamp) {
    return "Unknown time";
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }

  return value.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
