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
pub mod metrics;
pub mod persistence;

pub use blueprint::BlueprintFile;
pub use engine::{Engine, EngineConfig};
pub use error::CoreError;
pub use evaluator::{CodeEvaluator, LoraEvaluator, PromptEvaluator};
pub use persistence::{ExportFormat, Persistence};
