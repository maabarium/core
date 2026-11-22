import { open } from "@tauri-apps/plugin-dialog";
import { Layers, Play, Square, Trash2, Plus, Bell, BellOff, Clock, ArrowRight, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AvailableBlueprint,
  RunGroup,
  GroupRunWithExperiments,
  GroupRunExperiment,
  PersistedExperiment,
  TelegramConfig,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

function statusColor(
  status: GroupRunExperiment["status"],
): "teal" | "amber" | "slate" | "rose" {
  switch (status) {
    case "completed":
      return "teal";
    case "running":
      return "amber";
    case "failed":
      return "rose";
    case "pending":
    case "skipped":
      return "slate";
  }
}

function statusLabel(status: GroupRunExperiment["status"]): string {
  switch (status) {
    case "completed":
      return "\u2714 Completed";
    case "running":
      return "\u25C9 Running";
    case "failed":
      return "\u26A0 Failed";
    case "pending":
      return "\u25CB Pending";
    case "skipped":
      return "\u2298 Skipped";
  }
}

function describeSchedule(group: RunGroup): string {
  if (!group.schedule || !group.schedule.enabled) {
    return "Manual only";
  }
  const kind = group.schedule.kind;
  if (kind.type === "cron") {
    const parts = kind.expression.split(/\s+/);
    if (parts.length === 5) {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
      if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return `Every day at ${time}`;
      }
      if (dayOfMonth === "*" && month === "*") {
        const days: Record<string, string> = {
          "0": "Sunday",
          "1": "Monday",
          "2": "Tuesday",
          "3": "Wednesday",
          "4": "Thursday",
          "5": "Friday",
          "6": "Saturday",
          "7": "Sunday",
        };
        return `Every ${days[dayOfWeek] ?? "week"} at ${time}`;
      }
    }
    return "Scheduled";
  }
  if (kind.type === "one_shot") {
    const dt = new Date(kind.datetime);
    return `Scheduled: ${dt.toLocaleString()}`;
  }
  return "Manual only";
}

type ScheduleMode = "none" | "once" | "daily" | "weekly";

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function nextRoundedDateTimeLocal(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30);
  date.setSeconds(0, 0);
  return toDateTimeLocalValue(date);
}

function buildSchedulePayload(
  mode: ScheduleMode,
  localDateTime: string,
  localTime: string,
): {
  scheduleType: "none" | "cron" | "one_shot";
  value: string | null;
  enabled: boolean;
} | null {
  if (mode === "none") {
    return { scheduleType: "none", value: null, enabled: false };
  }

  if (mode === "daily") {
    const [hours, minutes] = localTime.split(":").map(Number);
    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return {
      scheduleType: "cron",
      value: `${date.getUTCMinutes()} ${date.getUTCHours()} * * *`,
      enabled: true,
    };
  }

  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (mode === "once") {
    return {
      scheduleType: "one_shot",
      value: date.toISOString(),
      enabled: true,
    };
  }

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  return {
    scheduleType: "cron",
    value: `${minute} ${hour} * * ${date.getUTCDay()}`,
    enabled: true,
  };
}

function blueprintNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? "blueprint";
  return fileName.replace(/\.toml$/i, "") || "blueprint";
}

function latestActiveRun(
  runs: GroupRunWithExperiments[],
): GroupRunWithExperiments | null {
  const activeRuns = runs.filter(
    (run) => run.status === "pending" || run.status === "running",
  );
  if (activeRuns.length === 0) {
    return null;
  }
  return activeRuns.sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  })[0];
}

function runProgress(run: GroupRunWithExperiments | null): {
  completed: number;
  total: number;
  percentage: number;
  currentLabel: string;
} {
  if (!run || run.experiments.length === 0) {
    return {
      completed: 0,
      total: 0,
      percentage: 0,
      currentLabel: "Starting workflows",
    };
  }

  const finishedStatuses: GroupRunExperiment["status"][] = [
    "completed",
    "failed",
    "skipped",
  ];
  const completed = run.experiments.filter((experiment) =>
    finishedStatuses.includes(experiment.status),
  ).length;
  const running = run.experiments.find(
    (experiment) => experiment.status === "running",
  );
  const pending = run.experiments.find(
    (experiment) => experiment.status === "pending",
  );
  const total = run.experiments.length;
  const percentage = Math.max(
    run.status === "running" ? 8 : 0,
    Math.round((completed / total) * 100),
  );

  return {
    completed,
    total,
    percentage,
    currentLabel:
      running?.blueprintName ??
      pending?.blueprintName ??
      `${completed} of ${total} workflows`,
  };
}

function ExperimentRow({
  exp,
  experimentMap,
}: {
  exp: GroupRunExperiment;
  experimentMap: Map<number, PersistedExperiment>;
}) {
  const [expanded, setExpanded] = useState(false);
  const persisted = exp.experimentId != null ? experimentMap.get(exp.experimentId) : null;

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-white/5"
      >
        <Badge color={statusColor(exp.status)}>{statusLabel(exp.status)}</Badge>
        <span className="flex-1 font-medium">{exp.blueprintName}</span>
        {persisted && (
          <span className="text-white/50 text-xs">
            score={persisted.weighted_total.toFixed(3)}
          </span>
        )}
        <ArrowRight
          size={14}
          className={`text-white/30 transition ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && persisted && (
        <div className="space-y-1 px-5 pb-3 text-xs text-white/60">
          <div className="grid grid-cols-2 gap-2">
            <span>Duration: {persisted.duration_ms}ms</span>
            <span>Outcome: {persisted.promotion_outcome}</span>
            {persisted.promoted_branch_name && (
              <span className="col-span-2 truncate" title={persisted.promoted_branch_name}>
                Branch: {persisted.promoted_branch_name}
              </span>
            )}
            {persisted.promoted_commit_oid && (
              <span className="col-span-2 truncate" title={persisted.promoted_commit_oid}>
                Commit: {persisted.promoted_commit_oid}
              </span>
            )}
          </div>
          {persisted.metrics.length > 0 && (
            <div className="border-t border-white/10 pt-1 mt-1">
              <div className="font-medium mb-1">Metrics:</div>
              {persisted.metrics.map((m, i) => (
                <div key={i} className="flex justify-between">
                  <span>{m.name}</span>
                  <span>
                    {m.value.toFixed(3)} (w={m.weight})
                  </span>
                </div>
              ))}
            </div>
          )}
          {persisted.proposal_summary && (
            <div className="border-t border-white/10 pt-1 mt-1 italic">
              &ldquo;{persisted.proposal_summary}&rdquo;
            </div>
          )}
        </div>
      )}
      {expanded && !persisted && exp.error && (
        <div className="px-5 pb-3 text-xs text-rose-400">Error: {exp.error}</div>
      )}
    </div>
  );
}

function GroupRunHistory({
  runs,
  experimentMap,
}: {
  runs: GroupRunWithExperiments[];
  experimentMap: Map<number, PersistedExperiment>;
}) {
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  if (runs.length === 0) {
    return <p className="px-3 py-4 text-sm text-white/40 italic">No runs yet.</p>;
  }

  return (
    <div>
      {runs.slice(0, 5).map((run) => (
        <div key={run.id} className="border-b border-white/5 last:border-b-0">
          <button
            onClick={() =>
              setExpandedRun(expandedRun === run.id ? null : run.id)
            }
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-white/5"
          >
            <Badge
              color={
                run.status === "completed"
                  ? "teal"
                  : run.status === "failed"
                    ? "rose"
                    : "amber"
              }
            >
              {run.status}
            </Badge>
            <span className="flex-1 font-medium">
              Run {run.id.slice(0, 8)}
            </span>
            {run.summary && (
              <span className="text-white/50 text-xs truncate max-w-[200px]">
                {run.summary}
              </span>
            )}
            <ArrowRight
              size={14}
              className={`text-white/30 transition ${expandedRun === run.id ? "rotate-90" : ""}`}
            />
          </button>
          {expandedRun === run.id && (
            <div className="border-t border-white/5">
              {run.experiments.map((exp) => (
                <ExperimentRow
                  key={exp.id}
                  exp={exp}
                  experimentMap={experimentMap}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function GroupRunPanel({
  groups,
  groupRuns,
  experiments,
  telegramConfig,
  availableBlueprints,
  onCreateGroup,
  onAddBlueprint,
  onRunGroup,
  onStopGroup,
  onDeleteGroup,
  onSetSchedule,
  defaultBlueprintName,
  defaultBlueprintPath,
  collapsed = false,
  onToggleCollapsed,
}: {
  groups: RunGroup[];
  groupRuns: GroupRunWithExperiments[];
  experiments: PersistedExperiment[];
  telegramConfig: TelegramConfig | null;
  availableBlueprints: AvailableBlueprint[];
  onCreateGroup: (name: string, description: string) => void;
  onAddBlueprint: (groupName: string, blueprintName: string, blueprintPath: string) => void;
  onRunGroup: (groupName: string, mode?: string | null) => void;
  onStopGroup: (groupName: string) => void;
  onDeleteGroup: (groupName: string) => void;
  onSetSchedule: (
    groupName: string,
    scheduleType: "none" | "cron" | "one_shot",
    value: string | null,
    enabled: boolean,
  ) => void;
  defaultBlueprintName: string;
  defaultBlueprintPath: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [blueprintName, setBlueprintName] = useState(defaultBlueprintName);
  const [blueprintPath, setBlueprintPath] = useState(defaultBlueprintPath);
  const [schedulingGroup, setSchedulingGroup] = useState<string | null>(null);
  const [optimisticRunningGroups, setOptimisticRunningGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("once");
  const [scheduleDateTime, setScheduleDateTime] = useState(() =>
    nextRoundedDateTimeLocal(),
  );
  const [scheduleTime, setScheduleTime] = useState(() =>
    nextRoundedDateTimeLocal().slice(11),
  );
  const experimentMap = new Map(
    experiments.map((e) => [e.id, e]),
  );
  const inputClass =
    "h-9 w-full rounded-md border border-white/10 bg-slate-950/80 px-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-teal-400/50 [color-scheme:dark]";
  const smallButtonClass =
    "rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white";
  const chooseBlueprintFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Blueprint TOML", extensions: ["toml"] }],
    });
    if (typeof selected === "string") {
      setBlueprintPath(selected);
      setBlueprintName(blueprintNameFromPath(selected));
    }
  };
  const activeGroupNames = useMemo(
    () =>
      new Set(
        groupRuns
          .filter((run) => run.status === "pending" || run.status === "running")
          .map((run) => run.groupName),
      ),
    [groupRuns],
  );

  useEffect(() => {
    if (optimisticRunningGroups.size === 0) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setOptimisticRunningGroups((current) => {
        const next = new Set(current);
        for (const name of current) {
          if (!activeGroupNames.has(name)) {
            next.delete(name);
          }
        }
        return next;
      });
    }, 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [optimisticRunningGroups, activeGroupNames]);

  return (
    <GlassCard
      title="Workflow groups"
      icon={Layers}
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      headerActions={
        <button
          type="button"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
          className="flex items-center gap-1 rounded-md bg-teal-600/20 px-2 py-1 text-xs font-medium text-teal-300 transition hover:bg-teal-600/30"
        >
          <Plus size={12} />
          New Group
        </button>
      }
    >
      {creating && (
        <form
          className="mb-3 space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newGroupName.trim();
            if (!name) {
              return;
            }
            onCreateGroup(name, newGroupDescription.trim());
            setNewGroupName("");
            setNewGroupDescription("");
            setCreating(false);
            setExpandedGroup(name);
          }}
        >
          <input
            className={inputClass}
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
            autoFocus
          />
          <input
            className={inputClass}
            value={newGroupDescription}
            onChange={(e) => setNewGroupDescription(e.target.value)}
            placeholder="Description"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={smallButtonClass} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-teal-600/30 px-2 py-1 text-xs font-medium text-teal-200 transition hover:bg-teal-600/40"
            >
              Create
            </button>
          </div>
        </form>
      )}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-white/40">
          <Layers size={32} className="opacity-30" />
          <p className="text-sm">No workflow run groups yet.</p>
          <p className="text-xs">
            Create a group to run multiple blueprints together.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {groups.map((group) => {
            const isExpanded = expandedGroup === group.name;
            const runs = groupRuns.filter(
              (r) => r.groupName === group.name,
            );
            const activeRun = latestActiveRun(runs);
            const progress = runProgress(activeRun);
            const isRunning =
              activeGroupNames.has(group.name) ||
              optimisticRunningGroups.has(group.name);

            return (
              <div key={group.name}>
                <div className="flex w-full items-center gap-3 px-3 py-3 transition hover:bg-white/5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedGroup(isExpanded ? null : group.name)
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Layers size={16} className="text-teal-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {group.name}
                        </span>
                        <Badge
                          color={
                            group.executionMode === "parallel"
                              ? "amber"
                              : "slate"
                          }
                        >
                          {group.executionMode}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-white/40">
                        <span>
                          {group.blueprints.length} blueprint
                          {group.blueprints.length !== 1 ? "s" : ""}
                        </span>
                        <span>&middot;</span>
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {describeSchedule(group)}
                        </span>
                        <span>&middot;</span>
                        {group.telegramEnabled ? (
                          <span className="flex items-center gap-1 text-teal-400">
                            <Bell size={10} /> Notifications on
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-white/30">
                            <BellOff size={10} /> Notifications off
                          </span>
                        )}
                      </div>
                      {isRunning && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-[0.12em] text-teal-300/80">
                            <span className="truncate">
                              {progress.currentLabel}
                            </span>
                            {progress.total > 0 && (
                              <span className="shrink-0 text-white/35">
                                {progress.completed}/{progress.total}
                              </span>
                            )}
                          </div>
                          <div
                            className="h-1.5 overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/10"
                            role="progressbar"
                            aria-label={`${group.name} progress`}
                            aria-valuemin={0}
                            aria-valuemax={progress.total || undefined}
                            aria-valuenow={
                              progress.total ? progress.completed : undefined
                            }
                          >
                            {progress.total > 0 ? (
                              <div
                                className="h-full rounded-full bg-teal-400 transition-all duration-500"
                                style={{ width: `${progress.percentage}%` }}
                              />
                            ) : (
                              <div className="h-full w-1/3 animate-pulse rounded-full bg-teal-400/70" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <ArrowRight
                      size={14}
                      className={`text-white/30 transition ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddingToGroup(addingToGroup === group.name ? null : group.name);
                        setExpandedGroup(group.name);
                        setBlueprintName(defaultBlueprintName);
                        setBlueprintPath(defaultBlueprintPath);
                      }}
                      className="rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
                      title="Add blueprint"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSchedulingGroup(schedulingGroup === group.name ? null : group.name);
                        setExpandedGroup(group.name);
                        setScheduleMode(group.schedule?.enabled ? "once" : "once");
                        const nextDateTime = nextRoundedDateTimeLocal();
                        setScheduleDateTime(nextDateTime);
                        setScheduleTime(nextDateTime.slice(11));
                      }}
                      className="rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
                      title="Set schedule"
                    >
                      <Clock size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRunning) {
                          setOptimisticRunningGroups((current) => {
                            const next = new Set(current);
                            next.delete(group.name);
                            return next;
                          });
                          onStopGroup(group.name);
                        } else {
                          setOptimisticRunningGroups((current) => {
                            const next = new Set(current);
                            next.add(group.name);
                            return next;
                          });
                          onRunGroup(
                            group.name,
                            group.executionMode === "parallel"
                              ? "parallel"
                              : null,
                          );
                        }
                      }}
                      className={`rounded p-1 transition ${
                        isRunning
                          ? "text-rose-400 hover:bg-rose-600/20"
                          : "text-teal-400 hover:bg-teal-600/20"
                      }`}
                      title={isRunning ? "Stop group" : "Run group"}
                    >
                      {isRunning ? (
                        <Square size={14} fill="currentColor" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(group.name);
                      }}
                      className="rounded p-1 text-white/40 transition hover:bg-rose-600/20 hover:text-rose-400"
                      title="Delete group"
                      aria-label={`Delete group ${group.name}`}
                      disabled={isRunning}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {confirmDelete === group.name && (
                  <div role="group" aria-label={`Confirm deletion of ${group.name}`}
                    className="mx-4 my-3 flex flex-wrap items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-xs">
                    <span className="mr-auto text-rose-100">Delete “{group.name}”, its schedule and group run history?</span>
                    <button type="button" className={smallButtonClass} onClick={() => setConfirmDelete(null)}>Cancel</button>
                    <button type="button" disabled={isRunning} className="rounded-md bg-rose-300 px-2 py-1 font-semibold text-slate-950 disabled:opacity-50"
                      onClick={() => { setConfirmDelete(null); onDeleteGroup(group.name); }}>Delete group</button>
                  </div>
                )}
                {isExpanded && (
                  <div className="border-t border-white/5">
                    {addingToGroup === group.name && (
                      <form
                        className="mx-5 my-3 space-y-2 rounded-lg border border-white/10 bg-slate-950/50 p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!blueprintName.trim() || !blueprintPath.trim()) {
                            return;
                          }
                          onAddBlueprint(
                            group.name,
                            blueprintName.trim(),
                            blueprintPath.trim(),
                          );
                          setAddingToGroup(null);
                        }}
                      >
                        <label className="space-y-1">
                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                            Existing blueprint
                          </span>
                          <select
                            className={inputClass}
                            value=""
                            onChange={(e) => {
                              const selected = availableBlueprints.find(
                                (blueprint) => blueprint.path === e.target.value,
                              );
                              if (selected) {
                                setBlueprintName(selected.displayName);
                                setBlueprintPath(selected.path);
                              }
                            }}
                          >
                            <option value="">Choose from workflow library...</option>
                            {availableBlueprints.map((blueprint) => (
                              <option key={blueprint.path} value={blueprint.path}>
                                {blueprint.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <input
                          className={inputClass}
                          value={blueprintName}
                          onChange={(e) => setBlueprintName(e.target.value)}
                          placeholder="Blueprint name"
                        />
                        <input
                          className={inputClass}
                          value={blueprintPath}
                          onChange={(e) => setBlueprintPath(e.target.value)}
                          placeholder="Blueprint path"
                        />
                        <div className="flex justify-between gap-2">
                          <button
                            type="button"
                            className={smallButtonClass}
                            onClick={() => void chooseBlueprintFile()}
                          >
                            <FolderOpen size={12} className="inline-block" /> Pick TOML
                          </button>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" className={smallButtonClass} onClick={() => setAddingToGroup(null)}>
                            Cancel
                          </button>
                          <button type="submit" className="rounded-md bg-teal-600/30 px-2 py-1 text-xs font-medium text-teal-200 transition hover:bg-teal-600/40">
                            Add
                          </button>
                        </div>
                      </form>
                    )}
                    {schedulingGroup === group.name && (
                      <form
                        className="mx-5 my-3 space-y-2 rounded-lg border border-white/10 bg-slate-950/50 p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const payload = buildSchedulePayload(
                            scheduleMode,
                            scheduleDateTime,
                            scheduleTime,
                          );
                          if (payload) {
                            onSetSchedule(
                              group.name,
                              payload.scheduleType,
                              payload.value,
                              payload.enabled,
                            );
                            setSchedulingGroup(null);
                          }
                        }}
                      >
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(10rem,14rem)_1fr]">
                          <label className="space-y-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Schedule
                            </span>
                            <select
                              className={inputClass}
                              value={scheduleMode}
                              onChange={(e) =>
                                setScheduleMode(e.target.value as ScheduleMode)
                              }
                            >
                              <option value="once">Run once</option>
                              <option value="daily">Every day</option>
                              <option value="weekly">Every week</option>
                              <option value="none">Manual only</option>
                            </select>
                          </label>
                          {scheduleMode !== "none" && (
                            <label className="space-y-1">
                              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                {scheduleMode === "once"
                                  ? "Run at"
                                  : scheduleMode === "daily"
                                    ? "Run time"
                                    : "Day and time"}
                              </span>
                              <input
                                className={inputClass}
                                type={
                                  scheduleMode === "daily"
                                    ? "time"
                                    : "datetime-local"
                                }
                                value={
                                  scheduleMode === "daily"
                                    ? scheduleTime
                                    : scheduleDateTime
                                }
                                onChange={(e) => {
                                  if (scheduleMode === "daily") {
                                    setScheduleTime(e.target.value);
                                  } else {
                                    setScheduleDateTime(e.target.value);
                                  }
                                }}
                              />
                            </label>
                          )}
                        </div>
                        {scheduleMode !== "none" && (
                          <p className="text-xs leading-relaxed text-slate-500">
                            Times use your local timezone. Recurring schedules
                            are saved in the app's scheduler format.
                          </p>
                        )}
                        <div className="flex justify-end gap-2">
                          <button type="button" className={smallButtonClass} onClick={() => setSchedulingGroup(null)}>
                            Cancel
                          </button>
                          <button type="submit" className="rounded-md bg-teal-600/30 px-2 py-1 text-xs font-medium text-teal-200 transition hover:bg-teal-600/40">
                            Save
                          </button>
                        </div>
                      </form>
                    )}
                    {/* Blueprint list */}
                    {group.blueprints.length > 0 && (
                      <div className="px-5 py-2 space-y-1">
                        <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                          Blueprints
                        </span>
                        {group.blueprints.map((bp) => (
                          <div
                            key={bp.blueprintName}
                            className="flex items-center gap-2 text-xs text-white/60"
                          >
                            <span className="w-4 text-right text-white/30">
                              {bp.sortOrder + 1}.
                            </span>
                            <span>{bp.blueprintName}</span>
                            <span className="text-white/30 truncate">
                              {bp.blueprintPath}
                            </span>
                            {!bp.notificationsEnabled && (
                              <BellOff size={10} className="text-white/30" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Run history */}
                    <div className="border-t border-white/5">
                      <span className="block px-5 pt-2 pb-1 text-xs font-medium text-white/40 uppercase tracking-wider">
                        Run History
                      </span>
                      <GroupRunHistory
                        runs={runs}
                        experimentMap={experimentMap}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Telegram status footer */}
      <div className="border-t border-white/5 px-3 py-2 flex items-center gap-2 text-xs text-white/40">
        {telegramConfig && telegramConfig.enabled ? (
          <>
            <Bell size={12} className="text-teal-400" />
            <span>
              Telegram notifications active
              {telegramConfig.notifyOnStart && " \u00b7 start"}
              {telegramConfig.notifyOnComplete && " \u00b7 complete"}
              {telegramConfig.notifyOnError && " \u00b7 errors"}
              {telegramConfig.notifyOnPromotion && " \u00b7 promotions"}
            </span>
          </>
        ) : (
          <>
            <BellOff size={12} />
            <span>Telegram not configured</span>
          </>
        )}
      </div>
    </GlassCard>
  );
}
