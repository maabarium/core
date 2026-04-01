import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RetainedWinnerEntry } from "../../lib/winners";
import type {
  PersistedExperiment,
  PersistedProposal,
} from "../../types/console";
import { RetainedArtifactExplorerCard } from "./RetainedArtifactExplorerCard";

function buildExperiment(id = 7, score = 0.895): PersistedExperiment {
  return {
    id,
    iteration: id,
    blueprint_name: "project-echo",
    proposal_summary: `Create the retained implementation note ${id}`,
    weighted_total: score,
    duration_ms: 2_100,
    error: null,
    promotion_outcome: "promoted",
    promoted_branch_name: `experiment-run/iter-${id}`,
    promoted_commit_oid: `commit-${id}`,
    promoted_target_branch_name: "master",
    created_at: "2026-03-28T12:34:00Z",
    metrics: [],
    research: null,
    lora: null,
  };
}

function buildProposal(
  experimentId = 7,
  path = "docs/project-echo-implementation.md",
): PersistedProposal {
  return {
    id: experimentId + 4,
    experiment_id: experimentId,
    summary: `Write the retained markdown deliverable ${experimentId}`,
    created_at: "2026-03-28T12:34:00Z",
    file_patches: [
      {
        path,
        operation: "Create",
        content: `# Project Echo ${experimentId}\n\n## Status\nRetained winner ${experimentId}\n`,
      },
    ],
  };
}

function buildHistory(): RetainedWinnerEntry[] {
  return [
    {
      experiment: buildExperiment(7, 0.895),
      proposal: buildProposal(7, "docs/project-echo-implementation.md"),
    },
    {
      experiment: buildExperiment(5, 0.84),
      proposal: buildProposal(5, "docs/project-echo-retained-v1.md"),
    },
  ];
}

describe("RetainedArtifactExplorerCard", () => {
  it("renders the retained winner patch preview", () => {
    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={() => undefined}
      />,
    );

    screen.getByText(/Retained winner experiment #7/i);
    screen.getByText(/Write the retained markdown deliverable 7/i);
    screen.getByText(/To master/i);
    expect(
      screen.getAllByText(/docs\/project-echo-implementation.md/i).length,
    ).toBeGreaterThan(0);
    screen.getByText(/\+## Status/i);
    screen.getByRole("button", { name: /Export Patchset/i });
  });

  it("shows an empty state when no retained winner is loaded", () => {
    render(
      <RetainedArtifactExplorerCard
        winnerHistory={[]}
        selectedExperimentId={null}
        onSelectExperimentId={() => undefined}
        onExportFiles={() => undefined}
      />,
    );

    screen.getByText(
      /No retained winner is loaded in the current snapshot yet/i,
    );
  });

  it("switches between retained winners without cluttering the preview", async () => {
    const user = userEvent.setup();
    const onSelectExperimentId = vi.fn();

    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={onSelectExperimentId}
        onExportFiles={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Earlier winner 1/i }));

    expect(onSelectExperimentId).toHaveBeenCalledWith(5);
  });

  it("exports the selected retained winner patchset", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:retained-winner");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Export Patchset/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    screen.getByText(/Patchset download started/i);
    screen.getByText(/maabarium-retained-winner-7.json/i);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });

  it("invokes backend export for actual retained winner files", async () => {
    const user = userEvent.setup();
    const onExportFiles = vi.fn();

    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={onExportFiles}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Export Files \(.tar.gz\)/i }),
    );

    expect(onExportFiles).toHaveBeenCalledTimes(1);
    expect(onExportFiles.mock.calls[0][0].experiment.id).toBe(7);
  });

  it("shows export progress and the saved archive path", async () => {
    const user = userEvent.setup();
    let resolveExport:
      | ((value: { fileName: string; bytes: number[] }) => void)
      | undefined;
    const onExportFiles = vi.fn(
      () =>
        new Promise<{ fileName: string; bytes: number[] }>((resolve) => {
          resolveExport = resolve;
        }),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:retained-archive");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={onExportFiles}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Export Files \(.tar.gz\)/i }),
    );

    expect(
      screen.getByRole("button", { name: /Exporting Archive/i }),
    ).toHaveProperty("disabled", true);
    screen.getByText(
      /Packaging the retained winner files into a tar.gz archive/i,
    );

    if (typeof resolveExport !== "function") {
      throw new Error("expected export promise resolver to be assigned");
    }

    const finishExport = resolveExport;

    finishExport({
      fileName: "maabarium-retained-winner-7.tar.gz",
      bytes: [31, 139, 8, 0],
    });

    expect(await screen.findByText(/Archive download started/i)).toBeTruthy();
    screen.getByText(/maabarium-retained-winner-7.tar.gz/i);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });

  it("shows persisted preview download feedback", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:retained-preview");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(
      <RetainedArtifactExplorerCard
        winnerHistory={buildHistory()}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={() => undefined}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Download Persisted Preview/i }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    screen.getByText(/Persisted preview download started/i);
    screen.getByText(/winner-7-project-echo-implementation.md/i);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });
});
