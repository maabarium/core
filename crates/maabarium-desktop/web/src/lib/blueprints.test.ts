import { describe, expect, it } from "vitest";
import {
  applyWizardDeliverable,
  buildWizardForm,
  buildSuggestedWizardModels,
  inferWizardDeliverableFromForm,
  inferWizardGoalFromForm,
  parseWizardTargetFilesText,
  wizardEvaluatorLabel,
  wizardTargetMode,
} from "./blueprints";

describe("blueprint wizard derivation", () => {
  it("infers a named document workflow from an exact markdown path", () => {
    const form = {
      ...buildWizardForm(null, "prompt_optimization"),
      language: "markdown",
      targetFilesText: "docs/release-plan.md",
    };

    expect(inferWizardGoalFromForm(form)).toBe("document_workflow");
    expect(inferWizardDeliverableFromForm(form)).toBe("named_document");
    expect(wizardEvaluatorLabel(form.language)).toBe("prompt");
    expect(
      wizardTargetMode(parseWizardTargetFilesText(form.targetFilesText)),
    ).toBe("exact");
  });

  it("infers a prompt asset when the scope targets prompt markdown files", () => {
    const form = {
      ...buildWizardForm(null, "prompt_optimization"),
      language: "prompt",
      targetFilesText: "prompts/support-escalation.md",
    };

    expect(inferWizardDeliverableFromForm(form)).toBe("prompt_asset");
  });

  it("applies a deliverable by switching template defaults and normalizing agents", () => {
    const form = {
      ...buildWizardForm(null, "code_quality"),
      agents: [
        {
          name: "critic",
          role: "critic",
          systemPrompt: "Review the change.",
          model: "missing-model",
        },
      ],
    };

    const next = applyWizardDeliverable(form, "named_document");

    expect(next.template).toBe("prompt_optimization");
    expect(next.language).toBe("markdown");
    expect(next.targetFilesText).toBe("docs/project-brief.md");
    expect(next.requireTestsPass).toBe(false);
    expect(next.agents[0]?.model).toBe(next.models[0]?.name);
  });

  it("includes setup-selected local models in the suggested wizard model pool", () => {
    const suggested = buildSuggestedWizardModels({
      desktopSetup: {
        guidedMode: true,
        onboardingCompleted: true,
        runtimeStrategy: "local",
        researchSearchMode: "duckduckgo_scrape",
        workspacePath: "/tmp/workspace",
        selectedBlueprintPath: null,
        selectedLocalModels: ["qwen3.5:9b"],
        remoteProviders: [],
        preferredUpdateChannel: null,
        remindLaterUntil: null,
        remindLaterVersion: null,
        lastSetupCompletedAt: null,
        interruptedRunNotice: null,
      },
      ollama: {
        installed: true,
        running: true,
        commandAvailable: true,
        launchAtLoginSupported: true,
        installCommand: null,
        startCommand: null,
        statusDetail: "Ollama ready",
        models: [],
        recommendedModels: [],
      },
    } as never);

    expect(suggested[0]?.name).toBe("qwen3.5:9b");
  });

  it("includes native Anthropic providers in suggested remote wizard models once supported", () => {
    const suggested = buildSuggestedWizardModels({
      desktopSetup: {
        guidedMode: true,
        onboardingCompleted: true,
        runtimeStrategy: "remote",
        researchSearchMode: "duckduckgo_scrape",
        workspacePath: "/tmp/workspace",
        selectedBlueprintPath: null,
        selectedLocalModels: [],
        remoteProviders: [
          {
            providerId: "anthropic",
            label: "Anthropic",
            endpoint: "https://api.anthropic.com",
            modelName: "claude-sonnet-4",
            fallbackOnly: false,
            configured: true,
            supported: true,
            supportSummary: "Uses Anthropic's native Messages API.",
          },
          {
            providerId: "openrouter",
            label: "OpenRouter",
            endpoint: "https://openrouter.ai/api/v1",
            modelName: "openai/gpt-4o-mini",
            fallbackOnly: false,
            configured: true,
            supported: true,
            supportSummary: null,
          },
        ],
        preferredUpdateChannel: null,
        remindLaterUntil: null,
        remindLaterVersion: null,
        lastSetupCompletedAt: null,
        interruptedRunNotice: null,
        environmentProfile: null,
      },
      ollama: {
        installed: false,
        running: false,
        commandAvailable: false,
        launchAtLoginSupported: true,
        installCommand: null,
        startCommand: null,
        statusDetail: "Ollama unavailable",
        models: [],
        recommendedModels: [],
      },
    } as never);

    expect(suggested).toHaveLength(2);
    expect(suggested[0]?.provider).toBe("anthropic");
    expect(suggested[1]?.provider).toBe("openrouter");
  });
});
