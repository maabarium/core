import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Wrench } from "lucide-react";
import type {
  DesktopSetupState,
  GitDependencyState,
  OllamaStatus,
  PluginRuntimeState,
  ReadinessItem,
  ResearchSearchMode,
  RemoteProviderSetup,
  RuntimeStrategy,
  WorkspaceGitStatus,
} from "../../types/console";
import { listOllamaModelNames } from "../../lib/ollama";
import { Badge } from "../ui/Badge";

type DesktopSetupModalProps = {
  isOpen: boolean;
  setupState: DesktopSetupState;
  readinessItems: ReadinessItem[];
  gitDependency: GitDependencyState;
  ollama: OllamaStatus | null;
  pluginRuntime: PluginRuntimeState | null;
  saving: boolean;
  onClose: () => void;
  onInspectWorkspace: (path: string) => Promise<WorkspaceGitStatus | null>;
  onSave: (
    nextSetup: DesktopSetupState,
    apiKeys: Record<string, string>,
  ) => Promise<void>;
  onInstallGit: () => Promise<void>;
  onInstallOllama: () => Promise<void>;
  onStartOllama: () => Promise<void>;
};

export function DesktopSetupModal({
  isOpen,
  setupState,
  readinessItems,
  gitDependency,
  ollama,
  pluginRuntime,
  saving,
  onClose,
  onInspectWorkspace,
  onSave,
  onInstallGit,
  onInstallOllama,
  onStartOllama,
}: DesktopSetupModalProps) {
  const [form, setForm] = useState<DesktopSetupState>(setupState);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceGitStatus | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setForm(setupState);
    setApiKeys({});
    setWorkspaceStatus(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const normalizedWorkspace = form.workspacePath?.trim() ?? "";
    if (!normalizedWorkspace) {
      setWorkspaceStatus(null);
      setInspectingWorkspace(false);
      return;
    }

    let cancelled = false;
    setInspectingWorkspace(true);

    void onInspectWorkspace(normalizedWorkspace)
      .then((status) => {
        if (!cancelled) {
          setWorkspaceStatus(status);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInspectingWorkspace(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form.workspacePath, isOpen, onInspectWorkspace]);

  if (!isOpen) {
    return null;
  }

  const workspaceMissing = Boolean(
    workspaceStatus && form.workspacePath?.trim() && !workspaceStatus.exists,
  );
  const workspaceNotDirectory = Boolean(
    workspaceStatus && workspaceStatus.exists && !workspaceStatus.isDirectory,
  );
  const workspaceNeedsGitInit = Boolean(
    workspaceStatus &&
    workspaceStatus.exists &&
    workspaceStatus.isDirectory &&
    !workspaceStatus.isGitRepository,
  );
  const researchSearchReadiness =
    readinessItems.find((item) => item.id === "research_search") ?? null;
  const gitReadiness = readinessItems.find((item) => item.id === "git") ?? null;
  const searchMode = form.researchSearchMode;
  const researchSearchOptions: Array<{
    value: ResearchSearchMode;
    label: string;
    copy: string;
  }> = [
    {
      value: "duckduckgo_scrape",
      label: "Free Scraper",
      copy: "Uses DuckDuckGo HTML scraping with no API key. It works out of the box, but results can be less stable or blocked without warning.",
    },
    {
      value: "brave_api",
      label: "Brave API",
      copy: "Uses the official Brave Search API. It is more reliable, but requires a configured API key.",
    },
  ];

  const availableModelNames = listOllamaModelNames(
    ollama,
    form.selectedLocalModels,
  );

  const toggleModel = (modelName: string) => {
    setForm((current) => ({
      ...current,
      selectedLocalModels: current.selectedLocalModels.includes(modelName)
        ? current.selectedLocalModels.filter((value) => value !== modelName)
        : [...current.selectedLocalModels, modelName],
    }));
  };

  const updateProvider = (
    providerId: string,
    updater: (provider: RemoteProviderSetup) => RemoteProviderSetup,
  ) => {
    setForm((current) => ({
      ...current,
      remoteProviders: current.remoteProviders.map((provider) =>
        provider.providerId === providerId ? updater(provider) : provider,
      ),
    }));
  };

  const chooseWorkspace = async () => {
    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    setForm((current) => ({
      ...current,
      workspacePath: selectedPath,
    }));
  };

  return (
    <div className="fixed inset-0 z-[145] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="flex items-start justify-between gap-6 border-b border-white/5 bg-white/5 px-6 py-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
              Guided Setup
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
              Prepare Maabarium to run real workflows
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Choose a runtime strategy, point the app at a workspace, configure
              providers, and make sure at least one model path is ready.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-300 transition hover:bg-white/10"
          >
            Skip For Now
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Experience Mode
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    [true, "Guided"],
                    [false, "Advanced"],
                  ] as const
                ).map(([guidedMode, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        guidedMode,
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left transition ${form.guidedMode === guidedMode ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                  >
                    <div className="text-xs font-bold uppercase tracking-[0.18em]">
                      {label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed">
                      {guidedMode
                        ? "Plain-language defaults with the next action kept obvious."
                        : "Keep blueprint terminology and lower-level controls visible."}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Runtime Strategy
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                {(
                  [
                    ["local", "Local"],
                    ["remote", "Remote"],
                    ["mixed", "Mixed"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        runtimeStrategy: value as RuntimeStrategy,
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left transition ${form.runtimeStrategy === value ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                  >
                    <div className="text-xs font-bold uppercase tracking-[0.18em]">
                      {label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed">
                      {value === "local"
                        ? "Prefer Ollama-hosted local models."
                        : value === "remote"
                          ? "Use managed API providers only."
                          : "Use local models first, with remote fallbacks where needed."}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {gitReadiness ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Git Dependency
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {gitReadiness.summary}
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
                    <div>
                      Installer: {gitDependency.installerLabel ?? "Unavailable"}
                    </div>
                    <div>
                      Command:{" "}
                      {gitDependency.installCommand ??
                        "Manual installation required"}
                    </div>
                    {gitDependency.commandPath ? (
                      <div>Resolved binary: {gitDependency.commandPath}</div>
                    ) : null}
                  </div>
                </div>
                <Badge
                  color={
                    gitReadiness.status === "ready"
                      ? "emerald"
                      : gitReadiness.status === "optional"
                        ? "slate"
                        : "rose"
                  }
                >
                  {gitReadiness.status === "needs_attention"
                    ? "Needs Attention"
                    : gitReadiness.status === "optional"
                      ? "Optional"
                      : "Ready"}
                </Badge>
              </div>

              {gitReadiness.status === "needs_attention" ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void onInstallGit()}
                    className="rounded-lg border border-amber-300/20 bg-gradient-to-r from-amber-400/15 to-teal-500/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
                  >
                    {gitReadiness.actionLabel}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Workspace
                </div>
                <div className="mt-2 text-sm text-slate-300">
                  {form.workspacePath ?? "No workspace selected yet."}
                </div>
                <div className="mt-3 text-xs leading-relaxed text-slate-400">
                  {inspectingWorkspace
                    ? "Inspecting folder and repository status..."
                    : workspaceMissing
                      ? "This saved workspace path does not exist. Choose an existing folder before you rely on it as the default workspace."
                      : workspaceNotDirectory
                        ? "The selected path is not a folder. Choose a workspace directory instead."
                        : workspaceStatus?.isGitRepository
                          ? `Repository detected${workspaceStatus.repositoryRoot ? ` at ${workspaceStatus.repositoryRoot}` : "."}`
                          : workspaceNeedsGitInit
                            ? "This default workspace is not inside a git repository yet. The run modal can initialize it before an experiment starts."
                            : "Choose a workspace to inspect its repository status."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void chooseWorkspace()}
                className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                Choose Workspace
              </button>
            </div>

            {workspaceStatus && !inspectingWorkspace ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-3 text-xs leading-relaxed ${workspaceStatus.isGitRepository ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : workspaceMissing || workspaceNotDirectory ? "border-rose-400/20 bg-rose-500/10 text-rose-100" : "border-amber-300/20 bg-amber-500/10 text-amber-100"}`}
              >
                {workspaceStatus.isGitRepository
                  ? `Git repository ready. Runs can branch safely from ${workspaceStatus.repositoryRoot ?? workspaceStatus.path}.`
                  : workspaceMissing
                    ? "The saved workspace path could not be found. Update setup before using it as the default run location."
                    : workspaceNotDirectory
                      ? "The selected path is not a directory. Pick a workspace folder instead of a file."
                      : "No git repository was found for this folder. That is allowed, but you will need the run modal's git initialization option enabled before a run can prepare experiment branches safely."}
              </div>
            ) : null}
          </section>

          {pluginRuntime ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Evaluator Plugin
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {pluginRuntime.displayName ?? pluginRuntime.pluginId}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {pluginRuntime.summary}
                  </div>
                </div>
                <Badge
                  color={pluginRuntime.status === "ready" ? "emerald" : "rose"}
                >
                  {pluginRuntime.status === "ready"
                    ? "Ready"
                    : "Needs Attention"}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Manifest
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.manifestPath}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Command
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.command ?? "Unavailable"}
                  </div>
                  {pluginRuntime.args.length > 0 ? (
                    <div className="mt-2 break-all text-[11px] text-slate-500">
                      Args: {pluginRuntime.args.join(" ")}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Working Directory
                  </div>
                  <div className="mt-2 break-all text-xs text-slate-200">
                    {pluginRuntime.workingDir ?? "Uses manifest directory"}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Runtime Settings
                  </div>
                  <div className="mt-2 text-xs text-slate-200">
                    Timeout: {pluginRuntime.timeoutSeconds ?? 0}s
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Environment keys:{" "}
                    {pluginRuntime.environmentKeys.join(", ") || "None"}
                  </div>
                </div>
              </div>

              {pluginRuntime.error ? (
                <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-3 text-xs leading-relaxed text-rose-100">
                  {pluginRuntime.error}
                </div>
              ) : null}
            </section>
          ) : null}

          {form.runtimeStrategy === "local" ||
          form.runtimeStrategy === "mixed" ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Local Runtime
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {ollama?.statusDetail ?? "Ollama status unavailable."}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!ollama?.installed ? (
                    <button
                      type="button"
                      onClick={() => void onInstallOllama()}
                      className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500/15 to-amber-400/15 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition hover:brightness-110"
                    >
                      Install Ollama
                    </button>
                  ) : !ollama.running ? (
                    <button
                      type="button"
                      onClick={() => void onStartOllama()}
                      className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
                    >
                      Start Ollama
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Select Local Models
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableModelNames.map((modelName) => {
                  const selected = form.selectedLocalModels.includes(modelName);
                  const installed =
                    ollama?.models.some((model) => model.name === modelName) ??
                    false;
                  return (
                    <button
                      key={modelName}
                      type="button"
                      onClick={() => toggleModel(modelName)}
                      className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}
                    >
                      {modelName}
                      {installed ? " • installed" : " • recommended"}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {form.runtimeStrategy === "remote" ||
          form.runtimeStrategy === "mixed" ? (
            <section className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                Remote Providers
              </div>
              <div className="mt-4 space-y-3">
                {form.remoteProviders.map((provider) => (
                  <div
                    key={provider.providerId}
                    className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">
                          {provider.label}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {provider.endpoint ?? "Custom endpoint required"}
                        </div>
                      </div>
                      <Badge color={provider.configured ? "emerald" : "rose"}>
                        {provider.configured ? "Configured" : "Needs Key"}
                      </Badge>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <input
                        value={provider.endpoint ?? ""}
                        onChange={(event) =>
                          updateProvider(provider.providerId, (current) => ({
                            ...current,
                            endpoint: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                        placeholder="Provider endpoint"
                      />
                      <input
                        value={provider.modelName ?? ""}
                        onChange={(event) =>
                          updateProvider(provider.providerId, (current) => ({
                            ...current,
                            modelName: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                        placeholder="Default model name"
                      />
                      <input
                        value={apiKeys[provider.providerId] ?? ""}
                        onChange={(event) =>
                          setApiKeys((current) => ({
                            ...current,
                            [provider.providerId]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40 md:col-span-2"
                        placeholder="Paste API key to store in the OS keychain"
                      />
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                      <input
                        type="checkbox"
                        checked={provider.fallbackOnly}
                        onChange={(event) =>
                          updateProvider(provider.providerId, (current) => ({
                            ...current,
                            fallbackOnly: event.target.checked,
                          }))
                        }
                      />
                      Use as fallback only
                    </label>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Research Search
                </div>
                <div className="mt-2 text-sm text-slate-300">
                  Choose how internet-backed research discovery should work.
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  General Research workflows can use an official API-backed
                  provider or a free scraper-backed fallback with lower
                  reliability.
                </div>
              </div>
              {researchSearchReadiness ? (
                <Badge
                  color={
                    researchSearchReadiness.status === "ready"
                      ? "emerald"
                      : researchSearchReadiness.status === "optional"
                        ? "slate"
                        : "rose"
                  }
                >
                  {researchSearchReadiness.status === "needs_attention"
                    ? "Needs Attention"
                    : researchSearchReadiness.status === "optional"
                      ? "Optional"
                      : "Ready"}
                </Badge>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {researchSearchOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        researchSearchMode: option.value,
                      }))
                    }
                    className={`rounded-lg border px-3 py-3 text-left transition ${searchMode === option.value ? "border-teal-400/30 bg-teal-500/10 text-white" : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"}`}
                  >
                    <div className="text-xs font-bold uppercase tracking-[0.18em]">
                      {option.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed">
                      {option.copy}
                    </div>
                  </button>
                ))}
              </div>

              {searchMode === "brave_api" ? (
                <>
                  <input
                    value={apiKeys.brave ?? ""}
                    onChange={(event) =>
                      setApiKeys((current) => ({
                        ...current,
                        brave: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-teal-400/40"
                    placeholder="Paste Brave Search API key to store in the OS keychain"
                  />
                  <div className="text-[11px] leading-relaxed text-slate-500">
                    Leave this blank to keep the existing key unchanged. The
                    runtime resolves it as BRAVE_SEARCH_API_KEY for research
                    discovery.
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-[11px] leading-relaxed text-amber-100">
                  Free scraper mode is unofficial. Search results may be slower,
                  lower quality, rate-limited, or unavailable if the upstream
                  HTML layout changes. Use it for out-of-the-box discovery, not
                  for high-assurance research.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              <CheckCircle2 size={14} className="text-teal-300" />
              Readiness Snapshot
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {readinessItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-100">
                        {item.title}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        {item.summary}
                      </div>
                    </div>
                    <Badge
                      color={
                        item.status === "ready"
                          ? "emerald"
                          : item.status === "optional"
                            ? "slate"
                            : "rose"
                      }
                    >
                      {item.status === "needs_attention"
                        ? "Needs Attention"
                        : item.status === "optional"
                          ? "Optional"
                          : "Ready"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Wrench size={14} />
              Setup is saved to the desktop app data directory and provider keys
              go into the OS keychain.
            </div>
            <button
              type="button"
              onClick={() =>
                void onSave(
                  {
                    ...form,
                    onboardingCompleted: true,
                    lastSetupCompletedAt: new Date().toISOString(),
                  },
                  apiKeys,
                )
              }
              disabled={saving}
              className="rounded-lg border border-teal-400/20 bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? "Saving..." : "Save Setup"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
