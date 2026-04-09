import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopSetupState,
  ExperimentBranchInventory,
  GitDependencyState,
  ReadinessItem,
  UpdateCheckResult,
  UpdaterConfigurationState,
} from "../../types/console";
import { ConsoleMaintenancePanel } from "./ConsoleMaintenancePanel";

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
    id: "ollama",
    title: "Ollama",
    status: "needs_attention",
    summary: "Ollama is not running.",
    actionLabel: "Start Ollama",
    lastCheckedAtEpochMs: Date.now(),
  },
];

const gitDependency: GitDependencyState = {
  installed: true,
  commandPath: "/usr/bin/git",
  autoInstallSupported: false,
  installerLabel: null,
  installCommand: null,
  statusDetail: "Git ready",
};

const experimentBranchInventory: ExperimentBranchInventory = {
  workspacePath: "/tmp/workspace",
  repositoryRoot: "/tmp/workspace",
  currentBranch: "main",
  totalBranches: 3,
  ageMetrics: {
    olderThan1Month: 1,
    olderThan3Months: 0,
    olderThan6Months: 0,
  },
  availableThresholdMonths: [1, 3, 6],
  defaultThresholdMonths: 3,
  branches: [
    {
      name: "experiment/1",
      runId: "run-1",
      iteration: 1,
      lastCommitAt: "2026-03-28T12:34:00Z",
      ageDays: 45,
      isCurrent: false,
    },
  ],
};

const updater: UpdaterConfigurationState = {
  currentVersion: "1.0.0",
  channel: "stable",
  endpoint: "https://updates.example.com/manifest.json",
  configured: true,
};

const updateCheck: UpdateCheckResult = {
  ...updater,
  available: true,
  version: "1.1.0",
  date: "2026-03-28T12:34:00Z",
  body: "Stability improvements.",
};

const desktopSetup: DesktopSetupState = {
  guidedMode: true,
  onboardingCompleted: true,
  runtimeStrategy: "mixed",
  researchSearchMode: "brave_api",
  workspacePath: "/tmp/workspace",
  selectedBlueprintPath: null,
  selectedLocalModels: [],
  remoteProviders: [],
  preferredUpdateChannel: "stable",
  remindLaterUntil: null,
  remindLaterVersion: null,
  lastSetupCompletedAt: null,
  interruptedRunNotice: null,
  environmentProfile: null,
};

describe("ConsoleMaintenancePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to readiness and lets the user switch maintenance tabs", async () => {
    const user = userEvent.setup();
    const onOpenSetup = vi.fn();

    render(
      <ConsoleMaintenancePanel
        readinessItems={readinessItems}
        experimentBranchInventory={experimentBranchInventory}
        gitDependency={gitDependency}
        ollama={null}
        updater={updater}
        desktopSetup={desktopSetup}
        updateCheck={updateCheck}
        checkingForUpdates={false}
        installingUpdate={false}
        savingPreferences={false}
        experimentCount={8}
        proposalCount={10}
        logCount={5}
        onOpenSetup={onOpenSetup}
        onInstallGit={vi.fn()}
        onInstallOllama={vi.fn()}
        onStartOllama={vi.fn()}
        onApplyFixes={vi.fn(async () => null)}
        onPreviewBranchCleanup={vi.fn(async () => null)}
        onCleanupBranches={vi.fn(async () => null)}
        onCheckForUpdates={vi.fn()}
        onInstallUpdate={vi.fn()}
        onSelectChannel={vi.fn()}
        onRemindLater={vi.fn()}
        onClearReminder={vi.fn()}
        onOpenPanel={vi.fn()}
      />,
    );

    expect(
      screen
        .getByTestId("maintenance-panel-readiness")
        .getAttribute("aria-hidden"),
    ).toBe("false");

    await user.click(screen.getByRole("button", { name: /Run Setup/i }));

    expect(onOpenSetup).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Updates/i }));

    expect(
      screen
        .getByTestId("maintenance-panel-updates")
        .getAttribute("aria-hidden"),
    ).toBe("false");
    expect(screen.getByText(/Install 1.1.0/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Persisted Stack/i }));

    expect(
      screen.getByTestId("maintenance-panel-stack").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(screen.getByText(/Open History/i)).toBeTruthy();
    expect(
      window.localStorage.getItem("maabarium.console.maintenanceTab"),
    ).toBe("stack");
  });

  it("restores the last selected maintenance tab after reload", () => {
    window.localStorage.setItem("maabarium.console.maintenanceTab", "updates");

    render(
      <ConsoleMaintenancePanel
        readinessItems={readinessItems}
        experimentBranchInventory={experimentBranchInventory}
        gitDependency={gitDependency}
        ollama={null}
        updater={updater}
        desktopSetup={desktopSetup}
        updateCheck={updateCheck}
        checkingForUpdates={false}
        installingUpdate={false}
        savingPreferences={false}
        experimentCount={8}
        proposalCount={10}
        logCount={5}
        onOpenSetup={vi.fn()}
        onInstallGit={vi.fn()}
        onInstallOllama={vi.fn()}
        onStartOllama={vi.fn()}
        onApplyFixes={vi.fn(async () => null)}
        onPreviewBranchCleanup={vi.fn(async () => null)}
        onCleanupBranches={vi.fn(async () => null)}
        onCheckForUpdates={vi.fn()}
        onInstallUpdate={vi.fn()}
        onSelectChannel={vi.fn()}
        onRemindLater={vi.fn()}
        onClearReminder={vi.fn()}
        onOpenPanel={vi.fn()}
      />,
    );

    const updatesTabButton = screen.getAllByRole("button", {
      name: /Updates/i,
    })[0];

    expect(updatesTabButton.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByTestId("maintenance-panel-updates")
        .getAttribute("aria-hidden"),
    ).toBe("false");
  });
});
