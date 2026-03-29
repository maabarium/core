import type { PersistedExperiment, PersistedProposal } from "../types/console";

export type RetainedWinnerEntry = {
  experiment: PersistedExperiment;
  proposal: PersistedProposal | null;
};

export function selectSuccessfulExperiments(
  experiments: PersistedExperiment[],
): PersistedExperiment[] {
  return experiments.filter((experiment) => !experiment.error);
}

export function selectPromotedSuccessfulExperiments(
  experiments: PersistedExperiment[],
): PersistedExperiment[] {
  return selectSuccessfulExperiments(experiments).filter(
    (experiment) => experiment.promotion_outcome === "promoted",
  );
}

export function selectWinnerExperiment(
  experiments: PersistedExperiment[],
): PersistedExperiment | null {
  const promotedSuccessful = selectPromotedSuccessfulExperiments(experiments);
  if (promotedSuccessful.length > 0) {
    return promotedSuccessful[0];
  }

  return selectSuccessfulExperiments(experiments)
    .filter((experiment) => experiment.promotion_outcome === "unknown")
    .reduce<PersistedExperiment | null>((best, experiment) => {
      if (!best || experiment.weighted_total > best.weighted_total) {
        return experiment;
      }
      return best;
    }, null);
}

export function selectPreviousWinnerExperiment(
  experiments: PersistedExperiment[],
): PersistedExperiment | null {
  const promotedSuccessful = selectPromotedSuccessfulExperiments(experiments);
  return promotedSuccessful.length > 1 ? promotedSuccessful[1] : null;
}

export function selectWinnerProposal(
  proposals: PersistedProposal[],
  winnerExperiment: PersistedExperiment | null,
): PersistedProposal | null {
  if (!winnerExperiment) {
    return null;
  }

  return (
    proposals.find(
      (proposal) => proposal.experiment_id === winnerExperiment.id,
    ) ?? null
  );
}

export function selectRetainedWinnerHistory(
  experiments: PersistedExperiment[],
  proposals: PersistedProposal[],
  limit = 4,
): RetainedWinnerEntry[] {
  return selectPromotedSuccessfulExperiments(experiments)
    .slice(0, limit)
    .map((experiment) => ({
      experiment,
      proposal:
        proposals.find(
          (proposal) => proposal.experiment_id === experiment.id,
        ) ?? null,
    }));
}
