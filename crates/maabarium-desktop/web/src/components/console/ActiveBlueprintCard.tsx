import { FileText, FolderOpen, Layers, Settings, Terminal } from "lucide-react";
import { formatBlueprintGroup } from "../../lib/blueprints";
import type { AvailableBlueprint } from "../../types/console";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

export function ActiveBlueprintCard({
  blueprintSummary,
  activeBlueprintOption,
  engineRunning,
  onOpenBlueprintWizard,
  onEditBlueprintWizard,
  onSelectBlueprint,
  onOpenBlueprintFile,
  onOpenBlueprintDirectory,
}: {
  blueprintSummary: string;
  activeBlueprintOption: AvailableBlueprint | null;
  engineRunning: boolean;
  onOpenBlueprintWizard: () => void;
  onEditBlueprintWizard: () => void;
  onSelectBlueprint: () => void;
  onOpenBlueprintFile: () => void;
  onOpenBlueprintDirectory: () => void;
}) {
  return (
    <GlassCard title="Active Blueprint" icon={FileText}>
      <div className="bg-slate-950/80 p-4 rounded-lg border border-white/5 border-l border-l-amber-400/35 font-mono text-[10px] text-slate-400 mb-4 leading-relaxed relative overflow-hidden whitespace-pre-wrap">
        <div className="absolute top-0 right-0 p-2 opacity-10">
          <Terminal size={40} />
        </div>
        {blueprintSummary}
      </div>
      {activeBlueprintOption ? (
        <div className="mb-4 rounded-lg border border-white/5 bg-white/5 px-3 py-3 text-xs text-slate-400 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-200">
              {activeBlueprintOption.fileName}
            </div>
            <Badge color="blue">Active</Badge>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {activeBlueprintOption.language ? (
              <Badge color="slate">
                {formatBlueprintGroup(
                  activeBlueprintOption.language,
                  activeBlueprintOption.libraryKind,
                )}
              </Badge>
            ) : null}
            {activeBlueprintOption.version ? (
              <Badge color="emerald">v{activeBlueprintOption.version}</Badge>
            ) : null}
            {activeBlueprintOption.councilSize !== null ? (
              <Badge color="slate">
                {activeBlueprintOption.councilSize} agents
              </Badge>
            ) : null}
            {activeBlueprintOption.metricCount !== null ? (
              <Badge color="slate">
                {activeBlueprintOption.metricCount} metrics
              </Badge>
            ) : null}
            {activeBlueprintOption.maxIterations !== null ? (
              <Badge color="slate">
                {activeBlueprintOption.maxIterations} loops
              </Badge>
            ) : null}
          </div>
          <div>
            {activeBlueprintOption.description ||
              "No blueprint description provided."}
          </div>
          {activeBlueprintOption.repoPath ? (
            <div className="truncate text-[11px] text-slate-500">
              Repo: {activeBlueprintOption.repoPath}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        {activeBlueprintOption?.libraryKind === "workflow" ? (
          <button
            onClick={onEditBlueprintWizard}
            className="w-full py-2 bg-gradient-to-r from-teal-500 to-amber-400 hover:brightness-110 border border-teal-300/20 rounded-lg text-xs font-black tracking-[0.16em] text-slate-950 transition-all flex items-center justify-center gap-2"
            type="button"
            disabled={engineRunning}
          >
            <Layers size={14} />
            EDIT IN WIZARD
          </button>
        ) : null}
        <button
          onClick={onOpenBlueprintWizard}
          className={`w-full py-2 border rounded-lg text-xs font-black tracking-[0.16em] transition-all flex items-center justify-center gap-2 ${activeBlueprintOption?.libraryKind === "workflow" ? "bg-white/5 hover:bg-white/10 border-white/10 text-slate-100" : "bg-gradient-to-r from-teal-500 to-amber-400 hover:brightness-110 border-teal-300/20 text-slate-950"}`}
          type="button"
          disabled={engineRunning}
        >
          <Layers size={14} />
          CREATE WITH WIZARD
        </button>
        <button
          onClick={onSelectBlueprint}
          className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
          type="button"
          disabled={engineRunning}
        >
          <Settings size={14} />
          SELECT BLUEPRINT
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onOpenBlueprintFile}
            className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
            type="button"
          >
            <FileText size={14} />
            OPEN FILE
          </button>
          <button
            onClick={onOpenBlueprintDirectory}
            className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
            type="button"
          >
            <FolderOpen size={14} />
            OPEN FOLDER
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
        The wizard is the default path for creating or revising runnable
        workflows. Power users can still load or hand-edit
        <span className="font-mono"> .toml </span>
        files directly.
      </p>
    </GlassCard>
  );
}
