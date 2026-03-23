import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { normalizeConsoleState } from "./normalizers";
import type {
  BlueprintWizardRequest,
  ConsoleState,
  UpdateCheckResult,
} from "../types/console";

type UseDesktopConsoleArgs = {
  pollIntervalMs?: number;
};

type DesktopErrorState = {
  title: string;
  heading: string;
  description: string;
  message: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

  const toggleEngine = async () => {
    try {
      await runSnapshotCommand(
        state?.engineRunning ? "stop_engine" : "start_engine",
      );
    } catch (error) {
      presentDesktopError(
        "Run Loop Error",
        state?.engineRunning
          ? "The loop could not be stopped"
          : "The loop could not be started",
        "Review the error details below before trying the run-loop action again.",
        error,
      );
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
    toggleEngine,
    openLogFile,
    openBlueprintFile,
    openBlueprintDirectory,
    selectBlueprint,
    selectBlueprintFromLibrary,
    checkForUpdates,
    installAvailableUpdate,
    createBlueprintFromWizard,
  };
}
