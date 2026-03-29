import { render, screen } from "@testing-library/react";
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
});
