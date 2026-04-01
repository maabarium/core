import { describe, expect, it } from "vitest";
import type { PersistedExperiment } from "../types/console";
import { formatPromotionToastMessage } from "./promotionToast";

function buildExperiment(
  promotedTargetBranchName: string | null,
): PersistedExperiment {
  return {
    id: 42,
    iteration: 42,
    blueprint_name: "project-echo",
    proposal_summary: "Retained winner",
    weighted_total: 0.93,
    duration_ms: 1_200,
    error: null,
    promotion_outcome: "promoted",
    promoted_branch_name: "experiment-run/iter-42",
    promoted_commit_oid: "commit-42",
    promoted_target_branch_name: promotedTargetBranchName,
    created_at: "2026-04-01T00:00:00Z",
    metrics: [],
    research: null,
    lora: null,
  };
}

describe("promotionToast", () => {
  it("formats the retained target branch name for promoted runs", () => {
    expect(formatPromotionToastMessage(buildExperiment("master"))).toBe(
      "Promoted to master.",
    );
  });

  it("skips the toast when the target branch name is unavailable", () => {
    expect(formatPromotionToastMessage(buildExperiment(null))).toBeNull();
  });
});
