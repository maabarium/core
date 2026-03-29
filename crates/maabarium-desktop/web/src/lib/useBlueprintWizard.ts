import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import {
  buildWizardFormFromBlueprint,
  buildSuggestedWizardModel,
  buildSuggestedWizardModels,
  buildWizardForm,
  normalizeWizardForm,
  parseWizardTargetFilesText,
} from "./blueprints";
import type {
  BlueprintFile,
  BlueprintWizardForm,
  BlueprintWizardRequest,
  ConsoleState,
  WizardAgentForm,
  WizardMetricForm,
  WizardModelForm,
  WizardTemplate,
} from "../types/console";

type UseBlueprintWizardArgs = {
  state: ConsoleState | null;
  presentDesktopError: (
    title: string,
    heading: string,
    description: string,
    error: unknown,
  ) => void;
  dismissDesktopError: () => void;
};

export function useBlueprintWizard({
  state,
  presentDesktopError,
  dismissDesktopError,
}: UseBlueprintWizardArgs) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCreating, setWizardCreating] = useState(false);
  const [wizardEditingPath, setWizardEditingPath] = useState<string | null>(
    null,
  );
  const [wizardForm, setWizardFormState] = useState<BlueprintWizardForm>(
    buildWizardForm(null),
  );
  const wizardMode: "create" | "edit" = wizardEditingPath ? "edit" : "create";

  const setWizardForm: Dispatch<SetStateAction<BlueprintWizardForm>> = (
    value,
  ) => {
    setWizardFormState((current) =>
      normalizeWizardForm(typeof value === "function" ? value(current) : value),
    );
  };

  const wizardMetricWeightTotal = useMemo(
    () =>
      (Array.isArray(wizardForm.metrics) ? wizardForm.metrics : []).reduce(
        (sum, metric) =>
          sum + (metric && Number.isFinite(metric.weight) ? metric.weight : 0),
        0,
      ),
    [wizardForm.metrics],
  );

  const wizardModelNames = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(wizardForm.models) ? wizardForm.models : [])
            .map((model) =>
              typeof model?.name === "string" ? model.name.trim() : "",
            )
            .filter((name) => name.length > 0),
        ),
      ),
    [wizardForm.models],
  );

  const updateWizardMetric = (
    index: number,
    field: keyof WizardMetricForm,
    value: string | number,
  ) => {
    setWizardForm((current) => ({
      ...current,
      metrics: current.metrics.map((metric, metricIndex) =>
        metricIndex === index ? { ...metric, [field]: value } : metric,
      ),
    }));
  };

  const updateWizardAgent = (
    index: number,
    field: keyof WizardAgentForm,
    value: string,
  ) => {
    setWizardForm((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, [field]: value } : agent,
      ),
    }));
  };

  const updateWizardModel = (
    index: number,
    field: keyof WizardModelForm,
    value: string | number,
  ) => {
    setWizardForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, [field]: value } : model,
      ),
    }));
  };

  const addWizardMetric = () => {
    setWizardForm((current) => ({
      ...current,
      metrics: [
        ...current.metrics,
        {
          name: "new_metric",
          weight: 0.1,
          direction: "maximize",
          description: "Describe how this metric should be judged.",
        },
      ],
    }));
  };

  const addWizardAgent = () => {
    setWizardForm((current) => {
      const fallbackModel =
        current.models.find((model) => model.name.trim().length > 0)?.name ??
        buildSuggestedWizardModel(state).name;

      return {
        ...current,
        councilSize: current.agents.length + 1,
        agents: [
          ...current.agents,
          {
            name: `agent_${current.agents.length + 1}`,
            role: "specialist",
            systemPrompt: "Describe how this agent should contribute.",
            model: fallbackModel,
          },
        ],
      };
    });
  };

  const addWizardModel = () => {
    setWizardForm((current) => {
      const suggestedModels = buildSuggestedWizardModels(state);
      const nextSuggestedModel =
        suggestedModels.find(
          (suggestedModel) =>
            !current.models.some(
              (model) =>
                model.provider === suggestedModel.provider &&
                model.name === suggestedModel.name,
            ),
        ) ?? buildSuggestedWizardModel(state);

      return {
        ...current,
        models: [...current.models, nextSuggestedModel],
      };
    });
  };

  const removeWizardMetric = (index: number) => {
    setWizardForm((current) => ({
      ...current,
      metrics: current.metrics.filter(
        (_, metricIndex) => metricIndex !== index,
      ),
    }));
  };

  const removeWizardAgent = (index: number) => {
    setWizardForm((current) => {
      const nextAgents = current.agents.filter(
        (_, agentIndex) => agentIndex !== index,
      );

      return {
        ...current,
        councilSize: Math.max(1, nextAgents.length),
        agents: nextAgents,
      };
    });
  };

  const removeWizardModel = (index: number) => {
    setWizardForm((current) => ({
      ...current,
      models: current.models.filter((_, modelIndex) => modelIndex !== index),
    }));
  };

  const openBlueprintWizard = () => {
    setWizardEditingPath(null);
    setWizardForm(buildWizardForm(state));
    dismissDesktopError();
    setWizardOpen(true);
  };

  const openTemplateWizard = (
    template: WizardTemplate,
    displayName: string,
    description: string | null,
  ) => {
    setWizardEditingPath(null);
    const initial = buildWizardForm(state, template);
    setWizardForm({
      ...initial,
      name: displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
      description: description ?? initial.description,
    });
    dismissDesktopError();
    setWizardOpen(true);
  };

  const openExistingBlueprintWizard = (
    path: string,
    blueprint: BlueprintFile,
  ) => {
    setWizardEditingPath(path);
    setWizardForm(buildWizardFormFromBlueprint(blueprint));
    dismissDesktopError();
    setWizardOpen(true);
  };

  const presentWizardError = (message: string) => {
    presentDesktopError(
      "Blueprint Wizard",
      "The wizard input needs attention",
      "Review the details below, then continue editing the blueprint wizard form.",
      message,
    );
  };

  const closeBlueprintWizard = () => {
    if (wizardCreating) {
      return;
    }

    setWizardOpen(false);
    setWizardEditingPath(null);
  };

  const buildWizardRequest = (): BlueprintWizardRequest | null => {
    const normalizedForm = normalizeWizardForm(wizardForm);
    const targetFiles = parseWizardTargetFilesText(
      normalizedForm.targetFilesText,
    );
    const metrics = normalizedForm.metrics.map((metric) => ({
      name: metric.name.trim(),
      weight: metric.weight,
      direction: metric.direction,
      description: metric.description.trim(),
    }));
    const agents = normalizedForm.agents.map((agent) => ({
      name: agent.name.trim(),
      role: agent.role.trim(),
      system_prompt: agent.systemPrompt.trim(),
      model: agent.model.trim(),
    }));
    const models = normalizedForm.models.map((model) => ({
      name: model.name.trim(),
      provider: model.provider.trim(),
      endpoint: model.endpoint.trim(),
      api_key_env: model.apiKeyEnv.trim() || null,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      requests_per_minute: model.requestsPerMinute.trim()
        ? Number(model.requestsPerMinute)
        : null,
    }));

    if (!normalizedForm.name.trim()) {
      presentWizardError("Blueprint name is required");
      return null;
    }

    if (!normalizedForm.description.trim()) {
      presentWizardError("Blueprint description is required");
      return null;
    }

    if (!normalizedForm.version.trim()) {
      presentWizardError("Blueprint version is required");
      return null;
    }

    if (!normalizedForm.repoPath.trim()) {
      presentWizardError("Repo path is required");
      return null;
    }

    if (!normalizedForm.language.trim()) {
      presentWizardError("Language is required");
      return null;
    }

    if (targetFiles.length === 0) {
      presentWizardError("Add at least one target file pattern");
      return null;
    }

    if (targetFiles.some((target) => /^(?:\/|[A-Za-z]:[\\/])/.test(target))) {
      presentWizardError(
        "Target paths must be relative to the selected workspace",
      );
      return null;
    }

    if (metrics.length === 0) {
      presentWizardError("Add at least one metric");
      return null;
    }

    if (agents.length === 0) {
      presentWizardError("Add at least one agent");
      return null;
    }

    if (models.length === 0) {
      presentWizardError("Add at least one model");
      return null;
    }

    if (metrics.some((metric) => !metric.name || !metric.description)) {
      presentWizardError("Each metric needs a name and description");
      return null;
    }

    if (
      agents.some((agent) => !agent.name || !agent.role || !agent.system_prompt)
    ) {
      presentWizardError("Each agent needs a name, role, and system prompt");
      return null;
    }

    if (
      models.some((model) => !model.name || !model.provider || !model.endpoint)
    ) {
      presentWizardError("Each model needs a name, provider, and endpoint");
      return null;
    }

    if (
      models.some(
        (model) =>
          model.requests_per_minute !== null &&
          (!Number.isFinite(model.requests_per_minute) ||
            model.requests_per_minute <= 0),
      )
    ) {
      presentWizardError(
        "Each requests-per-minute value must be blank or greater than zero",
      );
      return null;
    }

    if (
      !agents.every((agent) =>
        models.some((model) => model.name === agent.model),
      )
    ) {
      presentWizardError(
        "Each agent must reference one of the configured models",
      );
      return null;
    }

    if (Math.abs(wizardMetricWeightTotal - 1) > 0.01) {
      presentWizardError("Metric weights must sum to 1.0");
      return null;
    }

    if (normalizedForm.maxIterations < 1 || normalizedForm.timeoutSeconds < 1) {
      presentWizardError(
        "Max iterations and timeout seconds must both be greater than zero",
      );
      return null;
    }

    if (normalizedForm.councilSize < 1 || normalizedForm.debateRounds < 1) {
      presentWizardError(
        "Council size and debate rounds must both be greater than zero",
      );
      return null;
    }

    return {
      name: normalizedForm.name.trim(),
      description: normalizedForm.description.trim(),
      version: normalizedForm.version.trim(),
      template: normalizedForm.template,
      repoPath: normalizedForm.repoPath.trim(),
      language: normalizedForm.language.trim(),
      targetFiles,
      maxIterations: normalizedForm.maxIterations,
      timeoutSeconds: normalizedForm.timeoutSeconds,
      requireTestsPass: normalizedForm.requireTestsPass,
      minImprovement: normalizedForm.minImprovement,
      councilSize: normalizedForm.councilSize,
      debateRounds: normalizedForm.debateRounds,
      metrics,
      agents,
      modelAssignment: normalizedForm.modelAssignment,
      models,
    };
  };

  return {
    wizardOpen,
    setWizardOpen,
    wizardCreating,
    setWizardCreating,
    wizardMode,
    wizardEditingPath,
    wizardForm,
    setWizardForm,
    wizardMetricWeightTotal,
    wizardModelNames,
    updateWizardMetric,
    updateWizardAgent,
    updateWizardModel,
    addWizardMetric,
    addWizardAgent,
    addWizardModel,
    removeWizardMetric,
    removeWizardAgent,
    removeWizardModel,
    openBlueprintWizard,
    openTemplateWizard,
    openExistingBlueprintWizard,
    closeBlueprintWizard,
    buildWizardRequest,
  };
}
