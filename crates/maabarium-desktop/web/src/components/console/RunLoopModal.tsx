import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { WorkspaceGitStatus } from "../../types/console";

type RunLoopModalProps = {
  isOpen: boolean;
  activeBlueprintName: string | null;
  defaultWorkspacePath: string;
  savedWorkspacePath: string | null;
  submitting: boolean;
  onClose: () => void;
  onInspectWorkspace: (path: string) => Promise<WorkspaceGitStatus | null>;
  onStart: (
    workspacePath: string,
    initializeGitIfNeeded: boolean,
    saveWorkspaceAsDefault: boolean,
  ) => Promise<void>;
};

function ToggleRow({
  checked,
  onChange,
  title,
  description,
  emphasis = "primary",
}: {
  checked: boolean;
  onChange: (nextValue: boolean) => void;
  title: string;
  description: string;
  emphasis?: "primary" | "secondary";
}) {
  const isSecondary = emphasis === "secondary";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start justify-between gap-4 rounded-xl border px-4 py-4 text-left transition ${isSecondary ? "border-white/5 bg-white/[0.03] hover:bg-white/[0.06]" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
    >
      <div>
        <div
          className={`text-sm font-bold ${isSecondary ? "text-slate-300" : "text-slate-100"}`}
        >
          {title}
        </div>
        <div
          className={`mt-1 text-xs leading-relaxed ${isSecondary ? "text-slate-500" : "text-slate-400"}`}
        >
          {description}
        </div>
      </div>
      <span className="mt-0.5 flex shrink-0 items-center gap-3">
        <span
          className={`text-[10px] font-black uppercase tracking-[0.16em] ${checked ? "text-teal-200" : "text-slate-500"}`}
        >
          {checked ? "On" : "Off"}
        </span>
        <span
          className={`relative inline-flex h-7 w-12 rounded-full border transition ${checked ? "border-teal-300/50 bg-teal-500/70" : isSecondary ? "border-white/10 bg-slate-950/90" : "border-white/15 bg-slate-900"}`}
        >
          <span
            className={`absolute top-[3px] h-5 w-5 rounded-full shadow transition ${checked ? "left-[1.45rem] bg-slate-950" : "left-[3px] bg-white"}`}
          />
        </span>
      </span>
    </button>
  );
}

export function RunLoopModal({
  isOpen,
  activeBlueprintName,
  defaultWorkspacePath,
  savedWorkspacePath,
  submitting,
  onClose,
  onInspectWorkspace,
  onStart,
}: RunLoopModalProps) {
  const [workspacePath, setWorkspacePath] = useState(defaultWorkspacePath);
  const [initializeGitIfNeeded, setInitializeGitIfNeeded] = useState(true);
  const [saveWorkspaceAsDefault, setSaveWorkspaceAsDefault] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceGitStatus | null>(null);
  const [inspectingWorkspace, setInspectingWorkspace] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setWorkspacePath(defaultWorkspacePath);
    setInitializeGitIfNeeded(true);
    setSaveWorkspaceAsDefault(false);
    setWorkspaceStatus(null);
  }, [defaultWorkspacePath, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const normalizedWorkspace = workspacePath.trim();
    if (!normalizedWorkspace) {
      setWorkspaceStatus(null);
      setInspectingWorkspace(false);
      return;
    }

    let cancelled = false;
    setInspectingWorkspace(true);

    void onInspectWorkspace(normalizedWorkspace)
      .then((status) => {
        if (!cancelled) {
          setWorkspaceStatus(status);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setInspectingWorkspace(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, workspacePath]);

  if (!isOpen) {
    return null;
  }

  const chooseWorkspace = async () => {
    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return;
    }

    setWorkspacePath(selectedPath);
  };

  const normalizedSelectedWorkspace = workspacePath.trim();
  const normalizedSavedWorkspace = savedWorkspacePath?.trim() ?? "";
  const selectedWorkspaceDiffersFromSaved =
    normalizedSelectedWorkspace.length > 0 &&
    normalizedSelectedWorkspace !== normalizedSavedWorkspace;
  const workspaceMissing = Boolean(
    workspaceStatus && normalizedSelectedWorkspace && !workspaceStatus.exists,
  );
  const workspaceNotDirectory = Boolean(
    workspaceStatus && workspaceStatus.exists && !workspaceStatus.isDirectory,
  );
  const workspaceNeedsGitInit = Boolean(
    workspaceStatus &&
    workspaceStatus.exists &&
    workspaceStatus.isDirectory &&
    !workspaceStatus.isGitRepository,
  );
  const startDisabled =
    submitting ||
    normalizedSelectedWorkspace.length === 0 ||
    workspaceMissing ||
    workspaceNotDirectory ||
    (workspaceNeedsGitInit && !initializeGitIfNeeded);

  return (
    <div className="fixed inset-0 z-[145] overflow-y-auto bg-slate-950/80 px-4 py-8 backdrop-blur-sm">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="border-b border-white/5 bg-white/5 px-6 py-4">
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
            Run Flow
          </div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
            Choose the workspace for this experiment run
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {activeBlueprintName
              ? `The active workflow ${activeBlueprintName} will run against the selected workspace.`
              : "The active workflow will run against the selected workspace."}
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Workspace
                </div>
                <div className="mt-2 break-all text-sm text-slate-200">
                  {workspacePath || "No workspace selected yet."}
                </div>
                <div className="mt-3 text-xs leading-relaxed text-slate-400">
                  {inspectingWorkspace
                    ? "Inspecting folder and repository status..."
                    : workspaceMissing
                      ? "This path does not exist yet. Choose an existing folder before starting a run."
                      : workspaceNotDirectory
                        ? "The selected path is not a folder. Choose a workspace directory instead."
                        : workspaceStatus?.isGitRepository
                          ? `Repository detected${workspaceStatus.repositoryRoot ? ` at ${workspaceStatus.repositoryRoot}` : "."}`
                          : workspaceNeedsGitInit
                            ? "This folder is not inside a git repository yet. Enable initialization below if you want Maabarium to prepare it for branching safely."
                            : "Choose a folder to inspect its repository status before starting."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void chooseWorkspace()}
                className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              >
                Choose Folder
              </button>
            </div>

            {workspaceStatus && !inspectingWorkspace ? (
              <div
                className={`mt-4 rounded-lg border px-3 py-3 text-xs leading-relaxed ${workspaceStatus.isGitRepository ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : workspaceMissing || workspaceNotDirectory ? "border-rose-400/20 bg-rose-500/10 text-rose-100" : "border-amber-300/20 bg-amber-500/10 text-amber-100"}`}
              >
                {workspaceStatus.isGitRepository
                  ? `Git repository ready. Branching work will use ${workspaceStatus.repositoryRoot ?? workspaceStatus.path}.`
                  : workspaceMissing
                    ? "The selected workspace path could not be found. Maabarium will not start a run until you choose an existing folder."
                    : workspaceNotDirectory
                      ? "The selected path is not a directory. Pick a workspace folder instead of a file."
                      : "No git repository was found for this folder. Turn on initialization below if you want Maabarium to create a repository and initial commit automatically before the run starts."}
              </div>
            ) : null}
          </section>

          <ToggleRow
            checked={initializeGitIfNeeded}
            onChange={setInitializeGitIfNeeded}
            title="Initialize git if needed"
            description={
              workspaceNeedsGitInit
                ? "This selected folder is not currently in a repository. Keep this enabled if you want Maabarium to initialize git and create the first commit automatically."
                : "If the selected folder is not already inside a repository, Maabarium can initialize one and create an initial commit so experiment branches work safely."
            }
          />

          {workspaceNeedsGitInit && !initializeGitIfNeeded ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-xs leading-relaxed text-rose-100">
              The selected workspace is not a git repository and initialization
              is currently disabled. Starting the run in this state will fail
              during workspace preparation.
            </div>
          ) : null}

          <ToggleRow
            checked={saveWorkspaceAsDefault}
            onChange={setSaveWorkspaceAsDefault}
            title="Save this as the default workspace"
            description="Use this only when you want the selected run workspace to replace the workspace saved in setup for future runs."
            emphasis={
              selectedWorkspaceDiffersFromSaved || saveWorkspaceAsDefault
                ? "primary"
                : "secondary"
            }
          />

          <div className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-4 text-xs leading-relaxed text-slate-400">
            If you picked the wrong folder, cancel now instead of creating a
            repository there. By default this override applies only to the next
            run.
          </div>

          {!selectedWorkspaceDiffersFromSaved && !saveWorkspaceAsDefault ? (
            <div className="text-[11px] leading-relaxed text-slate-500">
              The selected workspace already matches the saved setup default, so
              saving it again is optional.
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                void onStart(
                  workspacePath,
                  initializeGitIfNeeded,
                  saveWorkspaceAsDefault,
                )
              }
              className="rounded-lg border border-teal-300/20 bg-gradient-to-r from-teal-500 to-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={startDisabled}
            >
              {submitting ? "Starting..." : "Start Run"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
