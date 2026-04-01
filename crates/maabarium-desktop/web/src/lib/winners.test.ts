import { describe, expect, it } from "vitest";
import type { PersistedExperiment, PersistedProposal } from "../types/console";
import {
  selectPreviousWinnerExperiment,
  selectPromotedSuccessfulExperiments,
  selectRetainedWinnerHistory,
  selectWinnerExperiment,
  selectWinnerProposal,
} from "./winners";

function buildExperiment(
  id: number,
  promotionOutcome: PersistedExperiment["promotion_outcome"],
  weightedTotal: number,
  error: string | null = null,
): PersistedExperiment {
  return {
    id,
    iteration: id,
    blueprint_name: "project-echo",
    proposal_summary: `Experiment ${id}`,
    weighted_total: weightedTotal,
    duration_ms: 1_000,
    error,
    promotion_outcome: promotionOutcome,
    promoted_branch_name:
      promotionOutcome === "promoted" ? `experiment-run/iter-${id}` : null,
    promoted_commit_oid:
      promotionOutcome === "promoted" ? `commit-${id}` : null,
    promoted_target_branch_name:
      promotionOutcome === "promoted" ? "master" : null,
    created_at: "2026-03-28T00:00:00Z",
    metrics: [],
    research: null,
    lora: null,
  };
}

function buildProposal(id: number, experimentId: number): PersistedProposal {
  return {
    id,
    experiment_id: experimentId,
    summary: `Proposal ${id}`,
    created_at: "2026-03-28T00:00:00Z",
    file_patches: [],
  };
}

describe("winner selection", () => {
  it("prefers a retained promoted winner over newer rejected runs", () => {
    const experiments = [
      buildExperiment(25, "rejected", 0.61),
      buildExperiment(24, "rejected", 0.59),
      buildExperiment(1, "promoted", 0.895),
    ];

    const winner = selectWinnerExperiment(experiments);
    const promoted = selectPromotedSuccessfulExperiments(experiments);

    expect(winner?.id).toBe(1);
    expect(promoted).toHaveLength(1);
  });

  it("matches the retained winner to its persisted proposal patchset", () => {
    const experiments = [
      buildExperiment(30, "rejected", 0.52),
      buildExperiment(7, "promoted", 0.81),
      buildExperiment(6, "promoted", 0.77),
    ];
    const proposals = [buildProposal(44, 30), buildProposal(12, 7)];

    const winner = selectWinnerExperiment(experiments);
    const previousWinner = selectPreviousWinnerExperiment(experiments);
    const winnerProposal = selectWinnerProposal(proposals, winner);

    expect(winner?.id).toBe(7);
    expect(previousWinner?.id).toBe(6);
    expect(winnerProposal?.id).toBe(12);
  });

  it("builds a compact retained winner history with matched proposals", () => {
    const experiments = [
      buildExperiment(12, "rejected", 0.51),
      buildExperiment(9, "promoted", 0.88),
      buildExperiment(7, "promoted", 0.81),
      buildExperiment(4, "promoted", 0.77),
    ];
    const proposals = [
      buildProposal(100, 12),
      buildProposal(90, 9),
      buildProposal(70, 7),
    ];

    const history = selectRetainedWinnerHistory(experiments, proposals, 3);

    expect(history).toHaveLength(3);
    expect(history[0]?.experiment.id).toBe(9);
    expect(history[0]?.proposal?.id).toBe(90);
    expect(history[1]?.experiment.id).toBe(7);
    expect(history[1]?.proposal?.id).toBe(70);
    expect(history[2]?.experiment.id).toBe(4);
    expect(history[2]?.proposal).toBeNull();
  });
});
