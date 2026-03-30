import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cpu,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Save,
  Search,
  Settings2,
  Target,
  type LucideIcon,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Component,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyWizardDeliverable,
  applyWizardGoal,
  applyWizardTemplate,
  inferWizardDeliverableFromForm,
  inferWizardGoalFromForm,
  normalizeWizardForm,
  parseWizardTargetFilesText,
  wizardDeliverableOptions,
  wizardEvaluatorLabel,
  wizardGoalOptions,
  wizardTargetMode,
  wizardTemplateDefaults,
} from "../../lib/blueprints";
import type {
  BlueprintWizardForm,
  WorkspaceGitStatus,
  WizardAgentForm,
  WizardDeliverable,
  WizardGoal,
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

type WizardStep = "goal" | "output" | "workspace" | "runtime" | "review";

type WizardTipItem = {
  title: string;
  body: string;
};

type WizardTipSection = {
  title: string;
  copy: string;
  items: WizardTipItem[];
};

const TAB_ORDER: Array<{ id: WizardTab; label: string; copy: string }> = [
  {
    id: "basics",
    label: "Basics",
    copy: "Workflow type, output shape, and workspace scope.",
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

const WIZARD_STEPS: Array<{
  id: WizardStep;
  label: string;
  copy: string;
}> = [
  {
    id: "goal",
    label: "Goal",
    copy: "Pick the outcome family before touching low-level blueprint fields.",
  },
  {
    id: "output",
    label: "Output",
    copy: "Choose whether the workflow should target one file or a broader file family.",
  },
  {
    id: "workspace",
    label: "Workspace",
    copy: "Confirm where the workflow runs and where its outputs are allowed to land.",
  },
  {
    id: "runtime",
    label: "Runtime",
    copy: "Tune guardrails, evaluation thresholds, and council behavior.",
  },
  {
    id: "review",
    label: "Review",
    copy: "Verify the derived workflow summary before saving the generated TOML.",
  },
];

const BASE_WIZARD_TIP_SECTIONS: WizardTipSection[] = [
  {
    title: "Workflow Design",
    copy: "Start with the outcome you want to keep, then narrow the workflow until it has one obvious job.",
    items: [
      {
        title: "Give the workflow one durable goal",
        body: "If the workflow sounds like two different jobs, split it. Clearer goals produce steadier scoring and less drift inside the council.",
      },
      {
        title: "Match the output shape to the scope",
        body: "Use one exact relative path for a named document or prompt. Use globs only when the workflow truly needs to operate across an existing file family.",
      },
      {
        title: "Prefer reviewable proposals",
        body: "The easiest workflows to tune are the ones that produce narrow, legible changes you can understand quickly.",
      },
    ],
  },
  {
    title: "Agent Behaviour",
    copy: "Agent prompts should describe how the council should work, not only who the agents are.",
    items: [
      {
        title: "State the working style directly",
        body: "If agents should work incrementally, say that plainly with rules like 'revise one section at a time' or 'avoid full rewrites'.",
      },
      {
        title: "Use distinct responsibilities",
        body: "A strong council usually has one agent narrowing scope, one turning that scope into changes, and one challenging risk, ambiguity, or overreach.",
      },
      {
        title: "Prefer constraints over personality",
        body: "Prompt rules such as 'keep proposals narrow' or 'return a compact scaffold first' are more useful than tone or persona instructions.",
      },
      {
        title: "Define what detailed output means",
        body: "If you want an implementation document instead of a pitch summary, name the required sections, the expected depth in each section, and the concrete planning details the first accepted draft must already include.",
      },
    ],
  },
];

const GUIDED_STEP_TIP_SECTIONS: Record<WizardStep, WizardTipSection> = {
  goal: {
    title: "Goal Step Tips",
    copy: "Choose the workflow family by the retained result, not by the tool or model you happen to use.",
    items: [
      {
        title: "Describe the saved outcome",
        body: "A good goal sounds like the artifact you want after the run: a tighter code path, a named document, a sourced brief, or a validated package.",
      },
      {
        title: "Keep the description outcome-focused",
        body: "Use the description to define what success looks like. Avoid packing runtime settings, target paths, and model preferences into the same paragraph.",
      },
    ],
  },
  output: {
    title: "Output Step Tips",
    copy: "The more precise the deliverable shape, the easier it is for the workflow to stay stable across iterations.",
    items: [
      {
        title: "Exact paths are safer for named documents",
        body: "If the workflow should create or refine one specific markdown file, point it at that exact path instead of a broad docs glob.",
      },
      {
        title: "Match the path to the deliverable contract",
        body: "When the target is one implementation plan, say whether the first accepted draft should be a substantial v1 or only a starter outline. Do not leave that tradeoff implicit.",
      },
      {
        title: "Globs fit existing trees",
        body: "Use globs for source or document directories only when the job genuinely needs to inspect or improve many existing files.",
      },
    ],
  },
  workspace: {
    title: "Workspace Step Tips",
    copy: "The repo path, evaluator, and target paths should all describe the same job.",
    items: [
      {
        title: "Keep writes inside the chosen workspace",
        body: "If a target path feels like it belongs to another repo or docs tree, the workflow shape is probably off before the model even runs.",
      },
      {
        title: "Treat status cards as preflight checks",
        body: "Missing folders, non-directory paths, or missing git setup are operational problems. Fix them before debugging model behavior.",
      },
    ],
  },
  runtime: {
    title: "Runtime Step Tips",
    copy: "Runtime settings should reinforce the workflow design instead of compensating for an unclear scope.",
    items: [
      {
        title: "Smaller councils are often clearer",
        body: "When the workflow is refining one document or one code path, fewer agents and debate rounds usually produce cleaner proposals than a large noisy council.",
      },
      {
        title: "Proposal size follows model limits",
        body: "If a model keeps truncating or returning malformed JSON, either shrink proposal scope or raise the relevant token budget. Do not depend on oversized all-at-once patches.",
      },
    ],
  },
  review: {
    title: "Review Step Tips",
    copy: "Before saving, check that the summary still reads like one understandable workflow.",
    items: [
      {
        title: "Look for mismatched signals",
        body: "A markdown workflow with source-tree globs or a code workflow with one exact docs path is usually a sign that the template or deliverable should be revisited.",
      },
      {
        title: "If the summary feels busy, simplify",
        body: "The best workflows usually look almost obvious in summary form. If the review card feels crowded, narrow the scope before saving.",
      },
    ],
  },
};

const ADVANCED_TAB_TIP_SECTIONS: Record<WizardTab, WizardTipSection> = {
  basics: {
    title: "Advanced Basics Tips",
    copy: "These raw fields are still part of the workflow contract, even when the guided flow derived most of them for you.",
    items: [
      {
        title: "Use language as an evaluator hint",
        body: "Language helps Maabarium choose safer proposal and evaluation behavior. Keep it aligned with the actual output type.",
      },
      {
        title: "Keep target paths intentional",
        body: "If you cannot explain why a path belongs in the workflow, remove it. Every extra target gives the council more room to drift.",
      },
    ],
  },
  evaluation: {
    title: "Advanced Evaluation Tips",
    copy: "Metrics should reward the one thing the workflow is trying to improve, not every nice-to-have quality at once.",
    items: [
      {
        title: "Use metrics that can disagree productively",
        body: "Helpful metrics separate concerns such as clarity, coherence, and risk quality instead of hiding everything inside one generic quality score.",
      },
      {
        title: "Keep thresholds realistic",
        body: "If minimum improvement is too high, narrow but valuable changes can be rejected even when the workflow is moving in the right direction.",
      },
    ],
  },
  agents: {
    title: "Advanced Agent Tips",
    copy: "This is the best place to encode how the council should behave when workflows are prone to oversized or noisy proposals.",
    items: [
      {
        title: "Tell agents to work incrementally when size matters",
        body: "For one named markdown file, prompts like 'create a compact scaffold first' and 'deepen one section at a time' are much safer than asking for a complete long-form rewrite.",
      },
      {
        title: "Say when the first draft must already be substantial",
        body: "If you need more than an outline, tell the council that the first accepted draft must include concrete architecture, milestones, dependencies, risks, and open questions rather than headings with placeholder bullets.",
      },
      {
        title: "Differentiate strategist, builder, and critic roles",
        body: "A strategist should narrow scope, a builder should turn that scope into edits, and a critic should call out ambiguity, risk, or overreach.",
      },
      {
        title: "Use prohibitions when failure patterns are known",
        body: "If a workflow keeps generating oversized proposals, add direct rules such as 'avoid full-document rewrites' or 'return a focused section edit instead'.",
      },
    ],
  },
  models: {
    title: "Advanced Model Tips",
    copy: "Model entries are not just connectivity settings; they directly affect proposal fidelity, pacing, and council stability.",
    items: [
      {
        title: "Token budgets should match the workflow shape",
        body: "Larger document workflows need larger proposal budgets than narrow code edits. If a model truncates JSON, either shrink proposal scope or raise the max token setting.",
      },
      {
        title: "Deterministic settings usually help patch quality",
        body: "Lower temperature is usually better when the model must produce strict JSON or exact diffs. Save higher variance for ideation-heavy tasks.",
      },
    ],
  },
};

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

function StepButton({
  active,
  completed,
  enabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  completed: boolean;
  enabled: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
        active
          ? "border-teal-400/35 bg-teal-500/10 text-teal-50"
          : completed
            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
            : enabled
              ? "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.05]"
              : "cursor-not-allowed border-white/10 bg-white/[0.02] text-slate-600"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black uppercase tracking-[0.16em] ${
          active
            ? "border-teal-400/40 bg-teal-500/15 text-teal-100"
            : completed
              ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-100"
              : enabled
                ? "border-white/10 bg-slate-950/60 text-slate-300"
                : "border-white/5 bg-white/[0.03] text-slate-600"
        }`}
      >
        {completed && !active ? <CheckCircle2 size={14} /> : <Icon size={14} />}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-[0.18em]">
          {label}
        </div>
      </div>
    </button>
  );
}

function SummaryRow({
  label,
  value,
  icon: Icon,
  active,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition ${
        active
          ? "border-teal-400/25 bg-teal-500/10"
          : "border-white/10 bg-slate-950/50"
      }`}
    >
      <div
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-teal-400 text-slate-950" : "bg-white/5 text-slate-400"
        }`}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div
          className={`text-[10px] font-black uppercase tracking-[0.16em] ${
            active ? "text-teal-200" : "text-slate-500"
          }`}
        >
          {label}
        </div>
        <div className="mt-1 break-words text-sm text-slate-100 [overflow-wrap:anywhere]">
          {value}
        </div>
      </div>
    </div>
  );
}

function buildWizardTipSections({
  activeStep,
  activeTab,
  showAdvancedControls,
  targetMode,
  normalizedLanguage,
}: {
  activeStep: WizardStep;
  activeTab: WizardTab;
  showAdvancedControls: boolean;
  targetMode: ReturnType<typeof wizardTargetMode>;
  normalizedLanguage: string;
}) {
  const sections = [...BASE_WIZARD_TIP_SECTIONS];

  sections.push(
    showAdvancedControls
      ? ADVANCED_TAB_TIP_SECTIONS[activeTab]
      : GUIDED_STEP_TIP_SECTIONS[activeStep],
  );

  if (
    targetMode === "exact" &&
    ["markdown", "prompt"].includes(normalizedLanguage)
  ) {
    sections.push({
      title: "Incremental Document Tip",
      copy: "Exact single-document workflows are where incremental agent instructions help the most.",
      items: [
        {
          title: "Ask for a scaffold first",
          body: "When the target is one named markdown file, tell agents to create a compact outline or heading scaffold first instead of a full long-form draft.",
        },
        {
          title: "Deepen one section per iteration",
          body: "Prompts such as 'revise one section or one tightly related cluster of lines at a time' keep proposals smaller, clearer, and less likely to truncate.",
        },
        {
          title: "Spell out the minimum depth you expect",
          body: "If the first retained result should already be useful, say so explicitly with requirements like named subsystems, milestone exit criteria, risk mitigations, open questions, and concrete implementation notes in every major section.",
        },
      ],
    });
  }

  return sections;
}

type WizardRenderBoundaryProps = {
  children: ReactNode;
  onClose: () => void;
};

type WizardRenderBoundaryState = {
  error: Error | null;
};

class WizardRenderBoundary extends Component<
  WizardRenderBoundaryProps,
  WizardRenderBoundaryState
> {
  state: WizardRenderBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): WizardRenderBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: WizardRenderBoundaryProps) {
    if (this.state.error && previousProps.children !== this.props.children) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-6 py-6 text-rose-50 shadow-2xl">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-200">
            Blueprint Wizard
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight">
            The wizard hit a runtime problem
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-rose-100/90">
            The modal stayed open, but one of the live values it received was
            not valid enough to render safely. Close it, reopen it, and keep the
            current desktop state if the problem returns.
          </p>
          <div className="mt-4 rounded-xl border border-rose-300/20 bg-slate-950/40 px-4 py-3 text-xs leading-relaxed text-rose-100/85">
            {this.state.error.message || "Unknown wizard render error."}
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={this.props.onClose}
              className={secondaryButtonClass}
            >
              Close
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const WIZARD_STEP_ICONS: Record<WizardStep, LucideIcon> = {
  goal: Target,
  output: FileText,
  workspace: FolderOpen,
  runtime: Cpu,
  review: Save,
};

const WIZARD_GOAL_ICONS: Record<WizardGoal, LucideIcon> = {
  code_improvement: Target,
  application_change: LayoutDashboard,
  document_workflow: FileText,
  research_brief: Search,
  lora_validation: Cpu,
  custom_workflow: Settings2,
};

function deliverableIcon(
  deliverable: WizardDeliverable,
  goal: WizardGoal,
  targetFiles: string[],
): LucideIcon {
  if (goal === "research_brief") {
    return Search;
  }

  if (goal === "lora_validation") {
    return Cpu;
  }

  if (goal === "custom_workflow") {
    return Settings2;
  }

  return wizardTargetMode(targetFiles) === "exact" ? FileText : FolderOpen;
}

function BlueprintWizardModalBody({
  open,
  isCreating,
  isEngineRunning,
  form: rawForm,
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
  const [activeStep, setActiveStep] = useState<WizardStep>("goal");
  const [activeTab, setActiveTab] = useState<WizardTab>("basics");
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showTipsPanel, setShowTipsPanel] = useState(false);
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceGitStatus | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false);
  const form = useMemo(() => normalizeWizardForm(rawForm), [rawForm]);

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
  const primaryModelOptions = useMemo(
    () =>
      uniqueStrings([
        ...form.models.map((model) => model.name),
        ...combinedModelOptions,
      ]).map((modelName) => {
        const existingModel = form.models.find(
          (model) => model.name.trim() === modelName,
        );
        const providerId = existingModel?.provider.trim();
        const inferredProviderLabel = localModelOptions.includes(modelName)
          ? "Ollama Local"
          : providerOptions.find(
              (provider) => provider.defaultModelName.trim() === modelName,
            )?.label;
        const providerLabel =
          providerOptionsById.get(providerId ?? "")?.label ||
          inferredProviderLabel ||
          providerId ||
          "Model";

        return {
          value: modelName,
          label: `${providerLabel} • ${modelName.trim() || "Unnamed model"}`,
        };
      }),
    [
      combinedModelOptions,
      form.models,
      localModelOptions,
      providerOptions,
      providerOptionsById,
    ],
  );

  const selectedGoal = useMemo<WizardGoal>(
    () => inferWizardGoalFromForm(form),
    [form],
  );
  const selectedDeliverable = useMemo<WizardDeliverable>(
    () => inferWizardDeliverableFromForm(form),
    [form],
  );
  const deliverableOptions = useMemo(
    () => wizardDeliverableOptions(selectedGoal),
    [selectedGoal],
  );
  const normalizedLanguage = form.language?.trim() ?? "";
  const normalizedTargetFilesText = form.targetFilesText ?? "";
  const safeRepoPath = form.repoPath ?? "";
  const safeMetricCount = Array.isArray(form.metrics) ? form.metrics.length : 0;
  const safeAgentCount = Array.isArray(form.agents) ? form.agents.length : 0;
  const safeModelCount = Array.isArray(form.models) ? form.models.length : 0;
  const primaryModelName = form.models[0]?.name?.trim() || "Not set";
  const targetFiles = useMemo(
    () => parseWizardTargetFilesText(normalizedTargetFilesText),
    [normalizedTargetFilesText],
  );
  const targetMode = useMemo(
    () => wizardTargetMode(targetFiles),
    [targetFiles],
  );
  const evaluatorLabel = useMemo(
    () => wizardEvaluatorLabel(normalizedLanguage),
    [normalizedLanguage],
  );
  const wizardTipSections = useMemo(
    () =>
      buildWizardTipSections({
        activeStep,
        activeTab,
        showAdvancedControls,
        targetMode,
        normalizedLanguage,
      }),
    [
      activeStep,
      activeTab,
      normalizedLanguage,
      showAdvancedControls,
      targetMode,
    ],
  );
  const tipsContextLabel = showAdvancedControls
    ? `Advanced ${TAB_ORDER.find((tab) => tab.id === activeTab)?.label ?? "Panel"}`
    : `Guided ${WIZARD_STEPS.find((step) => step.id === activeStep)?.label ?? "Step"}`;

  const showHydrationReview = form.template !== "custom";
  const isResearchTemplate = form.template === "general_research";
  const normalizedSavedWorkspace = savedWorkspacePath?.trim() ?? "";
  const normalizedWizardWorkspace = safeRepoPath.trim();
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
      setActiveStep("goal");
      setActiveTab("basics");
      setShowAdvancedControls(false);
      setShowTipsPanel(false);
      setFurthestStepIndex(isEditMode ? WIZARD_STEPS.length - 1 : 0);
    }
  }, [isEditMode, open]);

  useEffect(() => {
    if (
      activeStep === "goal" ||
      activeStep === "output" ||
      activeStep === "workspace"
    ) {
      setActiveTab("basics");
      return;
    }

    if (activeStep === "runtime") {
      setActiveTab("evaluation");
      return;
    }

    setActiveTab("evaluation");
  }, [activeStep]);

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
      const normalizedCurrent = normalizeWizardForm(current);
      let changed = false;
      const nextModels = normalizedCurrent.models.map((model) => {
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

      return changed
        ? normalizeWizardForm({ ...normalizedCurrent, models: nextModels })
        : current;
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

  const applyGoal = (goal: WizardGoal) => {
    setForm((current) => applyWizardGoal(current, goal));
  };

  const applyDeliverable = (deliverable: WizardDeliverable) => {
    setForm((current) => applyWizardDeliverable(current, deliverable));
    setActiveStep("workspace");
  };

  const updatePrimaryModel = (selectedModelName: string) => {
    setForm((current) => {
      const normalizedCurrent = normalizeWizardForm(current);
      const selectedIndex = normalizedCurrent.models.findIndex(
        (model) => model.name.trim() === selectedModelName,
      );
      const existingModel =
        selectedIndex >= 0 ? normalizedCurrent.models[selectedIndex] : null;
      const matchingProviderOption = providerOptions.find(
        (provider) => provider.defaultModelName.trim() === selectedModelName,
      );
      const nextPrimaryModel = existingModel
        ? existingModel
        : {
            ...(normalizedCurrent.models[0] ?? {
              name: selectedModelName,
              provider: "ollama",
              endpoint: "http://localhost:11434",
              apiKeyEnv: "",
              temperature: 0.7,
              maxTokens: 2048,
              requestsPerMinute: "60",
            }),
            name: selectedModelName,
            provider: localModelOptions.includes(selectedModelName)
              ? "ollama"
              : matchingProviderOption?.id ||
                normalizedCurrent.models[0]?.provider ||
                "ollama",
            endpoint: localModelOptions.includes(selectedModelName)
              ? "http://localhost:11434"
              : matchingProviderOption?.endpoint ||
                normalizedCurrent.models[0]?.endpoint ||
                "",
          };

      if (!nextPrimaryModel) {
        return normalizedCurrent;
      }

      const reorderedModels = existingModel
        ? [
            nextPrimaryModel,
            ...normalizedCurrent.models.filter(
              (_, modelIndex) => modelIndex !== selectedIndex,
            ),
          ]
        : [nextPrimaryModel, ...normalizedCurrent.models.slice(1)];
      const nextPrimaryModelName = reorderedModels[0]?.name.trim();

      if (!nextPrimaryModelName) {
        return normalizedCurrent;
      }

      return normalizeWizardForm({
        ...normalizedCurrent,
        models: reorderedModels,
        agents: normalizedCurrent.agents.map((agent) => ({
          ...agent,
          model: nextPrimaryModelName,
        })),
      });
    });
  };

  const updateModelProvider = (index: number, nextProviderId: string) => {
    const providerOption = providerOptionsById.get(nextProviderId);
    const nextLocalModel =
      localModelOptions[0] ?? combinedModelOptions[0] ?? "";

    setForm((current) => {
      const normalizedCurrent = normalizeWizardForm(current);

      return {
        ...normalizedCurrent,
        models: normalizedCurrent.models.map((entry, modelIndex) => {
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
      };
    });
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

  const stepIndex = WIZARD_STEPS.findIndex((step) => step.id === activeStep);

  useEffect(() => {
    setFurthestStepIndex((current) => Math.max(current, stepIndex));
  }, [stepIndex]);

  const canGoBack = stepIndex > 0;
  const canGoForward = stepIndex < WIZARD_STEPS.length - 1;
  const previousStep = canGoBack ? WIZARD_STEPS[stepIndex - 1]?.id : null;
  const nextStep = canGoForward ? WIZARD_STEPS[stepIndex + 1]?.id : null;

  const canOpenStep = (step: WizardStep) => {
    const requestedIndex = WIZARD_STEPS.findIndex((entry) => entry.id === step);
    return isEditMode || requestedIndex <= furthestStepIndex;
  };

  const scopeHint =
    targetMode === "exact"
      ? "One exact relative target path"
      : targetMode === "glob"
        ? "Glob-based file family"
        : targetMode === "mixed"
          ? "Mixed exact paths and globs"
          : "No target paths yet";

  const derivedSummary = [
    {
      label: "Goal",
      value:
        wizardGoalOptions().find((goal) => goal.id === selectedGoal)?.label ??
        "Custom",
    },
    {
      label: "Deliverable",
      value:
        deliverableOptions.find((option) => option.id === selectedDeliverable)
          ?.label ?? selectedDeliverable,
    },
    { label: "Evaluator", value: evaluatorLabel },
    { label: "Scope", value: scopeHint },
    { label: "Workspace", value: normalizedWizardWorkspace || "Not set" },
    { label: "Primary model", value: primaryModelName },
  ];

  const summaryRows: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    active: boolean;
  }> = [
    {
      label: "Goal",
      value: derivedSummary[0]?.value ?? "Not set",
      icon: Target,
      active: activeStep === "goal" || activeStep === "review",
    },
    {
      label: "Output",
      value: `${derivedSummary[1]?.value ?? "Not set"} • ${derivedSummary[3]?.value ?? "Not set"}`,
      icon: FileText,
      active: activeStep === "output" || activeStep === "review",
    },
    {
      label: "Workspace",
      value: derivedSummary[4]?.value ?? "Not set",
      icon: FolderOpen,
      active: activeStep === "workspace" || activeStep === "review",
    },
    {
      label: "Runtime",
      value: `${derivedSummary[2]?.value ?? "Not set"} • ${primaryModelName}`,
      icon: Cpu,
      active: activeStep === "runtime" || activeStep === "review",
    },
  ];

  const workspaceStatusLabel = inspectingWorkspace
    ? "Inspecting"
    : workspaceMissing
      ? "Missing"
      : workspaceNotDirectory
        ? "Invalid Folder"
        : workspaceNeedsGitInit
          ? "Needs Git Init"
          : workspaceStatus?.isGitRepository
            ? "Git Ready"
            : normalizedWizardWorkspace
              ? "Ready"
              : "Choose Folder";

  const workspaceStatusTone: "emerald" | "amber" | "rose" | "slate" =
    inspectingWorkspace
      ? "slate"
      : workspaceMissing || workspaceNotDirectory
        ? "rose"
        : workspaceNeedsGitInit
          ? "amber"
          : workspaceStatus?.isGitRepository || normalizedWizardWorkspace
            ? "emerald"
            : "slate";

  const runtimeStatusLabel = form.requireTestsPass
    ? "Tests Required"
    : isResearchTemplate
      ? "Research Review"
      : "Manual Review";

  const primaryActionLabel = isCreating
    ? isEditMode
      ? "Saving..."
      : "Generating..."
    : canGoForward && nextStep
      ? "Next Step"
      : isEditMode
        ? "Save Changes"
        : showHydrationReview
          ? "Generate Workflow"
          : "Create Blueprint";

  const workspaceSidebarNote = inspectingWorkspace
    ? "Inspecting folder and repository status."
    : workspaceMissing
      ? "The selected workspace path does not exist yet."
      : workspaceNotDirectory
        ? "The selected workspace path is not a folder."
        : workspaceNeedsGitInit
          ? "Git initialization will be required before the workflow can run here."
          : workspaceDiffersFromSavedDefault
            ? "This workflow points at a workspace that differs from the saved default."
            : null;

  return (
    <div className="fixed inset-0 z-[140] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
          <div className="flex items-start justify-between gap-6 border-b border-white/5 bg-white/5 px-6 py-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                Blueprint Wizard
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                {isEditMode
                  ? "Edit an existing workflow"
                  : "Create a workflow from the outcome you want"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                {isEditMode
                  ? "Load a runnable workflow back into the wizard, tweak its structure, and save the TOML in place without dropping into manual editing first."
                  : "Start from the outcome you want, then confirm workspace, output paths, evaluation rules, and models before Maabarium writes the runnable TOML file."}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTipsPanel((current) => !current)}
                aria-expanded={showTipsPanel}
                aria-controls="blueprint-wizard-tips-panel"
                className={`${secondaryButtonClass} flex items-center gap-2 ${showTipsPanel ? "border-teal-400/30 bg-teal-500/10 text-teal-100" : ""}`}
              >
                <CircleHelp size={14} />
                {showTipsPanel ? "Hide Tips" : "Show Tips"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isCreating}
                className={secondaryButtonClass}
              >
                Close
              </button>
            </div>
          </div>

          <div className="relative">
            <div
              className={`pointer-events-none absolute inset-y-0 right-0 z-20 flex w-full justify-end bg-slate-950/35 backdrop-blur-[1px] transition-opacity duration-200 ${showTipsPanel ? "opacity-100" : "opacity-0"}`}
            >
              <aside
                id="blueprint-wizard-tips-panel"
                aria-hidden={!showTipsPanel}
                className={`pointer-events-auto h-full w-full max-w-md border-l border-white/10 bg-slate-950 shadow-2xl transition-transform duration-200 ease-out ${showTipsPanel ? "translate-x-0" : "translate-x-full"}`}
              >
                <div className="flex h-full flex-col">
                  <div className="border-b border-white/10 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-200">
                          Workflow Tips
                        </div>
                        <div className="mt-2 text-sm text-slate-200">
                          Clear guidance for shaping workflow scope, agent
                          behavior, and runtime choices.
                        </div>
                        <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">
                          {tipsContextLabel}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTipsPanel(false)}
                        className={secondaryButtonClass}
                      >
                        Hide
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-slate-400">
                      This tips library is designed to grow over time. Start
                      with the current guidance, then add workflow-specific
                      rules once you know exactly how you want the council to
                      behave.
                    </div>

                    {wizardTipSections.map((section) => (
                      <div
                        key={section.title}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4"
                      >
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                          {section.title}
                        </div>
                        <div className="mt-2 text-xs leading-relaxed text-slate-400">
                          {section.copy}
                        </div>
                        <div className="mt-4 space-y-3">
                          {section.items.map((item) => (
                            <div
                              key={item.title}
                              className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-3"
                            >
                              <div className="text-sm font-semibold text-slate-100">
                                {item.title}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                                {item.body}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>

            <div className="p-6">
              <div
                className={`grid grid-cols-1 gap-6 ${showAdvancedControls ? "" : "xl:grid-cols-[minmax(0,1fr)_20rem]"}`}
              >
                <div className="space-y-6">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      Workflow Steps
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {WIZARD_STEPS.map((step, index) => (
                        <StepButton
                          key={step.id}
                          active={activeStep === step.id}
                          completed={index < stepIndex}
                          enabled={canOpenStep(step.id)}
                          icon={WIZARD_STEP_ICONS[step.id]}
                          label={step.label}
                          onClick={() => {
                            if (canOpenStep(step.id)) {
                              setActiveStep(step.id);
                            }
                          }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 text-xs leading-relaxed text-slate-500">
                      {WIZARD_STEPS[stepIndex]?.copy}
                    </div>
                  </div>
                  {activeStep === "goal" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Workflow Name
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Give the workflow a stable name before choosing the
                            goal that will shape its defaults.
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
                      </div>

                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Outcome First
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Pick the workflow family that best matches the end
                            result you want to keep. The wizard updates
                            defaults, but you stay on this step until you choose
                            Next Step.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {wizardGoalOptions().map((goal) => {
                            const active = goal.id === selectedGoal;
                            const GoalIcon = WIZARD_GOAL_ICONS[goal.id];
                            return (
                              <button
                                key={goal.id}
                                type="button"
                                onClick={() => applyGoal(goal.id)}
                                className={`group rounded-xl border px-4 py-4 text-left transition ${
                                  active
                                    ? "border-teal-400/35 bg-teal-500/10 ring-1 ring-teal-500/20"
                                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                                }`}
                              >
                                <div
                                  className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg transition ${
                                    active
                                      ? "bg-teal-400 text-slate-950"
                                      : "bg-white/5 text-teal-300 group-hover:scale-105"
                                  }`}
                                >
                                  <GoalIcon size={18} />
                                </div>
                                <div className="text-sm font-semibold text-slate-100">
                                  {goal.label}
                                </div>
                                <div className="mt-2 text-xs leading-relaxed text-slate-400">
                                  {goal.description}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Success Description
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Refine the description after choosing the goal so
                            any derived wording starts from the right workflow
                            family.
                          </div>
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

                        <FieldHint>
                          Custom description text is preserved when you switch
                          goals, so you can still compare workflow families
                          without losing edits.
                        </FieldHint>
                      </div>
                    </div>
                  ) : null}

                  {activeStep === "output" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Deliverable Shape
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Choose whether this workflow should target one exact
                            file or a broader area.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {deliverableOptions.map((option) => {
                            const active = option.id === selectedDeliverable;
                            const DeliverableIcon = deliverableIcon(
                              option.id,
                              selectedGoal,
                              option.targetFiles,
                            );
                            return (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => applyDeliverable(option.id)}
                                className={`group rounded-xl border px-4 py-4 text-left transition ${
                                  active
                                    ? "border-amber-400/35 bg-amber-500/10 ring-1 ring-amber-400/20"
                                    : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                                }`}
                              >
                                <div
                                  className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg transition ${
                                    active
                                      ? "bg-amber-300 text-slate-950"
                                      : "bg-white/5 text-amber-200 group-hover:scale-105"
                                  }`}
                                >
                                  <DeliverableIcon size={18} />
                                </div>
                                <div className="text-sm font-semibold text-slate-100">
                                  {option.label}
                                </div>
                                <div className="mt-2 text-xs leading-relaxed text-slate-400">
                                  {option.description}
                                </div>
                                <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                                  {option.language} • {option.targetFiles[0]}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Derived Scope
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            These fields stay editable, but the wizard derives a
                            safe starting point from your output choice.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                          <div>
                            <FieldLabel
                              label={
                                isResearchTemplate
                                  ? "Research Domain"
                                  : "Language"
                              }
                            />
                            <input
                              value={form.language ?? ""}
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
                            <FieldLabel label="Target Paths" />
                            <textarea
                              value={form.targetFilesText ?? ""}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  targetFilesText: event.target.value,
                                }))
                              }
                              rows={5}
                              className={textAreaClass}
                            />
                          </div>
                        </div>

                        <FieldHint>
                          {targetMode === "exact"
                            ? "This workflow currently targets exact relative paths, which is the right fit for one named document or prompt asset."
                            : targetMode === "glob"
                              ? "This workflow currently uses globs, which is the right fit for existing source trees or document directories."
                              : targetMode === "mixed"
                                ? "This workflow mixes exact paths and globs. That is valid, but make sure the scope is still intentional."
                                : "Add at least one relative target path or glob so the workflow has an explicit scope."}
                        </FieldHint>
                      </div>
                    </div>
                  ) : null}

                  {activeStep === "workspace" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Workspace
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Choose the repo or folder where the workflow runs
                            and writes output.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Workspace Status
                            </div>
                            <div className="mt-2">
                              <StatusChip
                                label={workspaceStatusLabel}
                                tone={workspaceStatusTone}
                              />
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              {normalizedWizardWorkspace
                                ? "The wizard is validating the selected runtime folder and its git readiness."
                                : "Pick the repo or folder that should own this workflow run."}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Saved Default
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {normalizedSavedWorkspace ||
                                "No default workspace"}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              {workspaceDiffersFromSavedDefault
                                ? "This workflow points somewhere else, so save-time follow-up will ask whether to replace the global default."
                                : "This workflow currently aligns with the saved default workspace."}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Output Scope
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {scopeHint}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              {targetFiles.length > 0
                                ? `${targetFiles.length} target ${targetFiles.length === 1 ? "path" : "paths"} currently derived from the output choice.`
                                : "No target paths are configured yet."}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <FieldLabel label="Repo Path" />
                              <StatusChip
                                label={workspaceStatusLabel}
                                tone={workspaceStatusTone}
                              />
                              {workspaceDiffersFromSavedDefault ? (
                                <StatusChip
                                  label="Differs Default"
                                  tone="slate"
                                />
                              ) : null}
                            </div>
                            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                              <div className="break-all text-sm text-slate-200">
                                {safeRepoPath ||
                                  "No workspace folder selected yet."}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void chooseWorkspaceFolder()}
                                  className={secondaryButtonClass}
                                >
                                  Choose Folder
                                </button>
                                {safeRepoPath ? (
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

                        {normalizedWizardWorkspace ? (
                          <div
                            className={`rounded-lg border px-3 py-3 text-xs leading-relaxed ${workspaceMissing || workspaceNotDirectory ? "border-rose-400/20 bg-rose-500/10 text-rose-100" : workspaceNeedsGitInit || workspaceDiffersFromSavedDefault ? "border-amber-300/20 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"}`}
                          >
                            {inspectingWorkspace ? (
                              <div>
                                Inspecting folder and repository status...
                              </div>
                            ) : workspaceMissing ? (
                              <div>
                                This path does not exist yet. You can still save
                                the workflow, but runs will fail until the
                                folder exists.
                              </div>
                            ) : workspaceNotDirectory ? (
                              <div>
                                This path is not a folder. Pick a workspace
                                directory instead of a file.
                              </div>
                            ) : workspaceNeedsGitInit &&
                              workspaceDiffersFromSavedDefault ? (
                              <div>
                                This folder is not a git repository and it
                                differs from the saved default workspace. After
                                save, Maabarium will ask whether to initialize
                                git here and whether this should replace the
                                global default workspace.
                              </div>
                            ) : workspaceNeedsGitInit ? (
                              <div>
                                This folder is not a git repository. After save,
                                Maabarium will ask whether to initialize git
                                here before you run the workflow.
                              </div>
                            ) : workspaceDiffersFromSavedDefault ? (
                              <div>
                                This workflow points at a different folder than
                                the saved default workspace. After save,
                                Maabarium will ask whether to make it the new
                                global default.
                              </div>
                            ) : workspaceStatus?.isGitRepository ? (
                              <div>
                                Repository detected
                                {workspaceStatus.repositoryRoot
                                  ? ` at ${workspaceStatus.repositoryRoot}`
                                  : "."}{" "}
                                This already matches the saved default
                                workspace.
                              </div>
                            ) : (
                              <div>The selected folder is ready to save.</div>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Current Scope Review
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Confirm that the workspace, evaluator, and output
                            paths describe the same job before you tune runtime
                            behavior.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Evaluator
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {evaluatorLabel}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              This is the scoring mode the runtime will apply to
                              the generated output for this workflow family.
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Scope Mode
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {scopeHint}
                            </div>
                            <div className="mt-2 text-xs leading-relaxed text-slate-400">
                              Exact paths keep output tightly bounded. Globs are
                              better when the workflow should range over a file
                              family.
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                            Target Path Review
                          </div>
                          <div className="mt-3 space-y-2">
                            {targetFiles.length > 0 ? (
                              targetFiles.map((target) => (
                                <div
                                  key={target}
                                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200"
                                >
                                  {target}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
                                Add at least one relative target path or glob so
                                the workflow has a concrete output scope.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeStep === "runtime" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Runtime Guardrails
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Set the loop limits and acceptance threshold before
                            reviewing advanced evaluator details.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Evaluator
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {evaluatorLabel}
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Acceptance
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {form.minImprovement.toFixed(2)} minimum gain
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Council
                            </div>
                            <div className="mt-2 text-sm text-slate-100">
                              {form.councilSize} agents • {form.debateRounds}{" "}
                              rounds
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Gate
                            </div>
                            <div className="mt-2">
                              <StatusChip
                                label={runtimeStatusLabel}
                                tone="slate"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                          <div>
                            <FieldLabel label="Max Iterations" />
                            <input
                              value={form.maxIterations}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  maxIterations:
                                    Number(event.target.value) || 0,
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
                                  timeoutSeconds:
                                    Number(event.target.value) || 0,
                                }))
                              }
                              className={textFieldClass}
                              type="number"
                              min={1}
                            />
                          </div>

                          <div>
                            <FieldLabel label="Min Improvement" />
                            <input
                              value={form.minImprovement}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  minImprovement:
                                    Number(event.target.value) || 0,
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
                                  requireTestsPass:
                                    event.target.value === "true",
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
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Council And Model Strategy
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Keep the high-level strategy here. Use advanced
                            controls below when you need to edit individual
                            metrics, agents, or model entries.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                          <div>
                            <FieldLabel label="Model Assignment" />
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
                          </div>
                          <div>
                            <FieldLabel label="Primary Model" />
                            <select
                              value={primaryModelName}
                              onChange={(event) =>
                                updatePrimaryModel(event.target.value)
                              }
                              className={textFieldClass}
                            >
                              {primaryModelOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <FieldHint>
                              Changing the primary model reorders the current
                              model pool and updates the guided council
                              baseline. Use Advanced when you need per-agent
                              overrides or deeper model-pool edits.
                            </FieldHint>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Metrics
                            </div>
                            <div className="mt-2 text-sm text-slate-200">
                              {safeMetricCount}
                            </div>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Agents
                            </div>
                            <div className="mt-2 text-sm text-slate-200">
                              {safeAgentCount}
                            </div>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                              Models
                            </div>
                            <div className="mt-2 text-sm text-slate-200">
                              {safeModelCount}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeStep === "review" ? (
                    <div className="space-y-6">
                      {showHydrationReview ? (
                        <div className="rounded-xl border border-teal-400/15 bg-teal-500/[0.06] px-4 py-4">
                          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-200">
                            Workflow Summary
                          </div>
                          <div className="mt-2 text-sm text-slate-200">
                            Maabarium will write a runnable workflow using the
                            derived choices below. Verify the workflow family,
                            output scope, evaluator, and workspace before
                            saving.
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 text-[11px] text-slate-400 md:grid-cols-2 xl:grid-cols-3">
                            {derivedSummary.map((item) => (
                              <div key={item.label}>
                                <span className="font-semibold text-slate-200">
                                  {item.label}:
                                </span>{" "}
                                {item.value}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          Advanced Controls
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Open the raw blueprint controls when you need to edit
                          templates, metrics, agents, or the full model pool
                          directly.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setShowAdvancedControls((current) => !current)
                        }
                        className={secondaryButtonClass}
                      >
                        {showAdvancedControls
                          ? "Hide Advanced"
                          : "Show Advanced"}
                      </button>
                    </div>
                  </div>

                  {showAdvancedControls ? (
                    <>
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
                    </>
                  ) : null}

                  {showAdvancedControls && activeTab === "basics" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Workflow Identity
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Keep the top-level metadata compact and readable.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
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
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
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
                                <StatusChip
                                  label="Differs Default"
                                  tone="slate"
                                />
                              ) : null}
                            </div>
                            <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                              <div className="break-all text-sm text-slate-200">
                                {form.repoPath ||
                                  "No workspace folder selected yet."}
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
                                    This path does not exist yet. You can still
                                    save the workflow, but runs will fail until
                                    the folder exists.
                                  </div>
                                ) : workspaceNotDirectory ? (
                                  <div>
                                    This path is not a folder. Pick a workspace
                                    directory instead of a file.
                                  </div>
                                ) : workspaceNeedsGitInit &&
                                  workspaceDiffersFromSavedDefault ? (
                                  <div>
                                    This folder is not a git repository and it
                                    differs from the saved default workspace.
                                    After save, Maabarium will ask whether to
                                    initialize git here and whether this should
                                    replace the global default workspace.
                                  </div>
                                ) : workspaceNeedsGitInit ? (
                                  <div>
                                    This folder is not a git repository. After
                                    save, Maabarium will ask whether to
                                    initialize git here before you run the
                                    workflow.
                                  </div>
                                ) : workspaceDiffersFromSavedDefault ? (
                                  <div>
                                    This workflow points at a different folder
                                    than the saved default workspace. After
                                    save, Maabarium will ask whether to make it
                                    the new global default.
                                  </div>
                                ) : workspaceStatus?.isGitRepository ? (
                                  <div>
                                    Repository detected
                                    {workspaceStatus.repositoryRoot
                                      ? ` at ${workspaceStatus.repositoryRoot}`
                                      : "."}{" "}
                                    This already matches the saved default
                                    workspace.
                                  </div>
                                ) : (
                                  <div>
                                    The selected folder is ready to save.
                                  </div>
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
                              : "These settings define what kind of workflow this is and where it is allowed to write. Use exact file paths for one named document and globs for families of existing files."}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                          <div>
                            <FieldLabel
                              label={
                                isResearchTemplate
                                  ? "Research Domain"
                                  : "Language"
                              }
                              help={
                                isResearchTemplate
                                  ? "Research workflows can leave this broad. Use it when you want the generated workflow to carry an explicit domain label such as policy, product, or security."
                                  : "This is not just a label. It helps Maabarium choose the evaluator path. Use markdown or prompt for document outputs, research for cited briefs, and code or application for source-tree changes."
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
                              label="Target Paths"
                              help="Use an exact relative file path when one named output should be created or refined. Use comma or newline separated globs when the workflow should operate across many existing files."
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
                            Research templates default to documentation-style
                            output paths so you can capture sourced briefs
                            without forcing code-specific targeting.
                          </FieldHint>
                        ) : null}

                        {!isResearchTemplate &&
                        ["markdown", "prompt"].includes(
                          form.language.trim().toLowerCase(),
                        ) ? (
                          <FieldHint>
                            For document workflows, prefer an exact relative
                            `.md` path such as `docs/release-plan.md` when you
                            want one specifically named output file.
                          </FieldHint>
                        ) : null}

                        {!isResearchTemplate &&
                        !["markdown", "prompt"].includes(
                          form.language.trim().toLowerCase(),
                        ) ? (
                          <FieldHint>
                            For code and application workflows, prefer globs
                            that match existing source trees such as `src/**/*`
                            or `crates/**/*`.
                          </FieldHint>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {showAdvancedControls && activeTab === "evaluation" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Constraints
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Runtime guardrails and acceptance thresholds for the
                            loop.
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                          <div>
                            <FieldLabel label="Max Iterations" />
                            <input
                              value={form.maxIterations}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  maxIterations:
                                    Number(event.target.value) || 0,
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
                                  timeoutSeconds:
                                    Number(event.target.value) || 0,
                                }))
                              }
                              className={textFieldClass}
                              type="number"
                              min={1}
                            />
                          </div>

                          <div>
                            <FieldLabel label="Min Improvement" />
                            <input
                              value={form.minImprovement}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  minImprovement:
                                    Number(event.target.value) || 0,
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
                                  requireTestsPass:
                                    event.target.value === "true",
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
                                      updateMetric(
                                        index,
                                        "name",
                                        event.target.value,
                                      )
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

                  {showAdvancedControls && activeTab === "agents" ? (
                    <div className={sectionCardClass}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Agents
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Agent model selections are pulled from the
                            configured model pool below and prefer the choices
                            you made during setup.
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
                                    updateAgent(
                                      index,
                                      "name",
                                      event.target.value,
                                    )
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
                                    updateAgent(
                                      index,
                                      "role",
                                      event.target.value,
                                    )
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
                                    updateAgent(
                                      index,
                                      "model",
                                      event.target.value,
                                    )
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

                  {showAdvancedControls && activeTab === "models" ? (
                    <div className="space-y-6">
                      <div className={sectionCardClass}>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            Assignment Strategy
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Decide how the configured pool should be consumed by
                            the loop.
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
                            selected on the Agents tab. Round robin uses this
                            pool as an ordered list and rotates requests across
                            it.
                          </FieldHint>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
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
                          <div>
                            <FieldLabel label="Pool Mode Summary" />
                            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
                              {form.modelAssignment === "round_robin"
                                ? "Requests rotate across the configured model pool."
                                : "Agents keep explicit model assignments from the pool."}
                            </div>
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
                              Local Ollama entries use setup-backed model
                              choices. Remote entries keep an editable model
                              name because providers may expose many possible
                              model ids.
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
                                      updateModelProvider(
                                        index,
                                        event.target.value,
                                      )
                                    }
                                    className={textFieldClass}
                                  >
                                    {providerOptions.map((provider) => (
                                      <option
                                        key={provider.id}
                                        value={provider.id}
                                      >
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
                                This model entry is part of the shared pool used
                                by the assignment strategy above.
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

                {!showAdvancedControls ? (
                  <aside className="space-y-4 self-start overflow-x-hidden xl:sticky xl:top-6 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:pr-1">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                        <LayoutDashboard size={14} className="text-teal-300" />
                        Live Blueprint Summary
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-slate-400">
                        The guided flow keeps this summary live so you can see
                        how each step changes the workflow before you save.
                      </div>
                      <div className="mt-4 space-y-3">
                        {summaryRows.map((item) => (
                          <SummaryRow
                            key={item.label}
                            label={item.label}
                            value={item.value}
                            icon={item.icon}
                            active={item.active}
                          />
                        ))}
                      </div>
                      {workspaceSidebarNote ? (
                        <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-3 text-xs leading-relaxed text-amber-100">
                          {workspaceSidebarNote}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                        Step Actions
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-slate-400">
                        Guided navigation stays visible here, and the footer
                        keeps mirrored actions while you scroll through the
                        form.
                      </div>
                      <div className="mt-4 space-y-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (canGoForward && nextStep) {
                              setActiveStep(nextStep);
                              return;
                            }
                            onSubmit();
                          }}
                          disabled={isCreating || isEngineRunning}
                          className={`${
                            canGoForward && nextStep
                              ? secondaryButtonClass
                              : accentButtonClass
                          } flex w-full items-center justify-center gap-2 py-3`}
                        >
                          {primaryActionLabel}
                          {canGoForward && nextStep ? (
                            <ChevronRight size={14} />
                          ) : null}
                        </button>
                        {canGoBack && previousStep ? (
                          <button
                            type="button"
                            onClick={() => setActiveStep(previousStep)}
                            disabled={isCreating}
                            className={`${secondaryButtonClass} flex w-full items-center justify-center gap-2 py-3`}
                          >
                            <ChevronLeft size={14} />
                            Previous Step
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>
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
                {canGoBack && previousStep ? (
                  <button
                    type="button"
                    onClick={() => setActiveStep(previousStep)}
                    disabled={isCreating}
                    className={secondaryButtonClass}
                  >
                    Previous Step
                  </button>
                ) : null}
                {canGoForward && nextStep ? (
                  <button
                    type="button"
                    onClick={() => setActiveStep(nextStep)}
                    disabled={isCreating || isEngineRunning}
                    className={secondaryButtonClass}
                  >
                    Next Step
                  </button>
                ) : null}
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
    </div>
  );
}

export function BlueprintWizardModal(props: BlueprintWizardModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <WizardRenderBoundary onClose={props.onClose}>
      <BlueprintWizardModalBody {...props} />
    </WizardRenderBoundary>
  );
}
