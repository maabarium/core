import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  CliLinkState,
  DesktopSetupState,
  GitDependencyState,
  ReadinessItem,
  RemoteProviderSetup,
} from "../../types/console";
import { DesktopSetupModal } from "./DesktopSetupModal";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const gitDependency: GitDependencyState = {
  installed: true,
  commandPath: "/usr/bin/git",
  autoInstallSupported: true,
  installerLabel: "Homebrew",
  installCommand: "brew install git",
  statusDetail: "Git is installed.",
};

const cliLink: CliLinkState = {
  installationSupported: true,
  platform: "macos",
  managedLinkPath: "/tmp/maabarium",
  managedLinkDirectory: "/tmp",
  targetPath: "/Applications/Maabarium.app",
  currentLinkTarget: "/Applications/Maabarium.app",
  pathContainsManagedDir: true,
  shellName: "zsh",
  shellConfigPath: "~/.zshrc",
  exportCommand: null,
  status: "healthy",
  statusDetail: "CLI is linked.",
};

const readinessItems: ReadinessItem[] = [
  {
    id: "git",
    title: "Git",
    status: "ready",
    summary: "Git is installed.",
    actionLabel: "Install Git",
    lastCheckedAtEpochMs: Date.now(),
  },
  {
    id: "research_search",
    title: "Research Search",
    status: "optional",
    summary: "Optional in this test.",
    actionLabel: "Configure Search",
    lastCheckedAtEpochMs: Date.now(),
  },
];

const baseProvider: RemoteProviderSetup = {
  providerId: "openai",
  label: "OpenAI",
  endpoint: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  fallbackOnly: false,
  configured: false,
  supported: true,
  supportSummary: null,
};

const baseSetupState: DesktopSetupState = {
  guidedMode: true,
  onboardingCompleted: false,
  runtimeStrategy: "remote",
  researchSearchMode: "duckduckgo_scrape",
  workspacePath: null,
  selectedBlueprintPath: null,
  selectedLocalModels: [],
  remoteProviders: [baseProvider],
  preferredUpdateChannel: null,
  remindLaterUntil: null,
  remindLaterVersion: null,
  lastSetupCompletedAt: null,
  interruptedRunNotice: null,
  environmentProfile: null,
};

function renderModal(options?: {
  setupState?: DesktopSetupState;
  onInspectWorkspace?: (path: string) => Promise<null>;
  onAnalyzeWorkspace?: (path: string) => Promise<null>;
}) {
  const setupState = options?.setupState;
  const onSave = vi.fn<
    (
      nextSetup: DesktopSetupState,
      apiKeys: Record<string, string>,
    ) => Promise<void>
  >(async () => undefined);
  const onValidateProvider = vi.fn(async () => ({
    providerId: "openai",
    success: true,
    latencyMs: 12,
    modelCount: 4,
    availableModels: ["gpt-4o-mini", "gpt-4.1-mini"],
    error: null,
    diagnosis: "Validated endpoint and listed 4 model(s).",
  }));
  const onInspectWorkspace =
    options?.onInspectWorkspace ?? vi.fn(async () => null);
  const onAnalyzeWorkspace =
    options?.onAnalyzeWorkspace ?? vi.fn(async () => null);

  const renderResult = render(
    <DesktopSetupModal
      isOpen
      setupState={setupState ?? baseSetupState}
      readinessItems={readinessItems}
      gitDependency={gitDependency}
      cliLink={cliLink}
      ollama={null}
      pluginRuntime={null}
      saving={false}
      onClose={() => undefined}
      onInspectWorkspace={onInspectWorkspace}
      onSave={onSave}
      onInstallGit={vi.fn(async () => undefined)}
      onInstallCliLink={vi.fn(async () => undefined)}
      onRemoveCliLink={vi.fn(async () => undefined)}
      onInstallOllama={vi.fn(async () => undefined)}
      onStartOllama={vi.fn(async () => undefined)}
      onPullRecommendedOllamaModels={vi.fn(async () => undefined)}
      onAnalyzeWorkspace={onAnalyzeWorkspace}
      onValidateProvider={onValidateProvider}
      onGetRecommendedProfile={vi.fn(async () => "mixed")}
      onApplyProfile={vi.fn(async () => ({
        runtimeStrategy: "mixed",
        researchSearchMode: "duckduckgo_scrape",
        recommendedModels: ["qwen2.5-coder:7b"],
      }))}
    />,
  );

  return {
    ...renderResult,
    onInspectWorkspace,
    onAnalyzeWorkspace,
    onSave,
    onValidateProvider,
  };
}

describe("DesktopSetupModal", () => {
  it("shows the real recommended profile label from the desktop command", async () => {
    renderModal();

    expect(
      (await screen.findByText(/Recommended for your system/i)).textContent,
    ).toContain("Recommended for your system: Mixed");
  });

  it("keeps the free scraper as the guided default even if a profile returns Brave API", async () => {
    const user = userEvent.setup();

    render(
      <DesktopSetupModal
        isOpen
        setupState={baseSetupState}
        readinessItems={readinessItems}
        gitDependency={gitDependency}
        cliLink={cliLink}
        ollama={null}
        pluginRuntime={null}
        saving={false}
        onClose={() => undefined}
        onInspectWorkspace={vi.fn(async () => null)}
        onSave={vi.fn(async () => undefined)}
        onInstallGit={vi.fn(async () => undefined)}
        onInstallCliLink={vi.fn(async () => undefined)}
        onRemoveCliLink={vi.fn(async () => undefined)}
        onInstallOllama={vi.fn(async () => undefined)}
        onStartOllama={vi.fn(async () => undefined)}
        onPullRecommendedOllamaModels={vi.fn(async () => undefined)}
        onAnalyzeWorkspace={vi.fn(async () => null)}
        onValidateProvider={vi.fn(async () => ({
          providerId: "openai",
          success: true,
          latencyMs: 12,
          modelCount: 4,
          availableModels: ["gpt-4o-mini", "gpt-4.1-mini"],
          error: null,
          diagnosis: "Validated endpoint and listed 4 model(s).",
        }))}
        onGetRecommendedProfile={vi.fn(async () => "research_heavy")}
        onApplyProfile={vi.fn(async () => ({
          runtimeStrategy: "remote",
          researchSearchMode: "brave_api",
          recommendedModels: [],
        }))}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Research Heavy/i }));
    await user.click(screen.getByText(/^Advanced$/i).closest("button")!);

    expect(screen.getAllByText(/Research Search/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Free Scraper/i })).toBeTruthy();
    expect(
      screen.queryByPlaceholderText(/Paste Brave Search API key/i),
    ).toBeNull();
  });

  it("validates supported remote providers before saving setup", async () => {
    const user = userEvent.setup();
    const { onSave, onValidateProvider } = renderModal();

    await user.type(
      screen.getByPlaceholderText(/Paste API key to store in the OS keychain/i),
      "test-api-key",
    );
    await user.click(screen.getByRole("button", { name: /Save Setup/i }));

    await waitFor(() => {
      expect(onValidateProvider).toHaveBeenCalledWith(
        "openai",
        "https://api.openai.com/v1",
        "test-api-key",
        "gpt-4o-mini",
      );
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedSetup = onSave.mock.calls[0]?.[0];
    if (!savedSetup) {
      throw new Error("Expected save handler to receive a setup payload");
    }
    expect(savedSetup.remoteProviders[0]?.configured).toBe(true);
  });

  it("saves native Anthropic provider presets after validation", async () => {
    const user = userEvent.setup();
    const { onSave, onValidateProvider } = renderModal({
      setupState: {
        ...baseSetupState,
        remoteProviders: [
          {
            providerId: "anthropic",
            label: "Anthropic",
            endpoint: "https://api.anthropic.com",
            modelName: "claude-sonnet-4",
            fallbackOnly: false,
            configured: false,
            supported: true,
            supportSummary: "Uses Anthropic's native Messages API.",
          },
        ],
      },
    });

    onValidateProvider.mockResolvedValueOnce({
      providerId: "anthropic",
      success: true,
      latencyMs: 18,
      modelCount: 0,
      availableModels: [],
      error: null,
      diagnosis:
        "Connected to Anthropic in 18ms using model 'claude-sonnet-4'.",
    });

    await user.type(
      screen.getByPlaceholderText(/Paste API key to store in the OS keychain/i),
      "anthropic-test-key",
    );

    await user.click(screen.getByRole("button", { name: /Save Setup/i }));

    await waitFor(() => {
      expect(onValidateProvider).toHaveBeenCalledWith(
        "anthropic",
        "https://api.anthropic.com",
        "anthropic-test-key",
        "claude-sonnet-4",
      );
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const savedSetup = onSave.mock.calls[0]?.[0];
    if (!savedSetup) {
      throw new Error("Expected save handler to receive a setup payload");
    }
    expect(savedSetup.remoteProviders[0]?.configured).toBe(true);
  });

  it("applies suggested Gemini model shortcuts in the setup modal", async () => {
    const user = userEvent.setup();

    renderModal({
      setupState: {
        ...baseSetupState,
        remoteProviders: [
          {
            providerId: "gemini",
            label: "Gemini",
            endpoint: "https://generativelanguage.googleapis.com",
            modelName: null,
            fallbackOnly: false,
            configured: false,
            supported: true,
            supportSummary: "Uses Gemini's native generateContent API.",
          },
        ],
      },
    });

    await user.click(screen.getByRole("button", { name: /Gemini 2.5 Flash/i }));

    expect(screen.getByDisplayValue("gemini-2.5-flash")).toBeTruthy();
  });

  it("keeps advanced mode selected across parent setupState rerenders", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();

    const advancedButton = screen.getByText(/^Advanced$/i).closest("button");
    if (!advancedButton) {
      throw new Error("Expected Advanced mode button to be rendered");
    }

    await user.click(advancedButton);

    expect(screen.getByText(/Advanced Controls/i)).toBeTruthy();
    expect(screen.queryByText(/^Environment Profile$/i)).toBeNull();

    rerender(
      <DesktopSetupModal
        isOpen
        setupState={{
          ...baseSetupState,
          remoteProviders: [...baseSetupState.remoteProviders],
        }}
        readinessItems={readinessItems}
        gitDependency={gitDependency}
        cliLink={cliLink}
        ollama={null}
        pluginRuntime={null}
        saving={false}
        onClose={() => undefined}
        onInspectWorkspace={vi.fn(async () => null)}
        onSave={vi.fn(async () => undefined)}
        onInstallGit={vi.fn(async () => undefined)}
        onInstallCliLink={vi.fn(async () => undefined)}
        onRemoveCliLink={vi.fn(async () => undefined)}
        onInstallOllama={vi.fn(async () => undefined)}
        onStartOllama={vi.fn(async () => undefined)}
        onPullRecommendedOllamaModels={vi.fn(async () => undefined)}
        onAnalyzeWorkspace={vi.fn(async () => null)}
        onValidateProvider={vi.fn(async () => ({
          providerId: "openai",
          success: true,
          latencyMs: 12,
          modelCount: 4,
          availableModels: ["gpt-4o-mini", "gpt-4.1-mini"],
          error: null,
          diagnosis: "Validated endpoint and listed 4 model(s).",
        }))}
        onGetRecommendedProfile={vi.fn(async () => "mixed")}
        onApplyProfile={vi.fn(async () => ({
          runtimeStrategy: "mixed",
          researchSearchMode: "duckduckgo_scrape",
          recommendedModels: ["qwen2.5-coder:7b"],
        }))}
      />,
    );

    expect(screen.getByText(/Advanced Controls/i)).toBeTruthy();
    expect(screen.queryByText(/^Environment Profile$/i)).toBeNull();
  });

  it("does not re-run workspace inspection on same-path parent rerenders", async () => {
    const onInspectWorkspace = vi.fn(async () => null);
    const onAnalyzeWorkspace = vi.fn(async () => null);
    const { rerender } = renderModal({
      setupState: {
        ...baseSetupState,
        workspacePath: "/tmp/workspace",
      },
      onInspectWorkspace,
      onAnalyzeWorkspace,
    });

    await waitFor(() => {
      expect(onInspectWorkspace).toHaveBeenCalledTimes(1);
      expect(onAnalyzeWorkspace).toHaveBeenCalledTimes(1);
    });

    const nextInspectWorkspace = vi.fn(async () => null);
    const nextAnalyzeWorkspace = vi.fn(async () => null);

    rerender(
      <DesktopSetupModal
        isOpen
        setupState={{
          ...baseSetupState,
          workspacePath: "/tmp/workspace",
          remoteProviders: [...baseSetupState.remoteProviders],
        }}
        readinessItems={readinessItems}
        gitDependency={gitDependency}
        cliLink={cliLink}
        ollama={null}
        pluginRuntime={null}
        saving={false}
        onClose={() => undefined}
        onInspectWorkspace={nextInspectWorkspace}
        onSave={vi.fn(async () => undefined)}
        onInstallGit={vi.fn(async () => undefined)}
        onInstallCliLink={vi.fn(async () => undefined)}
        onRemoveCliLink={vi.fn(async () => undefined)}
        onInstallOllama={vi.fn(async () => undefined)}
        onStartOllama={vi.fn(async () => undefined)}
        onPullRecommendedOllamaModels={vi.fn(async () => undefined)}
        onAnalyzeWorkspace={nextAnalyzeWorkspace}
        onValidateProvider={vi.fn(async () => ({
          providerId: "openai",
          success: true,
          latencyMs: 12,
          modelCount: 4,
          availableModels: ["gpt-4o-mini", "gpt-4.1-mini"],
          error: null,
          diagnosis: "Validated endpoint and listed 4 model(s).",
        }))}
        onGetRecommendedProfile={vi.fn(async () => "mixed")}
        onApplyProfile={vi.fn(async () => ({
          runtimeStrategy: "mixed",
          researchSearchMode: "duckduckgo_scrape",
          recommendedModels: ["qwen2.5-coder:7b"],
        }))}
      />,
    );

    await waitFor(() => {
      expect(onInspectWorkspace).toHaveBeenCalledTimes(1);
      expect(onAnalyzeWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(nextInspectWorkspace).not.toHaveBeenCalled();
    expect(nextAnalyzeWorkspace).not.toHaveBeenCalled();
  });

  it("discovers custom provider models without requiring a manual model entry", async () => {
    const user = userEvent.setup();
    const { onValidateProvider } = renderModal({
      setupState: {
        ...baseSetupState,
        remoteProviders: [
          {
            providerId: "custom",
            label: "OpenAI-Compatible Custom",
            endpoint: "https://integrate.api.nvidia.com/v1",
            modelName: null,
            availableModelNames: [],
            fallbackOnly: false,
            configured: false,
            supported: true,
            supportSummary:
              "Use this when your provider exposes an OpenAI-compatible /chat/completions API.",
          },
        ],
      },
    });

    onValidateProvider.mockResolvedValueOnce({
      providerId: "custom",
      success: true,
      latencyMs: 25,
      modelCount: 2,
      availableModels: ["google/gemma-3-27b-it", "meta/llama-3.3-70b-instruct"],
      error: null,
      diagnosis: "Validated endpoint and listed 2 model(s).",
    });

    await user.type(
      screen.getByPlaceholderText(/Paste API key to store in the OS keychain/i),
      "custom-key",
    );
    await user.click(
      screen.getByRole("button", { name: /Validate Provider/i }),
    );

    await waitFor(() => {
      expect(onValidateProvider).toHaveBeenCalledWith(
        "custom",
        "https://integrate.api.nvidia.com/v1",
        "custom-key",
        null,
      );
    });

    const modelInput = screen.getByPlaceholderText(
      /Search discovered model ids/i,
    );

    await user.click(modelInput);
    await user.clear(modelInput);
    await user.type(modelInput, "gemma");

    expect(
      screen.getByRole("option", {
        name: /google\/gemma-3-27b-it/i,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("option", {
        name: /meta\/llama-3.3-70b-instruct/i,
      }),
    ).toBeNull();

    await user.click(
      screen.getByRole("option", {
        name: /google\/gemma-3-27b-it/i,
      }),
    );

    expect(screen.getByDisplayValue("google/gemma-3-27b-it")).toBeTruthy();
  });

  it("blocks setup save until a validated provider default model is chosen", async () => {
    const user = userEvent.setup();
    const { onSave, onValidateProvider } = renderModal({
      setupState: {
        ...baseSetupState,
        remoteProviders: [
          {
            providerId: "custom",
            label: "OpenAI-Compatible Custom",
            endpoint: "https://integrate.api.nvidia.com/v1",
            modelName: null,
            availableModelNames: [],
            fallbackOnly: false,
            configured: false,
            supported: true,
            supportSummary:
              "Use this when your provider exposes an OpenAI-compatible /chat/completions API.",
          },
        ],
      },
    });

    onValidateProvider.mockResolvedValue({
      providerId: "custom",
      success: true,
      latencyMs: 25,
      modelCount: 2,
      availableModels: ["google/gemma-3-27b-it", "meta/llama-3.3-70b-instruct"],
      error: null,
      diagnosis: "Validated endpoint and listed 2 model(s).",
    });

    await user.type(
      screen.getByPlaceholderText(/Paste API key to store in the OS keychain/i),
      "custom-key",
    );
    await user.click(screen.getByRole("button", { name: /Save Setup/i }));

    await waitFor(() => {
      expect(onValidateProvider).toHaveBeenCalledWith(
        "custom",
        "https://integrate.api.nvidia.com/v1",
        "custom-key",
        null,
      );
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /Choose a default model for OpenAI-Compatible Custom before saving setup/i,
      ),
    ).toBeTruthy();
  });
});
