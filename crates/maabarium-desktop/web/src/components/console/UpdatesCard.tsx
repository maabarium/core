import { Download, RefreshCw } from "lucide-react";
import { formatExperimentTimestamp } from "../../lib/formatters";
import type {
  UpdateCheckResult,
  UpdaterConfigurationState,
} from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

export function UpdatesCard({
  updater,
  updateCheck,
  checkingForUpdates,
  installingUpdate,
  onCheckForUpdates,
  onInstallUpdate,
}: {
  updater: UpdaterConfigurationState | null | undefined;
  updateCheck: UpdateCheckResult | null;
  checkingForUpdates: boolean;
  installingUpdate: boolean;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
}) {
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
                plus MAABARIUM_UPDATE_PUBKEY to enable update checks.
              </div>
            </>
          )}
        </div>

        {!updater?.configured ? (
          <div className="rounded-lg border border-dashed border-amber-400/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-100">
            Dev mode is running without updater credentials or a release
            manifest URL.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={checkingForUpdates || !updater?.configured}
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
          ) : null}
        </div>

        {updateCheck ? (
          <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3 text-xs text-slate-400 space-y-2">
            {updateCheck.available ? (
              <>
                <div className="font-semibold text-slate-100">
                  Update {updateCheck.version} is available
                </div>
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
