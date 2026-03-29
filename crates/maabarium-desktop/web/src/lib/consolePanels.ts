export type CollapsibleConsolePanel =
  | "analytics"
  | "evidence"
  | "workflowLibrary"
  | "maintenance";

export type CollapsibleConsolePanelState = Record<
  CollapsibleConsolePanel,
  boolean
>;

export const CONSOLE_PANEL_COLLAPSE_STORAGE_KEY =
  "maabarium.console.collapsedPanels";

export const DEFAULT_COLLAPSIBLE_CONSOLE_PANELS: CollapsibleConsolePanelState =
  {
    analytics: false,
    evidence: false,
    workflowLibrary: false,
    maintenance: false,
  };

export function loadCollapsedConsolePanels(): CollapsibleConsolePanelState {
  if (typeof window === "undefined") {
    return DEFAULT_COLLAPSIBLE_CONSOLE_PANELS;
  }

  try {
    const storedValue = window.localStorage.getItem(
      CONSOLE_PANEL_COLLAPSE_STORAGE_KEY,
    );

    if (!storedValue) {
      return DEFAULT_COLLAPSIBLE_CONSOLE_PANELS;
    }

    const parsed = JSON.parse(storedValue) as Partial<
      Record<CollapsibleConsolePanel, unknown>
    >;

    return {
      analytics:
        typeof parsed.analytics === "boolean"
          ? parsed.analytics
          : DEFAULT_COLLAPSIBLE_CONSOLE_PANELS.analytics,
      evidence:
        typeof parsed.evidence === "boolean"
          ? parsed.evidence
          : DEFAULT_COLLAPSIBLE_CONSOLE_PANELS.evidence,
      workflowLibrary:
        typeof parsed.workflowLibrary === "boolean"
          ? parsed.workflowLibrary
          : DEFAULT_COLLAPSIBLE_CONSOLE_PANELS.workflowLibrary,
      maintenance:
        typeof parsed.maintenance === "boolean"
          ? parsed.maintenance
          : DEFAULT_COLLAPSIBLE_CONSOLE_PANELS.maintenance,
    };
  } catch {
    return DEFAULT_COLLAPSIBLE_CONSOLE_PANELS;
  }
}

export function saveCollapsedConsolePanels(
  state: CollapsibleConsolePanelState,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CONSOLE_PANEL_COLLAPSE_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    return;
  }
}
