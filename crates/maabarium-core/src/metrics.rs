use crate::evaluator::MetricScore;

pub fn is_improvement(baseline: f64, candidate: f64, min_delta: f64) -> bool {
    candidate > baseline + min_delta
}

/// Normalize a raw value to the [0, 1] range given observed min/max bounds.
pub fn normalize(value: f64, min: f64, max: f64) -> f64 {
    if (max - min).abs() < f64::EPSILON {
        return 0.5;
    }
    ((value - min) / (max - min)).clamp(0.0, 1.0)
}

/// Invert a [0, 1] score so that a lower raw value maps to a higher score.
/// Use this for metrics with `direction = "minimize"`.
pub fn invert_for_minimize(value: f64) -> f64 {
    1.0 - value.clamp(0.0, 1.0)
}

/// Compute the weighted sum of a slice of metric scores.
/// Equivalent to `ExperimentResult::compute_weighted_total`, exposed here
/// for callers that operate on raw score slices without a full result.
pub fn weighted_score(scores: &[MetricScore]) -> f64 {
    scores.iter().map(|s| s.value * s.weight).sum()
}
