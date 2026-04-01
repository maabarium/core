import type { PersistedExperiment } from "../types/console";

export function formatPromotionToastMessage(
  experiment: PersistedExperiment | null | undefined,
): string | null {
  const targetBranch = experiment?.promoted_target_branch_name?.trim();
  if (!targetBranch) {
    return null;
  }

  return `Promoted to ${targetBranch}.`;
}
