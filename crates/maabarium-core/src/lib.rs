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
pub mod secrets;
pub mod updater;

pub use blueprint::{
    BlueprintFile, BlueprintLibraryKind, BlueprintLibraryMeta, BlueprintTemplateKind,
};
pub use engine::{Engine, EngineConfig, EnginePhase, EngineProgressReporter, EngineProgressUpdate};
pub use error::CoreError;
pub use evaluator::{
    BuiltinEvaluatorKind, CodeEvaluator, EvaluatorRegistry, LoraArtifacts, LoraEvaluator,
    LoraStageArtifact, ProcessPluginEvaluator, ProcessPluginManifest, PromptEvaluator,
    ResearchArtifacts, ResearchCitation, ResearchEvaluator, ResearchQueryTrace, ResearchSource,
};
pub use logging::{default_log_path, read_recent_log_lines, read_recent_log_lines_from_path};
pub use persistence::{ExportFormat, PersistedProposal, Persistence, default_db_path};
pub use secrets::{ApiKeyStore, SecretStore};
pub use updater::{
    CliArtifactManifest, CliReleaseArtifact, ReleaseManifest, UpdaterConfiguration,
    check_for_cli_update, install_cli_update,
};
