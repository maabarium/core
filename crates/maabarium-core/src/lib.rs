//! Core engine and supporting types for Maabarium.
//!
//! The crate provides the blueprint loader, evaluator abstractions, git-backed
//! engine loop, and persistence helpers used by the CLI and desktop app.

pub mod agent;
pub mod blueprint;
pub mod engine;
pub mod error;
pub mod evaluator;
pub mod git_manager;
pub mod llm;
pub mod logging;
pub mod metrics;
pub mod persistence;
pub mod runtime_dependencies;
pub mod secrets;
pub mod setup_wizard;
pub mod updater;

pub use blueprint::{
    BlueprintFile, BlueprintLibraryKind, BlueprintLibraryMeta, BlueprintTemplateKind,
};
pub use engine::{
    Engine, EngineConfig, EnginePhase, EnginePhaseTiming, EngineProgressReporter,
    EngineProgressUpdate, EngineTimingSummary,
};
pub use error::CoreError;
pub use evaluator::{
    BuiltinEvaluatorKind, CodeEvaluator, EvaluationContext, EvaluatorRegistry, LoraArtifacts,
    LoraEvaluator, LoraStageArtifact, ProcessPluginEvaluator, ProcessPluginManifest,
    PromptEvaluator, ResearchArtifacts, ResearchCitation, ResearchEvaluator, ResearchQueryTrace,
    ResearchSource,
};
pub use logging::{default_log_path, read_recent_log_lines, read_recent_log_lines_from_path};
pub use persistence::{
    ExportFormat, PersistedProposal, Persistence, PromotionOutcome, default_db_path,
};
pub use runtime_dependencies::{
    GitDependencyEnsureOutcome, GitDependencyStatus, GitInstallerKind, ensure_git_dependency,
    git_dependency_status,
};
pub use secrets::{ApiKeyStore, SecretStore};
pub use setup_wizard::{
    EnvironmentProfile, FixOutcome, FixTarget, OllamaStatus as SetupOllamaStatus,
    ProfileConfig, ProviderValidationResult, ReadinessItem as SetupReadinessItem,
    ReadinessLevel, ReadinessReport, ReadinessScanner, WorkspaceAnalysis,
    analyze_workspace, apply_all_fixes, apply_git_fix, apply_profile,
    detect_recommended_profile, ollama_status as setup_ollama_status,
    start_ollama as setup_start_ollama, validate_ollama_connection,
    validate_provider_connection,
};
pub use updater::{
    CliArtifactManifest, CliReleaseArtifact, ReleaseManifest, UpdaterConfiguration,
    check_for_cli_update, install_cli_update,
};
