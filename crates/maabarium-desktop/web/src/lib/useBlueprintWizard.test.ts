import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWizardForm } from "./blueprints";
import { useBlueprintWizard } from "./useBlueprintWizard";
import type { BlueprintWizardForm } from "../types/console";

function buildValidWizardForm(
  overrides: Partial<BlueprintWizardForm> = {},
): BlueprintWizardForm {
  return {
    ...buildWizardForm(null),
    name: "example-blueprint",
    ...overrides,
  };
}

function setupWizard(overrides: Partial<BlueprintWizardForm> = {}) {
  const presentDesktopError = vi.fn();
  const dismissDesktopError = vi.fn();
  const { result } = renderHook(() =>
    useBlueprintWizard({
      state: null,
      presentDesktopError,
      dismissDesktopError,
    }),
  );

  act(() => {
    result.current.setWizardForm(buildValidWizardForm(overrides));
  });

  return { result, presentDesktopError, dismissDesktopError };
}

describe("useBlueprintWizard", () => {
  it.each([
    {
      name: "missing version",
      overrides: { version: "" },
      message: "Blueprint version is required",
    },
    {
      name: "missing repo path",
      overrides: { repoPath: "" },
      message: "Repo path is required",
    },
    {
      name: "missing language",
      overrides: { language: "" },
      message: "Language is required",
    },
    {
      name: "absolute target path",
      overrides: { targetFilesText: "/tmp/output.md" },
      message: "Target paths must be relative to the selected workspace",
    },
    {
      name: "non-positive max iterations",
      overrides: { maxIterations: 0 },
      message:
        "Max iterations and timeout seconds must both be greater than zero",
    },
    {
      name: "non-positive timeout",
      overrides: { timeoutSeconds: 0 },
      message:
        "Max iterations and timeout seconds must both be greater than zero",
    },
    {
      name: "non-positive council size",
      overrides: { councilSize: 0 },
      message: "Council size and debate rounds must both be greater than zero",
    },
    {
      name: "non-positive debate rounds",
      overrides: { debateRounds: 0 },
      message: "Council size and debate rounds must both be greater than zero",
    },
  ])("rejects $name", ({ overrides, message }) => {
    const { result, presentDesktopError } = setupWizard(overrides);

    const request = result.current.buildWizardRequest();

    expect(request).toBeNull();
    expect(presentDesktopError).toHaveBeenCalledTimes(1);
    expect(presentDesktopError).toHaveBeenLastCalledWith(
      "Blueprint Wizard",
      "The wizard input needs attention",
      "Review the details below, then continue editing the blueprint wizard form.",
      message,
    );
  });

  it("builds a request for a valid form and parses target paths", () => {
    const { result, presentDesktopError } = setupWizard({
      targetFilesText: "src/**/*.rs\n tests/**/*.rs ",
      repoPath: " ./workspace ",
      language: " rust ",
      version: " 2.0.0 ",
    });

    const request = result.current.buildWizardRequest();

    expect(presentDesktopError).not.toHaveBeenCalled();
    expect(request).not.toBeNull();
    expect(request).toMatchObject({
      version: "2.0.0",
      repoPath: "./workspace",
      language: "rust",
      targetFiles: ["src/**/*.rs", "tests/**/*.rs"],
    });
  });

  it("normalizes malformed nested wizard state before derived hook state runs", () => {
    const { result } = setupWizard();

    act(() => {
      result.current.setWizardForm((current) => ({
        ...current,
        metrics: null as unknown as BlueprintWizardForm["metrics"],
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
      }));
    });

    expect(result.current.wizardMetricWeightTotal).toBeGreaterThan(0);
    expect(result.current.wizardForm.metrics.length).toBeGreaterThan(0);
    expect(result.current.wizardModelNames).toContain("llama3");
    expect(result.current.wizardForm.agents[0]?.model).toBe("llama3");
  });
});
