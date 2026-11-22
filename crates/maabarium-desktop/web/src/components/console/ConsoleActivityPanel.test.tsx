import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PersistedProposal } from "../../types/console";
import { ConsoleActivityPanel } from "./ConsoleActivityPanel";

function buildProposal(
  id: number,
  summary: string,
  patchPath: string,
  lineCount: number,
): PersistedProposal {
  return {
    id,
    experiment_id: id,
    summary,
    created_at: "2026-03-28T00:00:00Z",
    file_patches: [
      {
        path: patchPath,
        operation: "Modify",
        content: Array.from(
          { length: lineCount },
          (_, index) => `line ${index + 1}`,
        ).join("\n"),
      },
      {
        path: `${patchPath}.notes`,
        operation: "Create",
        content: "notes",
      },
    ],
  };
}

describe("ConsoleActivityPanel", () => {
  it("keeps current research history and logs separate from an older workflow", () => {
    const job = { id: "loop:coda:1", lane: "Local evidence", state: "done", attempts: 0,
      detail: "Audited report saved", result: "Both comparisons passed", experiment_title: "SF27-F1", review_pending: true };
    const props = {
      history: [],
      researchJobs: [job],
      reportingJob: job,
      latestProposal: null, winnerProposal: null, selectedWinnerProposal: null,
      logs: ["An unrelated workflow log"], logPath: "test.log",
      onChangeTab: () => undefined, onOpenLogFile: () => undefined,
    };
    const view = render(<ConsoleActivityPanel {...props} activeTab="history" />);
    expect(screen.getByRole("heading", { name: "SF27-F1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Workflow engine runs" })).toBeNull();
    view.rerender(<ConsoleActivityPanel {...props} activeTab="logs" />);
    expect(screen.getByText("Audited report saved")).toBeTruthy();
    expect(screen.queryByText("An unrelated workflow log")).toBeNull();
  });

  it("uses the current research report in Diff View without a nested vertical scroll box", async () => {
    render(<ConsoleActivityPanel activeTab="diff" history={[]}
      currentResearchJob={{ id: "loop:pilot:1", lane: "Local evidence", state: "done", attempts: 0,
        detail: null, result: "## Both exact baselines passed", experiment_title: "CODA pilot", review_pending: true }}
      latestProposal={buildProposal(20, "An unrelated workflow", "src/old.rs", 1)}
      winnerProposal={null} selectedWinnerProposal={null}
      logs={[]} logPath="test.log" onChangeTab={() => undefined} onOpenLogFile={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Both exact baselines passed" })).toBeTruthy();
    expect(screen.queryByText("An unrelated workflow")).toBeNull();
    expect(screen.getByTestId("console-activity-content").className).not.toMatch(/max-h-|overflow-y-auto/);
  });

  it("shows a separately labelled local checkpoint in the existing console history", () => {
    render(<ConsoleActivityPanel activeTab="history" history={[]}
      researchJobs={[{ id: "loop:pilot:1", lane: "Local evidence", state: "done", attempts: 0,
        detail: null, result: "Audit report", experiment_title: "Pilot against both baselines", review_pending: true }]}
      latestProposal={null} winnerProposal={null} selectedWinnerProposal={null}
      logs={[]} logPath="test.log" onChangeTab={() => undefined} onOpenLogFile={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Pilot against both baselines" })).toBeTruthy();
    expect(screen.getByText("Awaiting human review")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workflow engine runs" })).toBeTruthy();
    expect(screen.queryByText("loop:pilot:1")).toBeNull();
  });

  it("lets the user switch the diff view from latest to winning proposal", async () => {
    const user = userEvent.setup();
    render(
      <ConsoleActivityPanel
        activeTab="diff"
        history={[]}
        latestProposal={buildProposal(
          20,
          "Latest rejected run",
          "src/latest.rs",
          3,
        )}
        winnerProposal={buildProposal(
          7,
          "Winning retained run",
          "docs/winner.md",
          3,
        )}
        selectedWinnerProposal={null}
        logs={[]}
        logPath="test.log"
        onChangeTab={() => undefined}
        onOpenLogFile={() => undefined}
      />,
    );

    screen.getByText(/Latest proposal #20/i);
    await user.click(screen.getByRole("button", { name: /Winning Proposal/i }));
    screen.getByText(/Winning proposal #7/i);
    screen.getByText(/Winning retained run/i);
    expect(screen.getAllByText(/docs\/winner.md/i).length).toBeGreaterThan(0);
  });

  it("truncates very large multi-file diff previews and keeps file selection explicit", () => {
    render(
      <ConsoleActivityPanel
        activeTab="diff"
        history={[]}
        latestProposal={buildProposal(
          20,
          "Latest rejected run",
          "src/latest.rs",
          55,
        )}
        winnerProposal={null}
        selectedWinnerProposal={null}
        logs={[]}
        logPath="test.log"
        onChangeTab={() => undefined}
        onOpenLogFile={() => undefined}
      />,
    );

    screen.getByText(/2 files changed/i);
    screen.getByText(/Showing first 40 changed lines for readability/i);
    screen.getByRole("button", { name: /src\/latest.rs.notes/i });
  });

  it("opens the log file action from the logs tab", async () => {
    const user = userEvent.setup();
    const onOpenLogFile = vi.fn();
    render(
      <ConsoleActivityPanel
        activeTab="logs"
        history={[]}
        latestProposal={null}
        winnerProposal={null}
        selectedWinnerProposal={null}
        logs={["trace line"]}
        logPath="test.log"
        onChangeTab={() => undefined}
        onOpenLogFile={onOpenLogFile}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open Log File/i }));
    expect(onOpenLogFile).toHaveBeenCalledTimes(1);
  });

  it("jumps the diff view to a selected retained winner proposal", () => {
    render(
      <ConsoleActivityPanel
        activeTab="diff"
        history={[]}
        latestProposal={buildProposal(
          20,
          "Latest rejected run",
          "src/latest.rs",
          3,
        )}
        winnerProposal={buildProposal(
          7,
          "Current winner",
          "docs/current-winner.md",
          3,
        )}
        selectedWinnerProposal={buildProposal(
          5,
          "Earlier retained winner",
          "docs/retained-v1.md",
          3,
        )}
        logs={[]}
        logPath="test.log"
        onChangeTab={() => undefined}
        onOpenLogFile={() => undefined}
      />,
    );

    screen.getByText(/Selected Retained Winner #5/i);
    screen.getByText(/Earlier retained winner/i);
  });

  it("exposes History, Diff View and Logs as keyboard-operable tabs", () => {
    const onChangeTab = vi.fn();
    render(<ConsoleActivityPanel activeTab="history" history={[]} latestProposal={null}
      winnerProposal={null} selectedWinnerProposal={null} logs={[]} logPath="test.log"
      onChangeTab={onChangeTab} onOpenLogFile={() => undefined} />);
    expect(screen.getByRole("tablist", { name: "Console activity" })).toBeTruthy();
    const history = screen.getByRole("tab", { name: "History" });
    expect(history.getAttribute("aria-selected")).toBe("true");
    expect(history.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Logs" }).tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("console-tab-history");
    fireEvent.keyDown(history, { key: "ArrowRight" });
    expect(onChangeTab).toHaveBeenLastCalledWith("diff");
    fireEvent.keyDown(history, { key: "ArrowLeft" });
    expect(onChangeTab).toHaveBeenLastCalledWith("logs");
    fireEvent.keyDown(history, { key: "End" });
    expect(onChangeTab).toHaveBeenLastCalledWith("logs");
  });
});
