import { Download, RefreshCw } from "lucide-react";
import { formatExperimentTimestamp } from "../../lib/formatters";
import type {
  DesktopSetupState,
  UpdateCheckResult,
  UpdaterConfigurationState,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

const UPDATE_CHANNEL_OPTIONS = ["stable", "beta"] as const;

export function UpdatesCard({
  updater,
  desktopSetup,
  updateCheck,
  checkingForUpdates,
  installingUpdate,
  savingPreferences,
  onCheckForUpdates,
  onInstallUpdate,
  onSelectChannel,
  onRemindLater,
  onClearReminder,
}: {
  updater: UpdaterConfigurationState | null | undefined;
  desktopSetup: DesktopSetupState | null | undefined;
  updateCheck: UpdateCheckResult | null;
  checkingForUpdates: boolean;
  installingUpdate: boolean;
  savingPreferences: boolean;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onSelectChannel: (channel: string) => void;
  onRemindLater: () => void;
  onClearReminder: () => void;
}) {
  const selectedChannel =
    desktopSetup?.preferredUpdateChannel ?? updater?.channel ?? "stable";
  const activeReminder =
    updateCheck?.available &&
    updateCheck.version &&
    desktopSetup?.remindLaterVersion === updateCheck.version &&
    desktopSetup.remindLaterUntil &&
    new Date(desktopSetup.remindLaterUntil).getTime() > Date.now()
      ? desktopSetup.remindLaterUntil
      : null;

  return (
    <GlassCard title="Updates" icon={RefreshCw}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-100">
              v{updater?.currentVersion ?? "0.0.0"}
            </div>
            <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              {updater?.channel ?? "stable"} channel
            </div>
          </div>
          <Badge color={updater?.configured ? "emerald" : "rose"}>
            {updater?.configured ? "Ready" : "Not Configured"}
          </Badge>
        </div>

        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Channel
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {UPDATE_CHANNEL_OPTIONS.map((channel) => {
              const selected = selectedChannel === channel;
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => onSelectChannel(channel)}
                  disabled={savingPreferences}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"} disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {channel}
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Saved locally and applied to future desktop update checks.
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-400">
          {updater?.configured ? (
            <>
              Manifest
              <div className="mt-2 truncate font-mono text-[11px] text-slate-500">
                {updater.endpoint}
              </div>
            </>
          ) : (
            <>
              In-app updates are disabled in this session.
              <div className="mt-2 text-slate-500">
                Set MAABARIUM_UPDATE_BASE_URL or MAABARIUM_UPDATE_MANIFEST_URL
                at runtime, or embed them during the release build, plus
                MAABARIUM_UPDATE_PUBKEY to enable update checks.
              </div>
            </>
          )}
        </div>

        {!updater?.configured ? (
          <div className="rounded-lg border border-dashed border-amber-400/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-100">
            This desktop session is running without updater credentials or a
            release manifest URL.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={
              checkingForUpdates || savingPreferences || !updater?.configured
            }
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition disabled:cursor-not-allowed disabled:opacity-70"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
              <RefreshCw
                size={14}
                className={checkingForUpdates ? "animate-spin" : ""}
              />
              {!updater?.configured
                ? "Updater Not Configured"
                : checkingForUpdates
                  ? "Checking..."
                  : "Check Updates"}
            </div>
          </button>

          {updateCheck?.available ? (
            <>
              <button
                type="button"
                onClick={onInstallUpdate}
                disabled={installingUpdate}
                className="w-full rounded-lg border border-teal-400/25 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-3 text-left hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-70"
              >
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white">
                  <Download size={14} />
                  {installingUpdate
                    ? "Installing..."
                    : `Install ${updateCheck.version}`}
                </div>
              </button>

              {activeReminder ? (
                <button
                  type="button"
                  onClick={onClearReminder}
                  disabled={savingPreferences}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-200">
                    Clear Reminder
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Snoozed until {formatExperimentTimestamp(activeReminder)}
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onRemindLater}
                  disabled={savingPreferences}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-200">
                    Remind Tomorrow
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Keep the release visible but remember that you snoozed this
                    version.
                  </div>
                </button>
              )}
            </>
          ) : null}
        </div>

        {updateCheck ? (
          <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3 text-xs text-slate-400 space-y-2">
            {updateCheck.available ? (
              <>
                <div className="font-semibold text-slate-100">
                  Update {updateCheck.version} is available
                </div>
                {activeReminder ? (
                  <div className="text-amber-200">
                    Reminder snoozed until{" "}
                    {formatExperimentTimestamp(activeReminder)}.
                  </div>
                ) : null}
                {updateCheck.date ? (
                  <div>{formatExperimentTimestamp(updateCheck.date)}</div>
                ) : null}
                {updateCheck.body ? (
                  <div className="leading-relaxed text-slate-300">
                    {updateCheck.body}
                  </div>
                ) : null}
              </>
            ) : (
              <div>No newer desktop release is available right now.</div>
            )}
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}
