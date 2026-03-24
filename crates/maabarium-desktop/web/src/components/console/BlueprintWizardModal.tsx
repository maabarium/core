import { CircleHelp } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyWizardTemplate,
  wizardTemplateDefaults,
} from "../../lib/blueprints";
import type {
  BlueprintWizardForm,
  WorkspaceGitStatus,
  WizardAgentForm,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../../types/console";

type BlueprintWizardModalProps = {
  open: boolean;
  isCreating: boolean;
  isEngineRunning: boolean;
  form: BlueprintWizardForm;
  metricWeightTotal: number;
  modelNames: string[];
  mode: "create" | "edit";
  localModelOptions: string[];
  providerOptions: Array<{
    id: string;
    label: string;
    endpoint: string;
    defaultModelName: string;
  }>;
  savedWorkspacePath: string | null;
  onInspectWorkspace: (path: string) => Promise<WorkspaceGitStatus | null>;
  setForm: Dispatch<SetStateAction<BlueprintWizardForm>>;
  addMetric: () => void;
  updateMetric: (
    index: number,
    field: keyof WizardMetricForm,
    value: string | number,
  ) => void;
  removeMetric: (index: number) => void;
  addAgent: () => void;
  updateAgent: (
    index: number,
    field: keyof WizardAgentForm,
    value: string,
  ) => void;
  removeAgent: (index: number) => void;
  addModel: () => void;
  updateModel: (
    index: number,
    field: keyof WizardModelForm,
    value: string | number,
  ) => void;
  removeModel: (index: number) => void;
  onClose: () => void;
  onSubmit: () => void;
};

type WizardTab = "basics" | "evaluation" | "agents" | "models";

const TAB_ORDER: Array<{ id: WizardTab; label: string; copy: string }> = [
  {
    id: "basics",
    label: "Basics",
    copy: "Identity, workspace scope, and template intent.",
  },
  {
    id: "evaluation",
    label: "Evaluation",
    copy: "Metrics, constraints, and acceptance thresholds.",
  },
  {
    id: "agents",
    label: "Agents",
    copy: "Council roles and which model each one should use.",
  },
  {
    id: "models",
    label: "Models",
    copy: "Provider-backed model pool and assignment strategy.",
  },
];

const TEMPLATE_ORDER: WizardTemplate[] = [
  "code_quality",
  "product_builder",
  "general_research",
  "prompt_optimization",
  "lora_validation",
  "custom",
];

const textFieldClass =
  "h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-100 outline-none transition focus:border-teal-400/60";
const textAreaClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none transition focus:border-teal-400/60";
const sectionCardClass =
  "space-y-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4";
const secondaryButtonClass =
  "whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70";
const accentButtonClass =
  "whitespace-nowrap rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-70";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0),
    ),
  );
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
      <span>{label}</span>
      {help ? (
        <span
          title={help}
          className="inline-flex text-slate-500 transition hover:text-slate-300"
        >
          <CircleHelp size={13} />
        </span>
      ) : null}
    </div>
  );
}

function FieldHint({ children }: { children: string }) {
  return (
    <div className="mt-2 text-xs leading-relaxed text-slate-500">
      {children}
    </div>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
      : tone === "amber"
        ? "border-amber-300/20 bg-amber-500/10 text-amber-200"
        : tone === "rose"
          ? "border-rose-400/20 bg-rose-500/10 text-rose-200"
          : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${toneClass}`}
    >
      {label}
    </span>
  );
}

function TabButton({
  active,
  label,
  copy,
  onClick,
}: {
  active: boolean;
  label: string;
  copy: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active
          ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
          : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
      }`}
    >
      <div className="text-[10px] font-black uppercase tracking-[0.18em]">
        {label}
      </div>
      <div className="mt-1 text-xs leading-relaxed">{copy}</div>
    </button>
  );
}

export function BlueprintWizardModal({
  open,
  isCreating,
  isEngineRunning,
  form,
  metricWeightTotal,
  modelNames,
  localModelOptions,
  mode,
  providerOptions,
  savedWorkspacePath,
  onInspectWorkspace,
  setForm,
  addMetric,
  updateMetric,
  removeMetric,
  addAgent,
  updateAgent,
  removeAgent,
  addModel,
  updateModel,
  removeModel,
  onClose,
  onSubmit,
}: BlueprintWizardModalProps) {
  const [activeTab, setActiveTab] = useState<WizardTab>("basics");
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceGitStatus | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false);

  const isEditMode = mode === "edit";
  const providerOptionsById = useMemo(
    () => new Map(providerOptions.map((provider) => [provider.id, provider])),
    [providerOptions],
  );

  const combinedModelOptions = useMemo(
    () =>
      uniqueStrings([
        ...localModelOptions,
        ...modelNames,
        ...providerOptions.map((provider) => provider.defaultModelName),
      ]),
    [localModelOptions, modelNames, providerOptions],
  );

  const showHydrationReview = form.template !== "custom";
  const isResearchTemplate = form.template === "general_research";
  const normalizedSavedWorkspace = savedWorkspacePath?.trim() ?? "";
  const normalizedWizardWorkspace = form.repoPath.trim();
  const workspaceDiffersFromSavedDefault =
    normalizedWizardWorkspace.length > 0 &&
    normalizedWizardWorkspace !== normalizedSavedWorkspace;
  const workspaceNeedsGitInit = Boolean(
    workspaceStatus &&
    workspaceStatus.exists &&
    workspaceStatus.isDirectory &&
    !workspaceStatus.isGitRepository,
  );
  const workspaceMissing = Boolean(
    workspaceStatus && normalizedWizardWorkspace && !workspaceStatus.exists,
  );
  const workspaceNotDirectory = Boolean(
    workspaceStatus && workspaceStatus.exists && !workspaceStatus.isDirectory,
  );

  useEffect(() => {
    if (open) {
      setActiveTab("basics");
    }
  }, [open, form.template]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!normalizedWizardWorkspace) {
      setWorkspaceStatus(null);
      setInspectingWorkspace(false);
      return;
    }

    let cancelled = false;
    setInspectingWorkspace(true);

    void onInspectWorkspace(normalizedWizardWorkspace)
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
  }, [normalizedWizardWorkspace, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm((current) => {
      let changed = false;
      const nextModels = current.models.map((model) => {
        let nextModel = model;
        const providerId = model.provider.trim() || "ollama";
        const providerOption = providerOptionsById.get(providerId);

        if (providerId !== model.provider) {
          nextModel = { ...nextModel, provider: providerId };
          changed = true;
        }

        if (providerId === "ollama") {
          const nextName =
            localModelOptions.find((option) => option === model.name.trim()) ??
            localModelOptions[0] ??
            combinedModelOptions[0] ??
            model.name;

          if (nextName && nextName !== nextModel.name) {
            nextModel = { ...nextModel, name: nextName };
            changed = true;
          }

          if (nextModel.endpoint !== "http://localhost:11434") {
            nextModel = {
              ...nextModel,
              endpoint: "http://localhost:11434",
            };
            changed = true;
          }
        } else if (providerOption) {
          if (!nextModel.endpoint.trim() && providerOption.endpoint) {
            nextModel = {
              ...nextModel,
              endpoint: providerOption.endpoint,
            };
            changed = true;
          }

          if (!nextModel.name.trim() && providerOption.defaultModelName) {
            nextModel = {
              ...nextModel,
              name: providerOption.defaultModelName,
            };
            changed = true;
          }
        }

        return nextModel;
      });

      return changed ? { ...current, models: nextModels } : current;
    });
  }, [
    combinedModelOptions,
    localModelOptions,
    open,
    providerOptionsById,
    setForm,
  ]);

  if (!open) {
    return null;
  }

  const applyTemplate = (template: WizardTemplate) => {
    setForm((current) => applyWizardTemplate(current, template));
    setActiveTab("basics");
  };

  const updateModelProvider = (index: number, nextProviderId: string) => {
    const providerOption = providerOptionsById.get(nextProviderId);
    const nextLocalModel =
      localModelOptions[0] ?? combinedModelOptions[0] ?? "";

    setForm((current) => ({
      ...current,
      models: current.models.map((entry, modelIndex) => {
        if (modelIndex !== index) {
          return entry;
        }

        return {
          ...entry,
          provider: nextProviderId,
          endpoint:
            nextProviderId === "ollama"
              ? "http://localhost:11434"
              : providerOption?.endpoint || entry.endpoint,
          name:
            nextProviderId === "ollama"
              ? nextLocalModel || entry.name
              : providerOption?.defaultModelName || entry.name,
        };
      }),
    }));
  };

  const renderModelNameField = (model: WizardModelForm, index: number) => {
    const isLocalProvider = model.provider === "ollama";
    const localOptions =
      localModelOptions.length > 0 ? localModelOptions : combinedModelOptions;

    if (isLocalProvider && localOptions.length > 0) {
      return (
        <select
          value={model.name}
          onChange={(event) => updateModel(index, "name", event.target.value)}
          className={textFieldClass}
        >
          {localOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        value={model.name}
        onChange={(event) => updateModel(index, "name", event.target.value)}
        className={textFieldClass}
        type="text"
      />
    );
  };

  const chooseWorkspaceFolder = async () => {
    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    setForm((current) => ({
      ...current,
      repoPath: selectedPath,
    }));
  };

  return (
    <div className="fixed inset-0 z-[140] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
          <div className="flex items-start justify-between gap-6 border-b border-white/5 bg-white/5 px-6 py-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                Blueprint Wizard
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                {isEditMode
                  ? "Edit an existing workflow"
                  : "Create a valid starter blueprint"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                {isEditMode
                  ? "Load a runnable workflow back into the wizard, tweak its structure, and save the TOML in place without dropping into manual editing first."
                  : "Organize the workflow in focused tabs, keep the setup-backed model choices visible, and generate a runnable TOML file without dropping into raw configuration first."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className={secondaryButtonClass}
            >
              Close
            </button>
          </div>

          <div className="space-y-6 p-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {TEMPLATE_ORDER.map((template) => {
                const defaults = wizardTemplateDefaults(template);
                const active = form.template === template;

                return (
                  <button
                    key={template}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className={`rounded-xl border px-4 py-4 text-left transition ${
                      active
                        ? "border-amber-400/40 bg-amber-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-100">
                      {defaults.label}
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-400">
                      {defaults.description}
                    </div>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      {defaults.language} • {defaults.targetFiles[0]}
                    </div>
                  </button>
                );
              })}
            </div>

            {showHydrationReview ? (
              <div className="rounded-xl border border-teal-400/15 bg-teal-500/[0.06] px-4 py-4">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-200">
                  Template Hydration Review
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  This template generates a runnable workflow in the desktop
                  blueprint directory instead of loading the starter template
                  directly.
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-slate-400 md:grid-cols-3">
                  <div>
                    <span className="font-semibold text-slate-200">
                      Workspace:
                    </span>{" "}
                    {form.repoPath || "Not set"}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-200">
                      Language:
                    </span>{" "}
                    {form.language || "Not set"}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-200">
                      Primary model:
                    </span>{" "}
                    {form.models[0]?.name || "Not set"}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
              {TAB_ORDER.map((tab) => (
                <TabButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  label={tab.label}
                  copy={tab.copy}
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>

            {activeTab === "basics" ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className={sectionCardClass}>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Workflow Identity
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Keep the top-level metadata compact and readable.
                    </div>
                  </div>

                  <div>
                    <FieldLabel label="Blueprint Name" />
                    <input
                      value={form.name}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="my-awesome-blueprint"
                      className={textFieldClass}
                      type="text"
                    />
                  </div>

                  <div>
                    <FieldLabel label="Description" />
                    <textarea
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      rows={4}
                      className={textAreaClass}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <FieldLabel label="Repo Path" />
                        {inspectingWorkspace ? (
                          <StatusChip label="Inspecting" tone="slate" />
                        ) : workspaceMissing ? (
                          <StatusChip label="Missing" tone="rose" />
                        ) : workspaceNotDirectory ? (
                          <StatusChip label="Not Folder" tone="rose" />
                        ) : workspaceNeedsGitInit ? (
                          <StatusChip label="Needs Init" tone="amber" />
                        ) : workspaceStatus?.isGitRepository ? (
                          <StatusChip label="Git Ready" tone="emerald" />
                        ) : null}
                        {workspaceDiffersFromSavedDefault ? (
                          <StatusChip label="Differs Default" tone="slate" />
                        ) : null}
                      </div>
                      <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                        <div className="break-all text-sm text-slate-200">
                          {form.repoPath || "No workspace folder selected yet."}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void chooseWorkspaceFolder()}
                            className={secondaryButtonClass}
                          >
                            Choose Folder
                          </button>
                          {form.repoPath ? (
                            <button
                              type="button"
                              onClick={() =>
                                setForm((current) => ({
                                  ...current,
                                  repoPath: "",
                                }))
                              }
                              className={secondaryButtonClass}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {normalizedWizardWorkspace ? (
                        <div
                          className={`mt-3 rounded-lg border px-3 py-3 text-xs leading-relaxed ${workspaceMissing || workspaceNotDirectory ? "border-rose-400/20 bg-rose-500/10 text-rose-100" : workspaceNeedsGitInit || workspaceDiffersFromSavedDefault ? "border-amber-300/20 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"}`}
                        >
                          {inspectingWorkspace ? (
                            <div>
                              Inspecting folder and repository status...
                            </div>
                          ) : workspaceMissing ? (
                            <div>
                              This path does not exist yet. You can still save
                              the workflow, but runs will fail until the folder
                              exists.
                            </div>
                          ) : workspaceNotDirectory ? (
                            <div>
                              This path is not a folder. Pick a workspace
                              directory instead of a file.
                            </div>
                          ) : workspaceNeedsGitInit &&
                            workspaceDiffersFromSavedDefault ? (
                            <div>
                              This folder is not a git repository and it differs
                              from the saved default workspace. After save,
                              Maabarium will ask whether to initialize git here
                              and whether this should replace the global default
                              workspace.
                            </div>
                          ) : workspaceNeedsGitInit ? (
                            <div>
                              This folder is not a git repository. After save,
                              Maabarium will ask whether to initialize git here
                              before you run the workflow.
                            </div>
                          ) : workspaceDiffersFromSavedDefault ? (
                            <div>
                              This workflow points at a different folder than
                              the saved default workspace. After save, Maabarium
                              will ask whether to make it the new global
                              default.
                            </div>
                          ) : workspaceStatus?.isGitRepository ? (
                            <div>
                              Repository detected
                              {workspaceStatus.repositoryRoot
                                ? ` at ${workspaceStatus.repositoryRoot}`
                                : "."}{" "}
                              This already matches the saved default workspace.
                            </div>
                          ) : (
                            <div>The selected folder is ready to save.</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <FieldLabel label="Version" />
                      <input
                        value={form.version}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            version: event.target.value,
                          }))
                        }
                        className={textFieldClass}
                        type="text"
                      />
                    </div>
                  </div>
                </div>

                <div className={sectionCardClass}>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Scope Hints
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {isResearchTemplate
                        ? "General research keeps language and target files as optional scoping hints. They are there for cases where you want research outputs organized by domain or written back into specific repo areas."
                        : "These defaults shape where the workflow looks and what it treats as in-scope."}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel
                        label={
                          isResearchTemplate ? "Research Domain" : "Language"
                        }
                        help={
                          isResearchTemplate
                            ? "Research workflows can leave this broad. Use it when you want the generated workflow to carry an explicit domain label such as policy, product, or security."
                            : "The language value is written into the blueprint domain metadata and drives filtering in the workflow library."
                        }
                      />
                      <input
                        value={form.language}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            language: event.target.value,
                          }))
                        }
                        className={textFieldClass}
                        type="text"
                      />
                    </div>
                    <div>
                      <FieldLabel
                        label="Target Files"
                        help="Comma or newline separated glob patterns."
                      />
                      <textarea
                        value={form.targetFilesText}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            targetFilesText: event.target.value,
                          }))
                        }
                        rows={4}
                        className={textAreaClass}
                      />
                    </div>
                  </div>

                  {isResearchTemplate ? (
                    <FieldHint>
                      Research templates default to documentation-style output
                      paths so you can capture sourced briefs without forcing
                      code-specific targeting.
                    </FieldHint>
                  ) : null}
                </div>
              </div>
            ) : null}

            {activeTab === "evaluation" ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className={sectionCardClass}>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Constraints
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Runtime guardrails and acceptance thresholds for the loop.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel label="Max Iterations" />
                      <input
                        value={form.maxIterations}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            maxIterations: Number(event.target.value) || 0,
                          }))
                        }
                        className={textFieldClass}
                        type="number"
                        min={1}
                      />
                    </div>
                    <div>
                      <FieldLabel label="Timeout Seconds" />
                      <input
                        value={form.timeoutSeconds}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            timeoutSeconds: Number(event.target.value) || 0,
                          }))
                        }
                        className={textFieldClass}
                        type="number"
                        min={1}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel label="Min Improvement" />
                      <input
                        value={form.minImprovement}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            minImprovement: Number(event.target.value) || 0,
                          }))
                        }
                        className={textFieldClass}
                        type="number"
                        min={0}
                        step="0.01"
                      />
                    </div>
                    <div>
                      <FieldLabel label="Require Tests Pass" />
                      <select
                        value={form.requireTestsPass ? "true" : "false"}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            requireTestsPass: event.target.value === "true",
                          }))
                        }
                        className={textFieldClass}
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className={sectionCardClass}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Metrics
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Current metric weight total:{" "}
                        {metricWeightTotal.toFixed(2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addMetric}
                      className={secondaryButtonClass}
                    >
                      Add Metric
                    </button>
                  </div>

                  <div className="space-y-4">
                    {form.metrics.map((metric, index) => (
                      <div
                        key={`${metric.name}-${index}`}
                        className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4"
                      >
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_8rem_10rem_auto]">
                          <div>
                            <FieldLabel label="Metric Name" />
                            <input
                              value={metric.name}
                              onChange={(event) =>
                                updateMetric(index, "name", event.target.value)
                              }
                              className={textFieldClass}
                              type="text"
                            />
                          </div>
                          <div>
                            <FieldLabel label="Weight" />
                            <input
                              value={metric.weight}
                              onChange={(event) =>
                                updateMetric(
                                  index,
                                  "weight",
                                  Number(event.target.value) || 0,
                                )
                              }
                              className={textFieldClass}
                              type="number"
                              step="0.01"
                              min={0}
                            />
                          </div>
                          <div>
                            <FieldLabel label="Direction" />
                            <select
                              value={metric.direction}
                              onChange={(event) =>
                                updateMetric(
                                  index,
                                  "direction",
                                  event.target.value,
                                )
                              }
                              className={textFieldClass}
                            >
                              <option value="maximize">Maximize</option>
                              <option value="minimize">Minimize</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => removeMetric(index)}
                              disabled={form.metrics.length <= 1}
                              className={secondaryButtonClass}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="mt-4">
                          <FieldLabel label="Description" />
                          <textarea
                            value={metric.description}
                            onChange={(event) =>
                              updateMetric(
                                index,
                                "description",
                                event.target.value,
                              )
                            }
                            rows={3}
                            className={textAreaClass}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "agents" ? (
              <div className={sectionCardClass}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Agents
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Agent model selections are pulled from the configured
                      model pool below and prefer the choices you made during
                      setup.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addAgent}
                    className={secondaryButtonClass}
                  >
                    Add Agent
                  </button>
                </div>

                <div className="space-y-4">
                  {form.agents.map((agent, index) => (
                    <div
                      key={`${agent.name}-${index}`}
                      className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4"
                    >
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1fr)_auto]">
                        <div>
                          <FieldLabel label="Agent Name" />
                          <input
                            value={agent.name}
                            onChange={(event) =>
                              updateAgent(index, "name", event.target.value)
                            }
                            className={textFieldClass}
                            type="text"
                          />
                        </div>
                        <div>
                          <FieldLabel label="Role" />
                          <input
                            value={agent.role}
                            onChange={(event) =>
                              updateAgent(index, "role", event.target.value)
                            }
                            className={textFieldClass}
                            type="text"
                          />
                        </div>
                        <div>
                          <FieldLabel
                            label="Model"
                            help="This list is derived from the model pool tab and setup-backed local or remote defaults."
                          />
                          <select
                            value={agent.model}
                            onChange={(event) =>
                              updateAgent(index, "model", event.target.value)
                            }
                            className={textFieldClass}
                          >
                            {combinedModelOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeAgent(index)}
                            disabled={form.agents.length <= 1}
                            className={secondaryButtonClass}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="mt-4">
                        <FieldLabel label="System Prompt" />
                        <textarea
                          value={agent.systemPrompt}
                          onChange={(event) =>
                            updateAgent(
                              index,
                              "systemPrompt",
                              event.target.value,
                            )
                          }
                          rows={4}
                          className={textAreaClass}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "models" ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className={sectionCardClass}>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Assignment Strategy
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Decide how the configured pool should be consumed by the
                      loop.
                    </div>
                  </div>

                  <div>
                    <FieldLabel
                      label="Model Assignment"
                      help="Explicit keeps per-agent selection stable. Round robin rotates requests across the configured model pool."
                    />
                    <select
                      value={form.modelAssignment}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          modelAssignment: event.target.value as
                            | "explicit"
                            | "round_robin",
                        }))
                      }
                      className={textFieldClass}
                    >
                      <option value="explicit">Explicit</option>
                      <option value="round_robin">Round Robin</option>
                    </select>
                    <FieldHint>
                      Explicit means each agent keeps the exact model you
                      selected on the Agents tab. Round robin uses this pool as
                      an ordered list and rotates requests across it.
                    </FieldHint>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel label="Council Size" />
                      <input
                        value={form.councilSize}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            councilSize: Number(event.target.value) || 0,
                          }))
                        }
                        className={textFieldClass}
                        type="number"
                        min={1}
                      />
                    </div>
                    <div>
                      <FieldLabel label="Debate Rounds" />
                      <input
                        value={form.debateRounds}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            debateRounds: Number(event.target.value) || 0,
                          }))
                        }
                        className={textFieldClass}
                        type="number"
                        min={1}
                      />
                    </div>
                  </div>
                </div>

                <div className={sectionCardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        Model Pool
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Local Ollama entries use setup-backed model choices.
                        Remote entries keep an editable model name because
                        providers may expose many possible model ids.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addModel}
                      className={secondaryButtonClass}
                    >
                      Add Model
                    </button>
                  </div>

                  <div className="space-y-4">
                    {form.models.map((model, index) => (
                      <div
                        key={`${model.provider}-${model.name}-${index}`}
                        className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-4"
                      >
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto]">
                          <div>
                            <FieldLabel
                              label="Provider"
                              help="Choose the runtime that serves this model entry. Local Ollama entries become dropdown-backed when setup has discovered local models."
                            />
                            <select
                              value={model.provider}
                              onChange={(event) =>
                                updateModelProvider(index, event.target.value)
                              }
                              className={textFieldClass}
                            >
                              {providerOptions.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <FieldLabel
                              label="Model Name"
                              help="For local Ollama providers this is a validated dropdown. For remote providers it stays editable because the provider may support more model ids than the saved defaults expose."
                            />
                            {renderModelNameField(model, index)}
                          </div>

                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => removeModel(index)}
                              disabled={form.models.length <= 1}
                              className={secondaryButtonClass}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 text-xs text-slate-500">
                          This model entry is part of the shared pool used by
                          the assignment strategy above.
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                          <div>
                            <FieldLabel
                              label="Endpoint"
                              help="The runtime endpoint used to reach the provider. Ollama defaults to localhost; remote providers inherit the saved endpoint but can be overridden here."
                            />
                            <input
                              value={model.endpoint}
                              onChange={(event) =>
                                updateModel(
                                  index,
                                  "endpoint",
                                  event.target.value,
                                )
                              }
                              className={textFieldClass}
                              type="text"
                            />
                          </div>
                          <div>
                            <FieldLabel
                              label="API Key Env"
                              help="Optional environment variable name for provider auth when the runtime expects one."
                            />
                            <input
                              value={model.apiKeyEnv}
                              onChange={(event) =>
                                updateModel(
                                  index,
                                  "apiKeyEnv",
                                  event.target.value,
                                )
                              }
                              className={textFieldClass}
                              type="text"
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                          <div>
                            <FieldLabel
                              label="Temperature"
                              help="Sampling temperature for this model entry. Lower values are more deterministic."
                            />
                            <input
                              value={model.temperature}
                              onChange={(event) =>
                                updateModel(
                                  index,
                                  "temperature",
                                  Number(event.target.value) || 0,
                                )
                              }
                              className={textFieldClass}
                              type="number"
                              step="0.1"
                              min={0}
                            />
                          </div>
                          <div>
                            <FieldLabel
                              label="Max Tokens"
                              help="Upper bound for completion length when the provider supports a max token parameter."
                            />
                            <input
                              value={model.maxTokens}
                              onChange={(event) =>
                                updateModel(
                                  index,
                                  "maxTokens",
                                  Number(event.target.value) || 0,
                                )
                              }
                              className={textFieldClass}
                              type="number"
                              min={1}
                            />
                          </div>
                          <div>
                            <FieldLabel
                              label="Requests / Minute"
                              help="Optional throttle for providers with hard rate limits. Leave blank when you do not need a per-model cap."
                            />
                            <input
                              value={model.requestsPerMinute}
                              onChange={(event) =>
                                updateModel(
                                  index,
                                  "requestsPerMinute",
                                  event.target.value,
                                )
                              }
                              className={textFieldClass}
                              type="text"
                              inputMode="numeric"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/5 bg-white/[0.03] px-6 py-4">
            <div className="text-xs text-slate-500">
              {isEngineRunning
                ? "Stop the run loop before modifying a blueprint."
                : isEditMode
                  ? "The updated TOML is saved back to the existing workflow file."
                  : "The generated TOML is written into the desktop blueprints directory and loaded immediately."}
              {normalizedWizardWorkspace &&
              !isEngineRunning &&
              (workspaceNeedsGitInit || workspaceDiffersFromSavedDefault)
                ? " Workspace follow-up choices will be shown immediately after save."
                : ""}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isCreating}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isCreating || isEngineRunning}
                className={accentButtonClass}
              >
                {isCreating
                  ? isEditMode
                    ? "Saving..."
                    : "Generating..."
                  : isEditMode
                    ? "Save Changes"
                    : showHydrationReview
                      ? "Generate Workflow"
                      : "Create Blueprint"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
