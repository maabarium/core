use maabarium_core::{
    blueprint::BlueprintFile,
    engine::{Engine, EngineConfig},
    evaluator::{Evaluator, ExperimentResult, MetricScore},
    error::EvalError,
    git_manager::Proposal,
};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

struct MockEvaluator {
    score: f64,
}

#[async_trait::async_trait]
impl Evaluator for MockEvaluator {
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
    ) -> Result<ExperimentResult, EvalError> {
        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            scores: vec![MetricScore {
                name: "quality".into(),
                value: self.score,
                weight: 1.0,
            }],
            weighted_total: self.score,
            duration_ms: 1,
        })
    }
}

#[tokio::test]
async fn test_engine_runs_two_iterations() {
    let blueprint_path = std::path::Path::new(
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/mock_blueprint.toml")
    );
    let blueprint = BlueprintFile::load(blueprint_path).expect("Failed to load mock blueprint");

    let evaluator = Arc::new(MockEvaluator { score: 0.8 });
    let cancel = CancellationToken::new();
    let db_path = format!("/tmp/maabarium_test_{}.db", uuid::Uuid::new_v4());

    let config = EngineConfig {
        blueprint,
        db_path: db_path.clone(),
    };

    let engine = Engine::new(config, evaluator, cancel).expect("Engine init failed");
    let _ = engine.run().await;

    let _ = std::fs::remove_file(&db_path);
}
