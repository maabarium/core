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
}: {
  inspectWorkspace?: (path: string) => Promise<WorkspaceGitStatus | null>;
  initialForm?: BlueprintWizardForm;
  localModelOptions?: string[];
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
        providerOptions={[
          {
            id: "ollama",
            label: "Ollama",
            endpoint: "http://localhost:11434",
            defaultModelName: safeModelNames[0] || "llama3",
          },
        ]}
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
        addMetric={() => undefined}
        updateMetric={() => undefined}
        removeMetric={() => undefined}
        addAgent={() => undefined}
        updateAgent={() => undefined}
        removeAgent={() => undefined}
        addModel={() => undefined}
        updateModel={() => undefined}
        removeModel={() => undefined}
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

    const runtimeComboboxes = screen.getAllByRole("combobox");
    await user.selectOptions(runtimeComboboxes[2], "beta-model");

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

    const runtimeComboboxes = screen.getAllByRole("combobox");

    expect(
      screen.getByRole("option", { name: /Ollama Local • qwen3.5:9b/i }),
    ).toBeTruthy();

    await user.selectOptions(runtimeComboboxes[2], "qwen3.5:9b");

    expect(readFormState().models[0]?.name).toBe("qwen3.5:9b");
    expect(readFormState().models[0]?.provider).toBe("ollama");
    expect(readFormState().agents.map((agent) => agent.model)).toEqual([
      "qwen3.5:9b",
    ]);
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
      "break-words",
    );
    expect(screen.getByText(veryLongWorkspacePath).className).toContain(
      "[overflow-wrap:anywhere]",
    );
  });
});
