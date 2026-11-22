import { beforeEach, describe, expect, it } from "vitest";
import {
  CONSOLE_PANEL_COLLAPSE_STORAGE_KEY,
  DEFAULT_COLLAPSIBLE_CONSOLE_PANELS,
  loadCollapsedConsolePanels,
  saveCollapsedConsolePanels,
} from "./consolePanels";

describe("consolePanels", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default panel state when nothing is stored", () => {
    expect(loadCollapsedConsolePanels()).toEqual(
      DEFAULT_COLLAPSIBLE_CONSOLE_PANELS,
    );
  });

  it("persists and restores collapsed panel state", () => {
    saveCollapsedConsolePanels({
      analytics: true,
      activeBlueprint: false,
      evidence: false,
      runGroups: true,
      workflowLibrary: true,
      maintenance: false,
    });

    expect(loadCollapsedConsolePanels()).toEqual({
      analytics: true,
      activeBlueprint: false,
      evidence: false,
      runGroups: true,
      workflowLibrary: true,
      maintenance: false,
    });
  });

  it("falls back to defaults for invalid stored payloads", () => {
    window.localStorage.setItem(
      CONSOLE_PANEL_COLLAPSE_STORAGE_KEY,
      '{"analytics":"yes","maintenance":true}',
    );

    expect(loadCollapsedConsolePanels()).toEqual({
      analytics: false,
      activeBlueprint: false,
      evidence: false,
      runGroups: false,
      workflowLibrary: false,
      maintenance: true,
    });
  });
});
