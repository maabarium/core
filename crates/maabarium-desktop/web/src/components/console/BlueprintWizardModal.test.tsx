import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildWizardForm } from "../../lib/blueprints";
import type {
  BlueprintWizardForm,
  WorkspaceGitStatus,
} from "../../types/console";
import { BlueprintWizardModal } from "./BlueprintWizardModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function TestHarness({
  inspectWorkspace,
  initialForm,
  localModelOptions,
  providerOptions,
}: {
  inspectWorkspace?: (path: string) => Promise<WorkspaceGitStatus | null>;
  initialForm?: BlueprintWizardForm;
  localModelOptions?: string[];
  providerOptions?: Array<{
    id: string;
    label: string;
    endpoint: string;
    defaultModelName: string;
    availableModelNames?: string[];
  }>;
}) {
  const [form, setForm] = useState<BlueprintWizardForm>(
    () => initialForm ?? buildWizardForm(null),
  );
  const metricWeightTotal = useMemo(
    () =>
      (Array.isArray(form.metrics) ? form.metrics : []).reduce(
        (sum, metric) =>
          sum +
          (metric && typeof metric.weight === "number" ? metric.weight : 0),
        0,
      ),
    [form.metrics],
  );
  const safeModelNames = (Array.isArray(form.models) ? form.models : []).map(
    (model) => (typeof model?.name === "string" ? model.name : ""),
  );

  const addMetric = () => {
    setForm((current) => ({
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

  const updateMetric = (
    index: number,
    field: keyof BlueprintWizardForm["metrics"][number],
    value: string | number,
  ) => {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.map((metric, metricIndex) =>
        metricIndex === index ? { ...metric, [field]: value } : metric,
      ),
    }));
  };

  const removeMetric = (index: number) => {
    setForm((current) => ({
      ...current,
      metrics: current.metrics.filter(
        (_, metricIndex) => metricIndex !== index,
      ),
    }));
  };

  const addAgent = () => {
    setForm((current) => ({
      ...current,
      agents: [
        ...current.agents,
        {
          name: `agent_${current.agents.length + 1}`,
          role: "specialist",
          systemPrompt: "Describe how this agent should contribute.",
          model: current.models[0]?.name ?? "llama3",
        },
      ],
    }));
  };

  const updateAgent = (
    index: number,
    field: keyof BlueprintWizardForm["agents"][number],
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      agents: current.agents.map((agent, agentIndex) =>
        agentIndex === index ? { ...agent, [field]: value } : agent,
      ),
    }));
  };

  const removeAgent = (index: number) => {
    setForm((current) => ({
      ...current,
      agents: current.agents.filter((_, agentIndex) => agentIndex !== index),
    }));
  };

  const addModel = () => {
    setForm((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          name: "llama3",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "60",
        },
      ],
    }));
  };

  const updateModel = (
    index: number,
    field: keyof BlueprintWizardForm["models"][number],
    value: string | number,
  ) => {
    setForm((current) => ({
      ...current,
      models: current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, [field]: value } : model,
      ),
    }));
  };

  const removeModel = (index: number) => {
    setForm((current) => ({
      ...current,
      models: current.models.filter((_, modelIndex) => modelIndex !== index),
    }));
  };

  return (
    <>
      <BlueprintWizardModal
        open
        isCreating={false}
        isEngineRunning={false}
        form={form}
        metricWeightTotal={metricWeightTotal}
        modelNames={safeModelNames}
        mode="create"
        localModelOptions={localModelOptions ?? safeModelNames}
        providerOptions={
          providerOptions ?? [
            {
              id: "ollama",
              label: "Ollama",
              endpoint: "http://localhost:11434",
              defaultModelName: safeModelNames[0] || "llama3",
              availableModelNames: [],
            },
          ]
        }
        savedWorkspacePath={null}
        onInspectWorkspace={
          inspectWorkspace ??
          (async (path: string) => ({
            path,
            exists: true,
            isDirectory: true,
            isGitRepository: true,
            repositoryRoot: path,
          }))
        }
        setForm={setForm}
        addMetric={addMetric}
        updateMetric={updateMetric}
        removeMetric={removeMetric}
        addAgent={addAgent}
        updateAgent={updateAgent}
        removeAgent={removeAgent}
        addModel={addModel}
        updateModel={updateModel}
        removeModel={removeModel}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />
      <pre data-testid="wizard-form-state">{JSON.stringify(form)}</pre>
    </>
  );
}

function readFormState(): BlueprintWizardForm {
  const raw = screen.getByTestId("wizard-form-state").textContent;
  if (!raw) {
    throw new Error("Missing wizard form state");
  }
  return JSON.parse(raw) as BlueprintWizardForm;
}

describe("BlueprintWizardModal", () => {
  it("shows the stepped goal-first flow without the old template picker in the guided view", () => {
    render(<TestHarness />);

    expect(screen.getByText("Live Blueprint Summary")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^Code Quality$/i }),
    ).toBeNull();
    expect(
      screen.queryByText(
        /Start from the outcome you want, then let the wizard derive the matching workflow shape/i,
      ),
    ).toBeNull();
  });

  it("advances through the stepped flow and applies document defaults", async () => {
    const user = userEvent.setup();

    render(<TestHarness />);

    screen.getByText("Outcome First");

    await user.click(
      screen.getByRole("button", {
        name: /Generate or refine a document/i,
      }),
    );

    expect(screen.getByText("Outcome First")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await waitFor(() => {
      screen.getByText("Deliverable Shape");
    });

    await user.click(
      screen.getByRole("button", {
        name: /One named markdown file/i,
      }),
    );

    await waitFor(() => {
      screen.getByText(
        /Choose the repo or folder where the workflow runs and writes output/i,
      );
      expect(readFormState().targetFilesText).toBe("docs/project-brief.md");
    });

    expect(readFormState().template).toBe("prompt_optimization");
    expect(readFormState().language).toBe("markdown");
    expect(readFormState().targetFilesText).toBe("docs/project-brief.md");

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    screen.getByText("Runtime Guardrails");

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    screen.getByText("Workflow Summary");
    expect(screen.getAllByText(/Generate or refine a document/).length).toBe(2);

    await user.click(screen.getByRole("button", { name: /Show Advanced/i }));
    screen.getByText(/^Basics$/);
    screen.getByText(/^Evaluation$/);
    expect(screen.queryByText("Live Blueprint Summary")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Previous Step/i }));
    screen.getByText("Runtime Guardrails");
  });

  it("keeps a custom description when the goal changes", async () => {
    const user = userEvent.setup();

    render(<TestHarness />);

    await user.type(
      screen.getAllByRole("textbox")[1],
      "Keep this exact summary.",
    );

    await user.click(
      screen.getByRole("button", {
        name: /Generate or refine a document/i,
      }),
    );

    expect(readFormState().description).toContain("Keep this exact summary.");
  });

  it("stays renderable when live wizard state contains null-like string fields", () => {
    const malformedForm = {
      ...buildWizardForm(null),
      language: null as unknown as string,
      repoPath: null as unknown as string,
      targetFilesText: null as unknown as string,
    };

    render(<TestHarness initialForm={malformedForm} />);

    expect(screen.getByText("Blueprint Wizard")).toBeTruthy();
    expect(screen.getByText("Live Blueprint Summary")).toBeTruthy();
  });

  it("stays renderable when live wizard state contains malformed nested arrays", async () => {
    const user = userEvent.setup();
    const malformedForm = {
      ...buildWizardForm(null),
      metrics: [null] as unknown as BlueprintWizardForm["metrics"],
      agents: [
        {
          name: null,
          role: null,
          systemPrompt: null,
          model: null,
        },
      ] as unknown as BlueprintWizardForm["agents"],
      models: [
        {
          name: null,
          provider: null,
          endpoint: null,
          apiKeyEnv: null,
          temperature: null,
          maxTokens: null,
          requestsPerMinute: null,
        },
      ] as unknown as BlueprintWizardForm["models"],
    } as BlueprintWizardForm;

    render(<TestHarness initialForm={malformedForm} />);

    expect(screen.getByText("Blueprint Wizard")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Show Advanced/i }));
    expect(screen.getByText(/^Agents$/)).toBeTruthy();
    expect(screen.getByText(/^Models$/)).toBeTruthy();
  });

  it("lets the guided runtime step change the primary model without opening advanced mode", async () => {
    const user = userEvent.setup();
    const initialForm: BlueprintWizardForm = {
      ...buildWizardForm(null),
      models: [
        {
          name: "alpha-model",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "60",
        },
        {
          name: "beta-model",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "60",
        },
      ],
      agents: [
        {
          name: "reviewer",
          role: "reviewer",
          systemPrompt: "Review changes",
          model: "alpha-model",
        },
        {
          name: "implementer",
          role: "implementer",
          systemPrompt: "Implement changes",
          model: "alpha-model",
        },
      ],
    };

    render(<TestHarness initialForm={initialForm} />);

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /Existing source files/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);

    const primaryModelInput = screen.getByRole("combobox", {
      name: /Primary Model/i,
    });
    await user.click(primaryModelInput);
    await user.clear(primaryModelInput);
    await user.type(primaryModelInput, "beta");
    await user.click(screen.getByRole("option", { name: /beta-model/i }));

    expect(readFormState().models[0]?.name).toBe("beta-model");
    expect(readFormState().models[1]?.name).toBe("alpha-model");
    expect(readFormState().agents.map((agent) => agent.model)).toEqual([
      "beta-model",
      "beta-model",
    ]);
  });

  it("shows setup-discovered local models in the guided runtime selector even when they are not in the current pool", async () => {
    const user = userEvent.setup();
    const initialForm: BlueprintWizardForm = {
      ...buildWizardForm(null),
      models: [
        {
          name: "alpha-model",
          provider: "ollama",
          endpoint: "http://localhost:11434",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "60",
        },
      ],
      agents: [
        {
          name: "reviewer",
          role: "reviewer",
          systemPrompt: "Review changes",
          model: "alpha-model",
        },
      ],
    };

    render(
      <TestHarness
        initialForm={initialForm}
        localModelOptions={["alpha-model", "qwen3.5:9b"]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /Existing source files/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);

    const primaryModelInput = screen.getByRole("combobox", {
      name: /Primary Model/i,
    });

    await user.click(primaryModelInput);
    await user.clear(primaryModelInput);
    await user.type(primaryModelInput, "qwen");

    expect(
      screen.getByTestId("primary-model-provider-group").textContent,
    ).toMatch(/Ollama/i);
    await user.click(screen.getByRole("option", { name: /qwen3.5:9b/i }));

    expect(readFormState().models[0]?.name).toBe("qwen3.5:9b");
    expect(readFormState().models[0]?.provider).toBe("ollama");
    expect(readFormState().agents.map((agent) => agent.model)).toEqual([
      "qwen3.5:9b",
    ]);
  });

  it("lets guided runtime selection switch from a local-only pool to a validated remote provider model", async () => {
    const user = userEvent.setup();

    render(
      <TestHarness
        initialForm={{
          ...buildWizardForm(null),
          models: [
            {
              name: "llama3",
              provider: "ollama",
              endpoint: "http://localhost:11434",
              apiKeyEnv: "",
              temperature: 0.7,
              maxTokens: 2048,
              requestsPerMinute: "60",
            },
          ],
          agents: [
            {
              name: "reviewer",
              role: "reviewer",
              systemPrompt: "Review changes",
              model: "llama3",
            },
          ],
        }}
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama Local",
            endpoint: "http://localhost:11434",
            defaultModelName: "llama3",
            availableModelNames: [],
          },
          {
            id: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            defaultModelName: "openai/gpt-4o-mini",
            availableModelNames: [
              "openai/gpt-4o-mini",
              "meta-llama/llama-3.3-70b-instruct",
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /Existing source files/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);

    const primaryModelInput = screen.getByRole("combobox", {
      name: /Primary Model/i,
    });
    await user.click(primaryModelInput);
    await user.clear(primaryModelInput);
    await user.type(primaryModelInput, "gpt");

    expect(screen.getByTestId("primary-model-provider-group").textContent).toBe(
      "OpenRouter",
    );
    await user.click(
      screen.getByRole("option", {
        name: /openai\/gpt-4o-mini/i,
      }),
    );

    expect(readFormState().models[0]?.name).toBe("openai/gpt-4o-mini");
    expect(readFormState().models[0]?.provider).toBe("openrouter");
    expect(readFormState().agents[0]?.model).toBe("openai/gpt-4o-mini");
  });

  it("lets guided runtime selection switch to another validated remote provider model", async () => {
    const user = userEvent.setup();
    const initialForm: BlueprintWizardForm = {
      ...buildWizardForm(null),
      models: [
        {
          name: "openai/gpt-4o-mini",
          provider: "openrouter",
          endpoint: "https://openrouter.ai/api/v1",
          apiKeyEnv: "",
          temperature: 0.7,
          maxTokens: 2048,
          requestsPerMinute: "60",
        },
      ],
      agents: [
        {
          name: "reviewer",
          role: "reviewer",
          systemPrompt: "Review changes",
          model: "openai/gpt-4o-mini",
        },
      ],
    };

    render(
      <TestHarness
        initialForm={initialForm}
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama",
            endpoint: "http://localhost:11434",
            defaultModelName: "llama3",
            availableModelNames: [],
          },
          {
            id: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            defaultModelName: "openai/gpt-4o-mini",
            availableModelNames: [
              "openai/gpt-4o-mini",
              "meta-llama/llama-3.3-70b-instruct",
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /Existing source files/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);

    const primaryModelInput = screen.getByRole("combobox", {
      name: /Primary Model/i,
    });
    await user.click(primaryModelInput);
    await user.clear(primaryModelInput);
    await user.type(primaryModelInput, "llama");

    await user.click(
      screen.getByRole("option", {
        name: /meta-llama\/llama-3.3-70b-instruct/i,
      }),
    );

    expect(readFormState().models[0]?.name).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
    expect(readFormState().models[0]?.provider).toBe("openrouter");
    expect(readFormState().agents.map((agent) => agent.model)).toEqual([
      "meta-llama/llama-3.3-70b-instruct",
    ]);
  });

  it("groups primary model search results by provider and alphabetizes matches within each provider", async () => {
    const user = userEvent.setup();

    render(
      <TestHarness
        initialForm={{
          ...buildWizardForm(null),
          models: [
            {
              name: "xai-alpha",
              provider: "xai",
              endpoint: "https://api.x.ai/v1",
              apiKeyEnv: "",
              temperature: 0.7,
              maxTokens: 2048,
              requestsPerMinute: "60",
            },
          ],
        }}
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama Local",
            endpoint: "http://localhost:11434",
            defaultModelName: "llama3",
            availableModelNames: [],
          },
          {
            id: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            defaultModelName: "ai-gpt-mini",
            availableModelNames: ["ai-gpt-mini", "ai-gpt-pro"],
          },
          {
            id: "xai",
            label: "xAI",
            endpoint: "https://api.x.ai/v1",
            defaultModelName: "xai-beta",
            availableModelNames: ["xai-beta", "xai-alpha"],
          },
        ]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /Existing source files/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);

    const primaryModelInput = screen.getByRole("combobox", {
      name: /Primary Model/i,
    });
    await user.click(primaryModelInput);
    await user.clear(primaryModelInput);
    await user.type(primaryModelInput, "ai");

    const groupedLabels = screen
      .getAllByTestId("primary-model-provider-group")
      .map((node) => node.textContent?.trim());
    expect(groupedLabels).toEqual(["OpenRouter", "xAI"]);

    const groupedOptions = Array.from(
      screen.getByRole("listbox").querySelectorAll('[role="option"]'),
    ).map((node) => node.textContent?.replace(/selected/i, "").trim());
    expect(groupedOptions).toEqual([
      "ai-gpt-mini",
      "ai-gpt-pro",
      "xai-alpha",
      "xai-beta",
    ]);
  });

  it("uses the same searchable grouped picker for advanced agent model selection and retains remote picks", async () => {
    const user = userEvent.setup();

    render(
      <TestHarness
        initialForm={{
          ...buildWizardForm(null),
          agents: [
            {
              name: "reviewer",
              role: "reviewer",
              systemPrompt: "Review changes",
              model: "llama3",
            },
          ],
          models: [
            {
              name: "llama3",
              provider: "ollama",
              endpoint: "http://localhost:11434",
              apiKeyEnv: "",
              temperature: 0.7,
              maxTokens: 2048,
              requestsPerMinute: "60",
            },
          ],
        }}
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama Local",
            endpoint: "http://localhost:11434",
            defaultModelName: "llama3",
            availableModelNames: [],
          },
          {
            id: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            defaultModelName: "ai-gpt-mini",
            availableModelNames: ["ai-gpt-mini", "ai-gpt-pro"],
          },
          {
            id: "xai",
            label: "xAI",
            endpoint: "https://api.x.ai/v1",
            defaultModelName: "xai-beta",
            availableModelNames: ["xai-beta", "xai-alpha"],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Show Advanced/i }));
    await user.click(
      screen.getByRole("button", {
        name: /Agents Council roles and which model each one should use/i,
      }),
    );

    const agentModelInput = screen.getByRole("combobox", {
      name: /Agent 1 Model/i,
    });
    await user.click(agentModelInput);
    await user.clear(agentModelInput);
    await user.type(agentModelInput, "ai");

    const groupedLabels = screen
      .getAllByTestId("agent-model-provider-group-0")
      .map((node) => node.textContent?.trim());
    expect(groupedLabels).toEqual(["OpenRouter", "xAI"]);

    const groupedOptions = Array.from(
      screen.getByRole("listbox").querySelectorAll('[role="option"]'),
    ).map((node) => node.textContent?.replace(/selected/i, "").trim());
    expect(groupedOptions).toEqual([
      "ai-gpt-mini",
      "ai-gpt-pro",
      "xai-alpha",
      "xai-beta",
    ]);

    await user.click(screen.getByRole("option", { name: /xai-alpha/i }));

    expect(
      (
        screen.getByRole("combobox", {
          name: /Agent 1 Model/i,
        }) as HTMLInputElement
      ).value,
    ).toBe("xai-alpha");
    expect(readFormState().agents[0]?.model).toBe("xai-alpha");
    expect(
      readFormState().models.some(
        (model) =>
          model.name === "xai-alpha" &&
          model.provider === "xai" &&
          model.endpoint === "https://api.x.ai/v1",
      ),
    ).toBe(true);
  });

  it("uses a searchable remote picker in the advanced model pool editor", async () => {
    const user = userEvent.setup();

    render(
      <TestHarness
        initialForm={{
          ...buildWizardForm(null),
          models: [
            {
              name: "openai/gpt-4o-mini",
              provider: "openrouter",
              endpoint: "https://openrouter.ai/api/v1",
              apiKeyEnv: "",
              temperature: 0.7,
              maxTokens: 2048,
              requestsPerMinute: "60",
            },
          ],
          agents: [
            {
              name: "reviewer",
              role: "reviewer",
              systemPrompt: "Review changes",
              model: "openai/gpt-4o-mini",
            },
          ],
        }}
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama Local",
            endpoint: "http://localhost:11434",
            defaultModelName: "llama3",
            availableModelNames: [],
          },
          {
            id: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            defaultModelName: "openai/gpt-4o-mini",
            availableModelNames: [
              "openai/gpt-4o-mini",
              "meta-llama/llama-3.3-70b-instruct",
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Show Advanced/i }));
    await user.click(
      screen.getByRole("button", {
        name: /Models Provider-backed model pool and assignment strategy/i,
      }),
    );

    const modelNameInput = screen.getByRole("combobox", {
      name: /Model 1 Name/i,
    });
    await user.click(modelNameInput);
    await user.clear(modelNameInput);
    await user.type(modelNameInput, "llama");

    expect(screen.getByTestId("model-name-provider-group-0").textContent).toBe(
      "OpenRouter",
    );
    await user.click(
      screen.getByRole("option", {
        name: /meta-llama\/llama-3.3-70b-instruct/i,
      }),
    );

    expect(readFormState().models[0]?.name).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
    expect(readFormState().models[0]?.provider).toBe("openrouter");
    expect(readFormState().agents[0]?.model).toBe(
      "meta-llama/llama-3.3-70b-instruct",
    );
  });

  it("wraps long workspace values in the live summary instead of overflowing the sidebar", () => {
    const veryLongWorkspacePath =
      "/Users/kabudu/projex/maabarium-group/repositories/customer-workspaces/this-is-a-very-long-workspace-path-that-should-wrap-inside-the-blueprint-wizard-summary-sidebar-without-triggering-a-horizontal-scrollbar";

    render(
      <TestHarness
        initialForm={{
          ...buildWizardForm(null),
          repoPath: veryLongWorkspacePath,
        }}
      />,
    );

    expect(screen.getByText(veryLongWorkspacePath).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  it("toggles the workflow tips panel from the wizard header", async () => {
    const user = userEvent.setup();

    render(<TestHarness />);

    expect(
      document
        .getElementById("blueprint-wizard-tips-panel")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: /Show Tips/i }));

    expect(screen.getByText("Workflow Tips")).toBeTruthy();
    expect(
      screen.getByText(
        /Agent prompts should describe how the council should work/i,
      ),
    ).toBeTruthy();
    expect(
      document
        .getElementById("blueprint-wizard-tips-panel")
        ?.getAttribute("aria-hidden"),
    ).toBe("false");

    await user.click(screen.getByRole("button", { name: /^Hide$/i }));

    await waitFor(() => {
      expect(
        document
          .getElementById("blueprint-wizard-tips-panel")
          ?.getAttribute("aria-hidden"),
      ).toBe("true");
    });
  });

  it("surfaces incremental document advice when the workflow targets one named markdown file", async () => {
    const user = userEvent.setup();

    render(<TestHarness />);

    await user.click(
      screen.getByRole("button", {
        name: /Generate or refine a document/i,
      }),
    );
    await user.click(screen.getAllByRole("button", { name: /Next Step/i })[0]);
    await user.click(
      screen.getByRole("button", {
        name: /One named markdown file/i,
      }),
    );

    await user.click(screen.getByRole("button", { name: /Show Tips/i }));

    expect(screen.getByText("Incremental Document Tip")).toBeTruthy();
    expect(
      screen.getByText(/create a compact outline or heading scaffold first/i),
    ).toBeTruthy();
    expect(screen.getByText(/deepen one section per iteration/i)).toBeTruthy();
    expect(
      screen.getByText(/spell out the minimum depth you expect/i),
    ).toBeTruthy();
  });
});
