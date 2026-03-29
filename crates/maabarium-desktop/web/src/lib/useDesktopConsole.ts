import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  normalizeConsoleState,
  normalizeExperimentBranchCleanupResult,
} from "./normalizers";
import { listOllamaModelNames } from "./ollama";
import type {
  BlueprintFile,
  BlueprintWizardRequest,
  ConsoleState,
  DesktopSetupState,
  ExperimentBranchCleanupResult,
  ExperimentBranchInventory,
  StartEngineRequest,
  UpdateCheckResult,
  WorkspaceGitStatus,
} from "../types/console";

declare global {
  interface Window {
    __MAABARIUM_MOCK_CONSOLE_STATE__?: ConsoleState;
    __MAABARIUM_MOCK_UPDATE_CHECK__?: UpdateCheckResult | null;
  }
}

type UseDesktopConsoleArgs = {
  pollIntervalMs?: number;
};

type DesktopErrorState = {
  title: string;
  heading: string;
  description: string;
  message: string;
};

type RetainedWinnerArchiveDownload = {
  fileName: string;
  bytes: number[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readMockConsoleState(): ConsoleState | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.__MAABARIUM_MOCK_CONSOLE_STATE__
    ? normalizeConsoleState(window.__MAABARIUM_MOCK_CONSOLE_STATE__)
    : null;
}

function readMockUpdateCheck(): UpdateCheckResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.__MAABARIUM_MOCK_UPDATE_CHECK__ ?? null;
}

function writeMockConsoleState(snapshot: ConsoleState) {
  if (typeof window !== "undefined") {
    window.__MAABARIUM_MOCK_CONSOLE_STATE__ = snapshot;
  }
}

function writeMockUpdateCheck(updateCheck: UpdateCheckResult | null) {
  if (typeof window !== "undefined") {
    window.__MAABARIUM_MOCK_UPDATE_CHECK__ = updateCheck;
  }
}

function isMockMode() {
  return readMockConsoleState() !== null;
}

type ExperimentBranchCleanupResponse = {
  snapshot: ConsoleState;
  result: ExperimentBranchCleanupResult;
};

function staleCountForThreshold(
  inventory: ExperimentBranchInventory,
  thresholdMonths: number,
) {
  switch (thresholdMonths) {
    case 1:
      return inventory.ageMetrics.olderThan1Month;
    case 3:
      return inventory.ageMetrics.olderThan3Months;
    case 6:
      return inventory.ageMetrics.olderThan6Months;
    default:
      return inventory.branches.filter(
        (branch) => (branch.ageDays ?? -1) >= thresholdMonths * 30,
      ).length;
  }
}

function buildMockCleanupResult(
  inventory: ExperimentBranchInventory,
  thresholdMonths: number,
  dryRun: boolean,
): ExperimentBranchCleanupResult {
  const thresholdDays = thresholdMonths * 30;
  const matchedBranches = inventory.branches.filter(
    (branch) => (branch.ageDays ?? -1) >= thresholdDays,
  );
  const deletedEntries = matchedBranches.filter((branch) => !branch.isCurrent);
  const skippedEntries = matchedBranches.filter((branch) => branch.isCurrent);

  return {
    thresholdMonths,
    dryRun,
    matchedBranchCount: matchedBranches.length,
    deletedBranchCount: dryRun ? 0 : deletedEntries.length,
    skippedBranchCount: skippedEntries.length,
    currentBranchProtected: skippedEntries.length > 0,
    summary:
      matchedBranches.length === 0
        ? `No experiment branches are older than ${thresholdMonths} month(s).`
        : dryRun
          ? `Dry run matched ${matchedBranches.length} experiment branch(es) older than ${thresholdMonths} month(s).`
          : `Deleted ${deletedEntries.length} stale experiment branch(es); ${skippedEntries.length} were skipped.`,
    branches: matchedBranches.map((branch) => ({
      name: branch.name,
      ageDays: branch.ageDays,
      lastCommitAt: branch.lastCommitAt,
      action: branch.isCurrent ? "skip_current" : ("delete" as const),
      reason: branch.isCurrent
        ? "The currently checked out branch is protected from cleanup."
        : null,
    })),
  };
}

function inventoryAfterMockCleanup(
  inventory: ExperimentBranchInventory,
  thresholdMonths: number,
) {
  const thresholdDays = thresholdMonths * 30;
  const branches = inventory.branches.filter(
    (branch) => branch.isCurrent || (branch.ageDays ?? -1) < thresholdDays,
  );

  return {
    ...inventory,
    totalBranches: branches.length,
    ageMetrics: {
      olderThan1Month: staleCountForThreshold(
        { ...inventory, branches } as ExperimentBranchInventory,
        1,
      ),
      olderThan3Months: staleCountForThreshold(
        { ...inventory, branches } as ExperimentBranchInventory,
        3,
      ),
      olderThan6Months: staleCountForThreshold(
        { ...inventory, branches } as ExperimentBranchInventory,
        6,
      ),
    },
    branches,
  } satisfies ExperimentBranchInventory;
}

export function useDesktopConsole({
  pollIntervalMs = 1500,
}: UseDesktopConsoleArgs = {}) {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [desktopError, setDesktopError] = useState<DesktopErrorState | null>(
    null,
  );
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(
    null,
  );
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [switchingBlueprintPath, setSwitchingBlueprintPath] = useState<
    string | null
  >(null);

  const applySnapshot = (snapshot: ConsoleState) => {
    setState(normalizeConsoleState(snapshot));
    setActionError(null);
  };

  const refresh = async () => {
    const mockSnapshot = readMockConsoleState();
    if (mockSnapshot) {
      setState(mockSnapshot);
      setUpdateCheck(readMockUpdateCheck());
      setActionError(null);
      setLoading(false);
      return;
    }

    try {
      const snapshot = await invoke<ConsoleState>("get_console_state");
      applySnapshot(snapshot);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (readMockConsoleState()) {
      void refresh();
      return;
    }

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => window.clearInterval(interval);
  }, [pollIntervalMs]);

  const runSnapshotCommand = async (
    command: string,
    args?: Record<string, unknown>,
  ) => {
    const snapshot = await invoke<ConsoleState>(command, args);
    applySnapshot(snapshot);
    return snapshot;
  };

  const presentDesktopError = (
    title: string,
    heading: string,
    description: string,
    error: unknown,
  ) => {
    setDesktopError({
      title,
      heading,
      description,
      message: errorMessage(error),
    });
  };

  const startEngine = async (request: StartEngineRequest) => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextWorkspacePath = request.workspacePath?.trim() || null;
      const nextSnapshot = {
        ...snapshot,
        engineRunning: true,
        runState: {
          status: "running" as const,
          blueprintName: snapshot.blueprint?.blueprint.name ?? null,
          workspacePath:
            nextWorkspacePath ??
            snapshot.blueprint?.domain.repo_path ??
            snapshot.desktopSetup.workspacePath ??
            null,
          currentIteration: 1,
          maxIterations: snapshot.blueprint?.constraints.max_iterations ?? null,
          phase: "starting",
          latestScore: null,
          latestDurationMs: null,
          currentIterationElapsedMs: 0,
          startedAtEpochMs: Date.now(),
          message: "Preparing engine run",
        },
        desktopSetup: {
          ...snapshot.desktopSetup,
          workspacePath: request.saveWorkspaceAsDefault
            ? (nextWorkspacePath ?? snapshot.desktopSetup.workspacePath ?? null)
            : (snapshot.desktopSetup.workspacePath ?? null),
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("start_engine", { request });
      return true;
    } catch (error) {
      presentDesktopError(
        "Run Flow Error",
        "The flow could not be started",
        "Review the workspace and git preparation details below before trying the run-flow action again.",
        error,
      );
      return false;
    }
  };

  const stopEngine = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        engineRunning: false,
        runState: {
          ...snapshot.runState,
          status: "idle" as const,
          phase: null,
          message: null,
          currentIteration: null,
          currentIterationElapsedMs: null,
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("stop_engine");
      return true;
    } catch (error) {
      presentDesktopError(
        "Run Flow Error",
        "The flow could not be stopped",
        "Review the error details below before trying the stop action again.",
        error,
      );
      return false;
    }
  };

  const openLogFile = async () => {
    try {
      await invoke("open_log_file");
      setActionError(null);
    } catch (error) {
      presentDesktopError(
        "File Open Error",
        "The log file could not be opened",
        "The desktop app could not hand the log file off to the system viewer.",
        error,
      );
    }
  };

  const openBlueprintFile = async () => {
    try {
      await invoke("open_blueprint_file");
      setActionError(null);
    } catch (error) {
      presentDesktopError(
        "File Open Error",
        "The blueprint file could not be opened",
        "The desktop app could not hand the selected blueprint file off to the system viewer.",
        error,
      );
    }
  };

  const openBlueprintDirectory = async () => {
    try {
      await invoke("open_blueprint_directory");
      setActionError(null);
    } catch (error) {
      presentDesktopError(
        "Folder Open Error",
        "The blueprint folder could not be opened",
        "The desktop app could not open the blueprint directory in the system file browser.",
        error,
      );
    }
  };

  const openRepositoryLicense = async () => {
    try {
      await invoke("open_repository_license");
      setActionError(null);
    } catch (error) {
      presentDesktopError(
        "License Open Error",
        "The repository license could not be opened",
        "The desktop app could not hand the bundled or local LICENSE file off to the system viewer.",
        error,
      );
    }
  };

  const exportRetainedWinnerFiles = async (experimentId: number) => {
    try {
      const archive = await invoke<RetainedWinnerArchiveDownload>(
        "export_retained_winner_files",
        {
          experimentId,
        },
      );
      setActionError(null);
      return archive;
    } catch (error) {
      presentDesktopError(
        "Artifact Export Error",
        "The retained winner files could not be exported",
        "The desktop app could not package the promoted files for this retained winner. Review the error details below, then retry the export.",
        error,
      );
      return null;
    }
  };

  const setBlueprintPath = async (path: string) => {
    await runSnapshotCommand("set_blueprint_path", { path });
    setDesktopError(null);
  };

  const selectBlueprint = async () => {
    try {
      const selectedPath = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Blueprint", extensions: ["toml"] }],
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }

      await setBlueprintPath(selectedPath);
    } catch (error) {
      presentDesktopError(
        "Blueprint Validation",
        "This file or flow could not be opened",
        "Review the validation details below, then dismiss this dialog to try a different blueprint.",
        error,
      );
    }
  };

  const selectBlueprintFromLibrary = async (path: string) => {
    if (!path || path === state?.blueprintPath || switchingBlueprintPath) {
      return;
    }

    try {
      setSwitchingBlueprintPath(path);
      await setBlueprintPath(path);
    } catch (error) {
      presentDesktopError(
        "Blueprint Validation",
        "This file or flow could not be opened",
        "Review the validation details below, then dismiss this dialog to try a different blueprint.",
        error,
      );
    } finally {
      setSwitchingBlueprintPath(null);
    }
  };

  const checkForUpdates = async () => {
    if (isMockMode()) {
      setCheckingForUpdates(true);
      try {
        setUpdateCheck(readMockUpdateCheck());
        setActionError(null);
      } finally {
        setCheckingForUpdates(false);
      }
      return;
    }

    try {
      setCheckingForUpdates(true);
      const result = await invoke<UpdateCheckResult>("check_for_updates");
      setUpdateCheck(result);
      setActionError(null);
    } catch (error) {
      presentDesktopError(
        "Updater Error",
        "Update check failed",
        "The desktop app could not complete the update check. Review the details below before trying again.",
        error,
      );
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const installAvailableUpdate = async () => {
    if (isMockMode()) {
      setInstallingUpdate(true);
      try {
        const current = readMockUpdateCheck();
        const next = current ? { ...current, available: false } : null;
        writeMockUpdateCheck(next);
        setUpdateCheck(next);
        setActionError(null);
      } finally {
        setInstallingUpdate(false);
      }
      return;
    }

    try {
      setInstallingUpdate(true);
      const result = await invoke<{ installed: boolean }>(
        "install_available_update",
      );

      if (result.installed) {
        setActionError(null);
        setUpdateCheck((current) =>
          current
            ? {
                ...current,
                available: false,
              }
            : current,
        );
      }
    } catch (error) {
      presentDesktopError(
        "Updater Error",
        "Update install failed",
        "The desktop app could not install the available update. Review the details below before retrying.",
        error,
      );
    } finally {
      setInstallingUpdate(false);
    }
  };

  const createBlueprintFromWizard = async (request: BlueprintWizardRequest) => {
    try {
      await runSnapshotCommand("create_blueprint_from_wizard", {
        request,
      });
      return true;
    } catch (error) {
      presentDesktopError(
        "Blueprint Creation Error",
        "The blueprint could not be created",
        "Review the details below, then adjust the wizard inputs or desktop environment before trying again.",
        error,
      );
      return false;
    }
  };

  const updateBlueprintFromWizard = async (
    path: string,
    request: BlueprintWizardRequest,
  ) => {
    try {
      await runSnapshotCommand("update_blueprint_from_wizard", {
        path,
        request,
      });
      return true;
    } catch (error) {
      presentDesktopError(
        "Blueprint Update Error",
        "The blueprint could not be updated",
        "Review the details below, then adjust the wizard inputs or desktop environment before trying again.",
        error,
      );
      return false;
    }
  };

  const loadBlueprintForWizard = async (path: string) => {
    try {
      return await invoke<BlueprintFile>("load_blueprint_for_wizard", {
        path,
      });
    } catch (error) {
      presentDesktopError(
        "Blueprint Load Error",
        "The blueprint could not be opened in the wizard",
        "Review the details below, then retry from the workflow library or active workflow panel.",
        error,
      );
      return null;
    }
  };

  const inspectWorkspaceGitStatus = useCallback(async (path: string) => {
    try {
      return await invoke<WorkspaceGitStatus>("inspect_workspace_git_status", {
        path,
      });
    } catch (error) {
      setDesktopError({
        title: "Workspace Inspection Error",
        heading: "The workspace could not be inspected",
        description:
          "Review the details below, then retry after selecting a valid folder.",
        message: errorMessage(error),
      });
      return null;
    }
  }, []);

  const initializeWorkspaceGit = async (path: string) => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      applySnapshot(snapshot);
      return true;
    }

    try {
      await runSnapshotCommand("initialize_workspace_git", { path });
      return true;
    } catch (error) {
      presentDesktopError(
        "Workspace Initialization Error",
        "Git could not be initialized for this workspace",
        "Review the details below, then retry after selecting a writable folder.",
        error,
      );
      return false;
    }
  };

  const saveDesktopSetup = async (setup: DesktopSetupState) => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        desktopSetup: setup,
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      setDesktopError(null);
      return true;
    }

    try {
      await runSnapshotCommand("save_desktop_setup", { setup });
      setDesktopError(null);
      return true;
    } catch (error) {
      presentDesktopError(
        "Setup Error",
        "Desktop setup could not be saved",
        "Review the details below, then retry the setup flow.",
        error,
      );
      return false;
    }
  };

  const setProviderApiKey = async (providerId: string, apiKey: string) => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        desktopSetup: {
          ...snapshot.desktopSetup,
          remoteProviders: snapshot.desktopSetup.remoteProviders.map(
            (provider) =>
              provider.providerId === providerId
                ? {
                    ...provider,
                    configured:
                      apiKey.trim().length > 0 &&
                      Boolean(provider.modelName?.trim()),
                  }
                : provider,
          ),
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("set_provider_api_key", {
        providerId,
        apiKey,
      });
      return true;
    } catch (error) {
      presentDesktopError(
        "Provider Setup Error",
        "The provider credential could not be stored",
        "Review the details below, then retry saving the provider credentials.",
        error,
      );
      return false;
    }
  };

  const installOllama = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        ollama: {
          ...snapshot.ollama,
          installed: true,
          commandAvailable: true,
          statusDetail:
            "Ollama appears installed in mock mode, but the local service is not running yet.",
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("install_ollama");
      return true;
    } catch (error) {
      presentDesktopError(
        "Ollama Install Error",
        "Ollama could not be installed",
        "Review the details below, then retry the guided local runtime setup.",
        error,
      );
      return false;
    }
  };

  const installGit = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        readinessItems: snapshot.readinessItems.map((item) =>
          item.id === "git"
            ? {
                ...item,
                status: "ready" as const,
                summary:
                  "Git is installed and ready for isolated worktree operations.",
                actionLabel: "Git Ready",
              }
            : item,
        ),
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("install_git");
      return true;
    } catch (error) {
      presentDesktopError(
        "Git Install Error",
        "Git could not be installed automatically",
        "Review the details below, complete any OS installer steps if prompted, then retry the workflow.",
        error,
      );
      return false;
    }
  };

  const startOllama = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        ollama: {
          ...snapshot.ollama,
          installed: true,
          running: true,
          commandAvailable: true,
          statusDetail:
            "Ollama is running in mock mode with local models ready.",
          models:
            snapshot.ollama.models.length > 0
              ? snapshot.ollama.models
              : listOllamaModelNames(snapshot.ollama).map((name) => ({
                  name,
                  sizeLabel: null,
                  modifiedAt: null,
                })),
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("start_ollama");
      return true;
    } catch (error) {
      presentDesktopError(
        "Ollama Start Error",
        "Ollama could not be started",
        "Review the details below, then retry the local runtime start action.",
        error,
      );
      return false;
    }
  };

  const pullRecommendedOllamaModels = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const existingModelNames = new Set(
        snapshot.ollama.models.map((model) => model.name),
      );
      const missingRecommendedModels = snapshot.ollama.recommendedModels.filter(
        (modelName) => !existingModelNames.has(modelName),
      );
      const nextSnapshot = {
        ...snapshot,
        ollama: {
          ...snapshot.ollama,
          installed: true,
          running: true,
          commandAvailable: true,
          statusDetail:
            missingRecommendedModels.length > 0
              ? `Ollama is running in mock mode with ${snapshot.ollama.models.length + missingRecommendedModels.length} installed local model(s).`
              : snapshot.ollama.statusDetail,
          models: [
            ...snapshot.ollama.models,
            ...missingRecommendedModels.map((name) => ({
              name,
              sizeLabel: null,
              modifiedAt: null,
            })),
          ],
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("pull_recommended_ollama_models");
      return true;
    } catch (error) {
      presentDesktopError(
        "Ollama Model Pull Error",
        "Recommended Ollama models could not be pulled",
        "Review the details below, then retry after confirming Ollama is installed and running.",
        error,
      );
      return false;
    }
  };

  const installCliLink = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        cliLink: {
          ...snapshot.cliLink,
          installationSupported: true,
          platform: snapshot.cliLink.platform || "macos",
          status: "healthy" as const,
          statusDetail:
            "The managed CLI link resolves to the bundled desktop CLI.",
          currentLinkTarget: snapshot.cliLink.targetPath,
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("install_cli_link");
      return true;
    } catch (error) {
      presentDesktopError(
        "CLI Install Error",
        "The shell CLI link could not be installed",
        "Review the details below, then retry the managed CLI install action.",
        error,
      );
      return false;
    }
  };

  const removeCliLink = async () => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot) {
        return false;
      }

      const nextSnapshot = {
        ...snapshot,
        cliLink: {
          ...snapshot.cliLink,
          status: "not_installed" as const,
          statusDetail:
            "No managed CLI link is installed yet. Install one to make `maabarium` available from your shell.",
          currentLinkTarget: null,
        },
      };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return true;
    }

    try {
      await runSnapshotCommand("remove_cli_link");
      return true;
    } catch (error) {
      presentDesktopError(
        "CLI Removal Error",
        "The shell CLI link could not be removed",
        "Review the details below, then retry the managed CLI removal action.",
        error,
      );
      return false;
    }
  };

  const runExperimentBranchCleanup = async (
    thresholdMonths: number,
    dryRun: boolean,
  ) => {
    if (isMockMode()) {
      const snapshot = readMockConsoleState();
      if (!snapshot?.experimentBranchInventory) {
        return null;
      }

      const result = buildMockCleanupResult(
        snapshot.experimentBranchInventory,
        thresholdMonths,
        dryRun,
      );
      const nextSnapshot = dryRun
        ? snapshot
        : {
            ...snapshot,
            experimentBranchInventory: inventoryAfterMockCleanup(
              snapshot.experimentBranchInventory,
              thresholdMonths,
            ),
          };
      writeMockConsoleState(nextSnapshot);
      applySnapshot(nextSnapshot);
      return result;
    }

    try {
      const response = await invoke<ExperimentBranchCleanupResponse>(
        "cleanup_experiment_branches_command",
        {
          olderThanMonths: thresholdMonths,
          dryRun,
        },
      );
      applySnapshot(response.snapshot);
      setDesktopError(null);
      return normalizeExperimentBranchCleanupResult(response.result);
    } catch (error) {
      presentDesktopError(
        "Branch Maintenance Error",
        dryRun
          ? "The cleanup preview could not be generated"
          : "Stale experiment branches could not be cleaned up",
        dryRun
          ? "Review the repository details below, then retry the dry-run preview."
          : "Review the repository details below before retrying the cleanup action.",
        error,
      );
      return null;
    }
  };

  const previewExperimentBranchCleanup = async (thresholdMonths: number) =>
    runExperimentBranchCleanup(thresholdMonths, true);

  const cleanupExperimentBranches = async (thresholdMonths: number) =>
    runExperimentBranchCleanup(thresholdMonths, false);

  return {
    state,
    loading,
    actionError,
    setActionError,
    desktopError,
    presentDesktopError,
    dismissDesktopError: () => setDesktopError(null),
    updateCheck,
    checkingForUpdates,
    installingUpdate,
    switchingBlueprintPath,
    startEngine,
    stopEngine,
    openLogFile,
    openBlueprintFile,
    openBlueprintDirectory,
    openRepositoryLicense,
    selectBlueprint,
    selectBlueprintFromLibrary,
    checkForUpdates,
    installAvailableUpdate,
    createBlueprintFromWizard,
    updateBlueprintFromWizard,
    loadBlueprintForWizard,
    inspectWorkspaceGitStatus,
    initializeWorkspaceGit,
    saveDesktopSetup,
    setProviderApiKey,
    installGit,
    installOllama,
    startOllama,
    pullRecommendedOllamaModels,
    installCliLink,
    removeCliLink,
    exportRetainedWinnerFiles,
    previewExperimentBranchCleanup,
    cleanupExperimentBranches,
  };
}
