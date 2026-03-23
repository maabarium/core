import { useMemo, useState } from "react";
import { buildSuggestedWizardModel, buildWizardForm } from "./blueprints";
import type {
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
  const [wizardForm, setWizardForm] = useState<BlueprintWizardForm>(
    buildWizardForm(null),
  );

  const wizardMetricWeightTotal = useMemo(
    () =>
      wizardForm.metrics.reduce(
        (sum, metric) =>
          sum + (Number.isFinite(metric.weight) ? metric.weight : 0),
        0,
      ),
    [wizardForm.metrics],
  );

  const wizardModelNames = useMemo(
    () =>
      wizardForm.models
        .map((model) => model.name.trim())
        .filter((name) => name.length > 0),
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
    const fallbackModel = wizardModelNames[0] || "llama3";
    setWizardForm((current) => ({
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
    }));
  };

  const addWizardModel = () => {
    const suggestedModel = buildSuggestedWizardModel(state);
    setWizardForm((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          ...suggestedModel,
          name: current.models.some(
            (model) => model.name === suggestedModel.name,
          )
            ? `${suggestedModel.name}_${current.models.length + 1}`
            : suggestedModel.name,
        },
      ],
    }));
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
    setWizardForm(buildWizardForm(state));
    dismissDesktopError();
    setWizardOpen(true);
  };

  const openTemplateWizard = (
    template: WizardTemplate,
    displayName: string,
    description: string | null,
  ) => {
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
  };

  const buildWizardRequest = (): BlueprintWizardRequest | null => {
    const targetFiles = wizardForm.targetFilesText
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const metrics = wizardForm.metrics.map((metric) => ({
      name: metric.name.trim(),
      weight: metric.weight,
      direction: metric.direction,
      description: metric.description.trim(),
    }));
    const agents = wizardForm.agents.map((agent) => ({
      name: agent.name.trim(),
      role: agent.role.trim(),
      system_prompt: agent.systemPrompt.trim(),
      model: agent.model.trim(),
    }));
    const models = wizardForm.models.map((model) => ({
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

    if (!wizardForm.name.trim()) {
      presentWizardError("Blueprint name is required");
      return null;
    }

    if (!wizardForm.description.trim()) {
      presentWizardError("Blueprint description is required");
      return null;
    }

    if (targetFiles.length === 0) {
      presentWizardError("Add at least one target file pattern");
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

    return {
      name: wizardForm.name.trim(),
      description: wizardForm.description.trim(),
      version: wizardForm.version.trim(),
      template: wizardForm.template,
      repoPath: wizardForm.repoPath.trim(),
      language: wizardForm.language.trim(),
      targetFiles,
      maxIterations: wizardForm.maxIterations,
      timeoutSeconds: wizardForm.timeoutSeconds,
      requireTestsPass: wizardForm.requireTestsPass,
      minImprovement: wizardForm.minImprovement,
      councilSize: wizardForm.councilSize,
      debateRounds: wizardForm.debateRounds,
      metrics,
      agents,
      modelAssignment: wizardForm.modelAssignment,
      models,
    };
  };

  return {
    wizardOpen,
    setWizardOpen,
    wizardCreating,
    setWizardCreating,
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
    closeBlueprintWizard,
    buildWizardRequest,
  };
}
