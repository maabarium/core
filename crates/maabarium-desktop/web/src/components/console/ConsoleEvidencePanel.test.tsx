import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetainedWinnerEntry } from "../../lib/winners";
import type {
  PersistedExperiment,
  PersistedProposal,
} from "../../types/console";
import { ConsoleEvidencePanel } from "./ConsoleEvidencePanel";

function buildRetainedExperiment(id = 7): PersistedExperiment {
  return {
    id,
    iteration: id,
    blueprint_name: "project-echo",
    proposal_summary: `Retained winner ${id}`,
    weighted_total: 0.89,
    duration_ms: 2_000,
    error: null,
    promotion_outcome: "promoted",
    promoted_branch_name: `experiment-run/iter-${id}`,
    promoted_commit_oid: `commit-${id}`,
    created_at: "2026-03-28T12:34:00Z",
    metrics: [],
    research: null,
    lora: null,
  };
}

function buildRetainedProposal(experimentId = 7): PersistedProposal {
  return {
    id: experimentId + 10,
    experiment_id: experimentId,
    summary: `Proposal ${experimentId}`,
    created_at: "2026-03-28T12:34:00Z",
    file_patches: [
      {
        path: "docs/project-echo.md",
        operation: "Create",
        content: "# Project Echo\n",
      },
    ],
  };
}

function buildResearchExperiment(): PersistedExperiment {
  return {
    ...buildRetainedExperiment(17),
    promotion_outcome: "rejected",
    promoted_branch_name: null,
    promoted_commit_oid: null,
    research: {
      sources: [
        {
          url: "https://example.com",
          finalUrl: null,
          host: "example.com",
          label: null,
          title: "Example",
          citationCount: 1,
          verified: true,
          statusCode: 200,
          fetchError: null,
        },
      ],
      citations: [],
      queryTraces: [
        {
          provider: "brave",
          queryText: "project echo",
          resultCount: 1,
          topUrls: ["https://example.com"],
          latencyMs: 120,
          executedAt: "2026-03-28T12:34:00Z",
          error: null,
        },
      ],
    },
  };
}

function buildLoraExperiment(): PersistedExperiment {
  return {
    ...buildRetainedExperiment(23),
    promotion_outcome: "rejected",
    promoted_branch_name: null,
    promoted_commit_oid: null,
    lora: {
      trainer: "mlx_lm",
      baseModel: "mistral",
      dataset: "dataset.jsonl",
      adapterPath: "adapters/model",
      outputDir: "outputs/model",
      evalCommand: "python eval.py",
      epochs: 3,
      learningRate: 0.0001,
      adapterRatio: 0.9,
      metadataRatio: 0.8,
      reproducibilityRatio: 0.85,
      trainerSignal: 0.9,
      executionSignal: 0.95,
      sandboxFileCount: 4,
      sandboxTotalBytes: 1024,
      stages: [
        {
          name: "train",
          command: "python",
          args: ["train.py"],
          workingDir: "/tmp/model",
          timeoutSeconds: 60,
          expectedArtifacts: ["adapter.bin"],
          verifiedArtifacts: ["adapter.bin"],
        },
      ],
    },
  };
}

describe("ConsoleEvidencePanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the retained tab when a retained winner exists", () => {
    const winnerHistory: RetainedWinnerEntry[] = [
      {
        experiment: buildRetainedExperiment(),
        proposal: buildRetainedProposal(),
      },
    ];

    render(
      <ConsoleEvidencePanel
        winnerHistory={winnerHistory}
        selectedExperimentId={7}
        onSelectExperimentId={() => undefined}
        onExportFiles={() => undefined}
        latestResearchExperiment={buildResearchExperiment()}
        latestLoraExperiment={buildLoraExperiment()}
      />,
    );

    expect(
      screen.getByTestId("evidence-panel-retained").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      screen.getByTestId("evidence-panel-research").getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /Retained/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("falls back to research when retained winners are absent and lets the user switch tabs", async () => {
    const user = userEvent.setup();

    render(
      <ConsoleEvidencePanel
        winnerHistory={[]}
        selectedExperimentId={null}
        onSelectExperimentId={vi.fn()}
        onExportFiles={() => undefined}
        latestResearchExperiment={buildResearchExperiment()}
        latestLoraExperiment={buildLoraExperiment()}
      />,
    );

    expect(
      screen.getByTestId("evidence-panel-research").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: /Research/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: /LoRA/i }));

    expect(
      screen.getByTestId("evidence-panel-lora").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      screen.getByTestId("evidence-panel-research").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("keeps a manually selected idle tab visible instead of snapping back", async () => {
    const user = userEvent.setup();
    const winnerHistory: RetainedWinnerEntry[] = [
      {
        experiment: buildRetainedExperiment(),
        proposal: buildRetainedProposal(),
      },
    ];

    render(
      <ConsoleEvidencePanel
        winnerHistory={winnerHistory}
        selectedExperimentId={7}
        onSelectExperimentId={vi.fn()}
        onExportFiles={() => undefined}
        latestResearchExperiment={null}
        latestLoraExperiment={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Research/i }));

    expect(
      screen
        .getByRole("button", { name: /Research/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("evidence-panel-research").getAttribute("aria-hidden"),
    ).toBe("false");
    expect(
      screen.getByText(/No persisted research evidence is available yet/i),
    ).toBeTruthy();
    expect(window.localStorage.getItem("maabarium.console.evidenceTab")).toBe(
      "research",
    );
  });

  it("restores the last selected evidence tab after reload", () => {
    window.localStorage.setItem("maabarium.console.evidenceTab", "lora");

    render(
      <ConsoleEvidencePanel
        winnerHistory={[
          {
            experiment: buildRetainedExperiment(),
            proposal: buildRetainedProposal(),
          },
        ]}
        selectedExperimentId={7}
        onSelectExperimentId={vi.fn()}
        onExportFiles={() => undefined}
        latestResearchExperiment={buildResearchExperiment()}
        latestLoraExperiment={buildLoraExperiment()}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: /LoRA/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("evidence-panel-lora").getAttribute("aria-hidden"),
    ).toBe("false");
  });
});
