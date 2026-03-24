import { FileText, FolderOpen, Package, X } from "lucide-react";
import appLogo from "../../../../icons/maabariumLogo.png";

type AboutModalProps = {
  isOpen: boolean;
  version: string;
  dbPath: string | null;
  logPath: string | null;
  onClose: () => void;
  onOpenLicense: () => void;
};

export function AboutModal({
  isOpen,
  version,
  dbPath,
  logPath,
  onClose,
  onOpenLicense,
}: AboutModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-teal-400/20 bg-slate-950/95 shadow-[0_24px_80px_rgba(8,145,178,0.18)]">
        <div className="relative overflow-hidden border-b border-white/5 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.22),_transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] px-6 py-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            aria-label="Close About Maabarium"
          >
            <X size={16} />
          </button>

          <div className="flex items-start gap-5">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-3 shadow-[0_18px_40px_rgba(15,23,42,0.35)]">
              <img
                src={appLogo}
                alt="Maabarium logo"
                className="h-20 w-20 rounded-2xl object-contain"
              />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-200">
                About Maabarium
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-white">
                Maabarium
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
                Local-first autonomous research and evaluation workflows with a
                Rust runtime, Tauri desktop console, reproducible traces, and
                blueprint-driven model orchestration.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-teal-400/20 bg-teal-400/10 px-3 py-1 font-black uppercase tracking-[0.18em] text-teal-100">
                  v{version}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                  Apache 2.0
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                  com.maabarium.console
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                <Package size={14} className="text-teal-300" />
                Build
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-100">
                Maabarium Desktop Console
              </div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                Native macOS packaging, persisted runtime state, live run
                telemetry, and research evidence review in one workspace.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                <FileText size={14} className="text-amber-300" />
                License
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-100">
                Apache License 2.0
              </div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                Open the repository LICENSE file that ships with the app or the
                local checkout.
              </div>
              <button
                type="button"
                onClick={onOpenLicense}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-amber-100 transition hover:bg-amber-400/15"
              >
                <FolderOpen size={14} />
                Open LICENSE
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              Runtime Paths
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Database
                </div>
                <div className="mt-1 break-all rounded-xl border border-white/5 bg-slate-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400">
                  {dbPath ?? "Unavailable"}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-200">Logs</div>
                <div className="mt-1 break-all rounded-xl border border-white/5 bg-slate-950/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400">
                  {logPath ?? "Unavailable"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
