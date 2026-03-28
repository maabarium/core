use maabarium_core::{
    blueprint::BlueprintFile,
    engine::{Engine, EngineConfig},
    error::EvalError,
    evaluator::{EvaluationContext, Evaluator, ExperimentResult, MetricScore},
    git_manager::Proposal,
    persistence::{Persistence, PromotionOutcome},
};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

struct MockEvaluator {
    score: f64,
}

struct SequenceEvaluator {
    scores: Mutex<Vec<f64>>,
}

#[async_trait::async_trait]
impl Evaluator for MockEvaluator {
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
        _context: &EvaluationContext,
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
            research: None,
            lora: None,
        })
    }
}

#[async_trait::async_trait]
impl Evaluator for SequenceEvaluator {
    async fn evaluate(
        &self,
        proposal: &Proposal,
        iteration: u64,
        _context: &EvaluationContext,
    ) -> Result<ExperimentResult, EvalError> {
        let score = self
            .scores
            .lock()
            .expect("scores mutex should lock")
            .remove(0);
        Ok(ExperimentResult {
            iteration,
            proposal: proposal.clone(),
            scores: vec![MetricScore {
                name: "quality".into(),
                value: score,
                weight: 1.0,
            }],
            weighted_total: score,
            duration_ms: 1,
            research: None,
            lora: None,
        })
    }
}

#[tokio::test]
async fn test_engine_runs_two_iterations() {
    let repo_root = std::env::temp_dir().join(format!("maabarium-engine-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo_root.join("src")).expect("temp repo src should be created");
    fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
        .expect("baseline file should be created");
    init_git_repo(&repo_root);

    let blueprint_path = repo_root.join("mock_blueprint.toml");
    fs::write(
        &blueprint_path,
        format!(
            "[blueprint]\nname = \"mock-test\"\nversion = \"0.1.0\"\ndescription = \"Mock blueprint for testing\"\n\n[domain]\nrepo_path = \"{}\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 2\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n    {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Quality score\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n    {{ name = \"test-agent\", role = \"tester\", system_prompt = \"You are a test agent.\", model = \"mock\" }},\n]\n\n[models]\nmodels = [\n    {{ name = \"mock\", provider = \"mock\", endpoint = \"http://localhost:11434\", temperature = 0.5, max_tokens = 128 }},\n]\n",
            repo_root.display()
        ),
    )
    .expect("blueprint should be written");

    let blueprint = BlueprintFile::load(&blueprint_path).expect("Failed to load mock blueprint");

    let evaluator = Arc::new(MockEvaluator { score: 0.8 });
    let cancel = CancellationToken::new();
    let db_path = repo_root.join("maabarium_test.db");

    let config = EngineConfig {
        blueprint,
        db_path: db_path.display().to_string(),
        progress_reporter: None,
    };

    let engine = Engine::new(config, evaluator, cancel).expect("Engine init failed");
    let _ = engine.run().await;

    let _ = fs::remove_dir_all(&repo_root);
}

fn init_git_repo(repo_root: &Path) {
    let repo = git2::Repository::init(repo_root).expect("git repo should initialize");
    let mut index = repo.index().expect("git index should open");
    index
        .add_path(Path::new("src/lib.rs"))
        .expect("source file should be added");
    index.write().expect("git index should write");
    let tree_id = index.write_tree().expect("tree id should be written");
    let tree = repo.find_tree(tree_id).expect("tree should load");
    let signature = git2::Signature::now("Maabarium Test", "test@maabarium.local")
        .expect("signature should be created");
    repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
        .expect("initial commit should succeed");
}

#[tokio::test]
async fn engine_persists_explicit_promotion_outcomes() {
    let repo_root = std::env::temp_dir().join(format!("maabarium-engine-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo_root.join("src")).expect("temp repo src should be created");
    fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
        .expect("baseline file should be created");
    init_git_repo(&repo_root);

    let blueprint_path = repo_root.join("mock_blueprint.toml");
    fs::write(
        &blueprint_path,
        format!(
            "[blueprint]\nname = \"mock-test\"\nversion = \"0.1.0\"\ndescription = \"Mock blueprint for testing\"\n\n[domain]\nrepo_path = \"{}\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 2\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n    {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Quality score\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n    {{ name = \"test-agent\", role = \"tester\", system_prompt = \"You are a test agent.\", model = \"mock\" }},\n]\n\n[models]\nmodels = [\n    {{ name = \"mock\", provider = \"mock\", endpoint = \"http://localhost:11434\", temperature = 0.5, max_tokens = 128 }},\n]\n",
            repo_root.display()
        ),
    )
    .expect("blueprint should be written");

    let blueprint = BlueprintFile::load(&blueprint_path).expect("Failed to load mock blueprint");

    let evaluator = Arc::new(SequenceEvaluator {
        scores: Mutex::new(vec![0.8, 0.79]),
    });
    let cancel = CancellationToken::new();
    let db_path = repo_root.join("maabarium_test.db");

    let config = EngineConfig {
        blueprint,
        db_path: db_path.display().to_string(),
        progress_reporter: None,
    };

    let engine = Engine::new(config, evaluator, cancel).expect("Engine init failed");
    engine.run().await.expect("engine should complete");

    let persistence =
        Persistence::open(db_path.to_str().expect("temp db path should be valid"))
            .expect("db should open");
    let experiments = persistence
        .recent_experiments_for_blueprint("mock-test", 10)
        .expect("experiments should load");

    assert_eq!(experiments.len(), 2);
    assert_eq!(experiments[0].promotion_outcome, PromotionOutcome::Rejected);
    assert_eq!(experiments[1].promotion_outcome, PromotionOutcome::Promoted);

    let _ = fs::remove_dir_all(&repo_root);
}

#[tokio::test]
async fn engine_reuses_worktree_after_promoted_iteration() {
    let repo_root = std::env::temp_dir().join(format!("maabarium-engine-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo_root.join("src")).expect("temp repo src should be created");
    fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
        .expect("baseline file should be created");
    init_git_repo(&repo_root);

    let blueprint_path = repo_root.join("mock_blueprint.toml");
    fs::write(
        &blueprint_path,
        format!(
            "[blueprint]\nname = \"mock-test\"\nversion = \"0.1.0\"\ndescription = \"Mock blueprint for testing\"\n\n[domain]\nrepo_path = \"{}\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 2\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n    {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Quality score\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n    {{ name = \"test-agent\", role = \"tester\", system_prompt = \"You are a test agent.\", model = \"mock\" }},\n]\n\n[models]\nmodels = [\n    {{ name = \"mock\", provider = \"mock\", endpoint = \"http://localhost:11434\", temperature = 0.5, max_tokens = 128 }},\n]\n",
            repo_root.display()
        ),
    )
    .expect("blueprint should be written");

    let blueprint = BlueprintFile::load(&blueprint_path).expect("Failed to load mock blueprint");

    let evaluator = Arc::new(SequenceEvaluator {
        scores: Mutex::new(vec![0.8, 0.79]),
    });
    let cancel = CancellationToken::new();
    let db_path = repo_root.join("maabarium_test.db");

    let config = EngineConfig {
        blueprint,
        db_path: db_path.display().to_string(),
        progress_reporter: None,
    };

    let engine = Engine::new(config, evaluator, cancel).expect("Engine init failed");
    engine.run().await.expect("engine should complete");

    let summary = engine.timing_summary();
    assert_eq!(summary.phase_totals["applying_worktree_registration"].count, 1);
    assert_eq!(summary.phase_totals["applying_reset_clean"].count, 1);
    assert!(summary.phase_totals.get("applying_checkout_target_branch").is_none());

    let _ = fs::remove_dir_all(&repo_root);
}

#[tokio::test]
async fn engine_rejects_empty_patchset_even_when_score_improves() {
    let repo_root = std::env::temp_dir().join(format!("maabarium-engine-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(repo_root.join("src")).expect("temp repo src should be created");
    fs::write(repo_root.join("src/lib.rs"), "pub fn baseline() {}\n")
        .expect("baseline file should be created");
    init_git_repo(&repo_root);

    let blueprint_path = repo_root.join("mock_blueprint.toml");
    fs::write(
        &blueprint_path,
        format!(
            "[blueprint]\nname = \"mock-empty-patchset\"\nversion = \"0.1.0\"\ndescription = \"MAABARIUM_MOCK_EMPTY_PATCHSET\"\n\n[domain]\nrepo_path = \"{}\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 1\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n    {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Quality score\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n    {{ name = \"test-agent\", role = \"tester\", system_prompt = \"You are a test agent.\", model = \"mock\" }},\n]\n\n[models]\nmodels = [\n    {{ name = \"mock\", provider = \"mock\", endpoint = \"http://localhost:11434\", temperature = 0.5, max_tokens = 128 }},\n]\n",
            repo_root.display()
        ),
    )
    .expect("blueprint should be written");

    let blueprint = BlueprintFile::load(&blueprint_path).expect("Failed to load mock blueprint");

    let evaluator = Arc::new(MockEvaluator { score: 0.8 });
    let cancel = CancellationToken::new();
    let db_path = repo_root.join("maabarium_test.db");

    let config = EngineConfig {
        blueprint,
        db_path: db_path.display().to_string(),
        progress_reporter: None,
    };

    let engine = Engine::new(config, evaluator, cancel).expect("Engine init failed");
    engine.run().await.expect("engine should complete");

    let persistence =
        Persistence::open(db_path.to_str().expect("temp db path should be valid"))
            .expect("db should open");
    let experiments = persistence
        .recent_experiments_for_blueprint("mock-empty-patchset", 10)
        .expect("experiments should load");

    assert_eq!(experiments.len(), 1);
    assert_eq!(experiments[0].promotion_outcome, PromotionOutcome::Rejected);

    let _ = fs::remove_dir_all(&repo_root);
}
