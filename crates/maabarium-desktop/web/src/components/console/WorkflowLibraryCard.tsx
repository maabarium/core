import { FileText, Search, SlidersHorizontal } from "lucide-react";
import type { AvailableBlueprint, WizardTemplate } from "../../types/console";
import { formatBlueprintGroup } from "../../lib/blueprints";
import type {
  BlueprintDensity,
  GroupedBlueprints,
} from "../../lib/useBlueprintLibraryViewModel";
import { Badge } from "../ui/Badge";
import { GlassCard } from "../ui/GlassCard";

type WorkflowLibraryCardProps = {
  totalBlueprintCount: number;
  visibleBlueprintCount: number;
  blueprintGroups: GroupedBlueprints;
  density: BlueprintDensity;
  searchQuery: string;
  selectedLanguageGroup: string;
  languageGroupOptions: string[];
  activeFilters: string[];
  collapsedGroups: Record<string, boolean>;
  pendingBlueprintPath: string | null;
  isEngineRunning: boolean;
  activeBlueprintPath: string;
  onOpenWizard: () => void;
  onDensityChange: (density: BlueprintDensity) => void;
  onSearchQueryChange: (value: string) => void;
  onLanguageGroupChange: (value: string) => void;
  onResetFilters: () => void;
  onToggleGroup: (group: string) => void;
  onSelectBlueprint: (path: string) => void;
  onOpenTemplateWizard: (
    template: WizardTemplate,
    displayName: string,
    description: string | null,
  ) => void;
};

export function WorkflowLibraryCard({
  totalBlueprintCount,
  visibleBlueprintCount,
  blueprintGroups,
  density,
  searchQuery,
  selectedLanguageGroup,
  languageGroupOptions,
  activeFilters,
  collapsedGroups,
  pendingBlueprintPath,
  isEngineRunning,
  activeBlueprintPath,
  onOpenWizard,
  onDensityChange,
  onSearchQueryChange,
  onLanguageGroupChange,
  onResetFilters,
  onToggleGroup,
  onSelectBlueprint,
  onOpenTemplateWizard,
}: WorkflowLibraryCardProps) {
  return (
    <GlassCard
      title="Workflow Library"
      icon={FileText}
      glow
      headerActions={
        <button
          type="button"
          onClick={onOpenWizard}
          disabled={isEngineRunning}
          className="shrink-0 whitespace-nowrap rounded-lg bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          Create With Wizard
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              Load runnable workflows or hydrate setup-required templates
              without leaving the main console.
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {visibleBlueprintCount}/{totalBlueprintCount} visible
              {pendingBlueprintPath
                ? " • applying selection"
                : isEngineRunning
                  ? " • stop the engine to switch"
                  : ""}
            </div>
          </div>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 p-1">
              {(["detailed", "compact"] as const).map((currentDensity) => (
                <button
                  key={currentDensity}
                  type="button"
                  onClick={() => onDensityChange(currentDensity)}
                  className={`px-3 py-2 rounded-md text-[10px] font-black uppercase tracking-[0.18em] transition ${density === currentDensity ? "bg-amber-500/15 text-amber-200" : "text-slate-500 hover:text-slate-300"}`}
                >
                  {currentDensity}
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-2 focus-within:border-teal-400/60 transition xl:min-w-[22rem]">
              <Search size={14} className="text-slate-500" />
              <input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Search name, file, path, repo, version"
                className="w-full bg-transparent border-0 outline-none text-sm text-slate-200 placeholder:text-slate-600"
                type="search"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">
            <SlidersHorizontal size={12} />
            Filter
          </div>
          <button
            type="button"
            onClick={() => onLanguageGroupChange("all")}
            className={`px-2 py-1 rounded-md border text-[10px] font-black uppercase tracking-[0.18em] transition shrink-0 ${selectedLanguageGroup === "all" ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300"}`}
          >
            All
          </button>
          {languageGroupOptions.map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => onLanguageGroupChange(language)}
              className={`px-2 py-1 rounded-md border text-[10px] font-black uppercase tracking-[0.18em] transition shrink-0 ${selectedLanguageGroup === language ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300"}`}
            >
              {language}
            </button>
          ))}
        </div>

        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {activeFilters.map((filter) => (
              <Badge key={filter} color="slate">
                {filter}
              </Badge>
            ))}
            <button
              type="button"
              onClick={onResetFilters}
              className="px-2 py-1 rounded-md border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200 transition"
            >
              Clear Filters
            </button>
          </div>
        ) : null}

        {blueprintGroups.length > 0 ? (
          <div className="max-h-[58rem] space-y-5 overflow-y-auto pr-1">
            {blueprintGroups.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.group]);

              return (
                <div key={group.group} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <button
                      type="button"
                      onClick={() => onToggleGroup(group.group)}
                      className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 hover:text-slate-300 transition"
                    >
                      {isCollapsed ? "+" : "-"} {group.group}
                    </button>
                    <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                      <span>{group.blueprints.length} entries</span>
                      <span>{isCollapsed ? "collapsed" : "expanded"}</span>
                    </div>
                  </div>
                  {!isCollapsed ? (
                    <div
                      className={`grid grid-cols-1 gap-3 ${density === "compact" ? "" : "xl:grid-cols-2"}`}
                    >
                      {group.blueprints.map((blueprint) => {
                        const isSelected =
                          blueprint.path === activeBlueprintPath;
                        const isSwitching =
                          pendingBlueprintPath === blueprint.path;
                        const isDisabled =
                          isEngineRunning ||
                          isSelected ||
                          isSwitching ||
                          !blueprint.isLoadable ||
                          pendingBlueprintPath !== null;

                        return (
                          <div
                            key={blueprint.path}
                            className={`w-full rounded-lg border text-left transition ${density === "compact" ? "px-3 py-3" : "px-4 py-4"} ${isSelected ? "border-teal-400/40 bg-teal-500/10" : !blueprint.isLoadable ? "border-rose-500/30 bg-rose-500/5" : blueprint.requiresSetup ? "border-amber-400/20 bg-amber-500/[0.04]" : "border-white/5 bg-white/[0.03] hover:border-amber-400/20 hover:bg-white/[0.06]"}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-100 truncate">
                                  {blueprint.displayName}
                                </div>
                                <div className="mt-1 text-[11px] uppercase tracking-widest text-slate-500 truncate">
                                  {blueprint.fileName}
                                </div>
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                <Badge
                                  color={
                                    blueprint.libraryKind === "template"
                                      ? "rose"
                                      : "slate"
                                  }
                                >
                                  {blueprint.libraryKind}
                                </Badge>
                                {blueprint.requiresSetup ? (
                                  <Badge color="rose">Setup Required</Badge>
                                ) : null}
                                {isSelected ? (
                                  <Badge color="blue">Loaded</Badge>
                                ) : isSwitching ? (
                                  <Badge color="emerald">Loading</Badge>
                                ) : !blueprint.isLoadable ? (
                                  <Badge color="rose">Invalid</Badge>
                                ) : blueprint.isActive ? (
                                  <Badge color="emerald">Current</Badge>
                                ) : null}
                              </div>
                            </div>
                            {density === "detailed" ? (
                              <>
                                <div className="mt-2 text-xs text-slate-400 line-clamp-2">
                                  {blueprint.description ||
                                    "No blueprint description provided."}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {blueprint.version ? (
                                    <Badge color="slate">
                                      v{blueprint.version}
                                    </Badge>
                                  ) : null}
                                  {blueprint.councilSize !== null ? (
                                    <Badge color="slate">
                                      {blueprint.councilSize} agents
                                    </Badge>
                                  ) : null}
                                  {blueprint.metricCount !== null ? (
                                    <Badge color="slate">
                                      {blueprint.metricCount} metrics
                                    </Badge>
                                  ) : null}
                                  {blueprint.targetFileCount !== null ? (
                                    <Badge color="slate">
                                      {blueprint.targetFileCount} files
                                    </Badge>
                                  ) : null}
                                  {blueprint.maxIterations !== null ? (
                                    <Badge color="slate">
                                      {blueprint.maxIterations} loops
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-3 grid gap-1 text-[11px] text-slate-500">
                                  {blueprint.repoPath ? (
                                    <div className="truncate">
                                      Repo: {blueprint.repoPath}
                                    </div>
                                  ) : null}
                                  <div className="truncate">
                                    Path: {blueprint.path}
                                  </div>
                                  {!blueprint.isLoadable &&
                                  blueprint.loadError ? (
                                    <div className="text-rose-300 line-clamp-2">
                                      {blueprint.loadError}
                                    </div>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                {blueprint.version ? (
                                  <span>v{blueprint.version}</span>
                                ) : null}
                                {blueprint.language ? (
                                  <span>
                                    {formatBlueprintGroup(blueprint.language)}
                                  </span>
                                ) : null}
                                {blueprint.metricCount !== null ? (
                                  <span>{blueprint.metricCount} metrics</span>
                                ) : null}
                                {blueprint.maxIterations !== null ? (
                                  <span>{blueprint.maxIterations} loops</span>
                                ) : null}
                              </div>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                              {blueprint.requiresSetup ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenTemplateWizard(
                                      blueprint.wizardTemplate ?? "custom",
                                      blueprint.displayName,
                                      blueprint.description,
                                    )
                                  }
                                  className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200 transition hover:bg-amber-500/15"
                                >
                                  Setup Required
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSelectBlueprint(blueprint.path)
                                  }
                                  disabled={isDisabled}
                                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  {isSelected
                                    ? "Loaded"
                                    : isSwitching
                                      ? "Loading"
                                      : "Load Workflow"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            No blueprints match the current search and filter.
          </div>
        )}
      </div>
    </GlassCard>
  );
}
