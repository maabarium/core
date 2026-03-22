use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("Git operation failed: {0}")]
    Git2(#[from] git2::Error),
    #[error("Branch already exists: {0}")]
    BranchExists(String),
    #[error("Branch not found: {0}")]
    BranchNotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum LLMError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Invalid response from provider: {0}")]
    InvalidResponse(String),
    #[error("Provider error: {0}")]
    Provider(String),
    #[error("Timeout")]
    Timeout,
}

#[derive(Debug, Error)]
pub enum EvalError {
    #[error("LLM error: {0}")]
    Llm(#[from] LLMError),
    #[error("Secret error: {0}")]
    Secret(#[from] SecretError),
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Sandbox error: {0}")]
    Sandbox(String),
    #[error("No evaluators available")]
    NoEvaluators,
}

#[derive(Debug, Error)]
pub enum BlueprintError {
    #[error("TOML parse error: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum PersistError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Invalid secret input: {0}")]
    InvalidInput(String),
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Blueprint error: {0}")]
    Blueprint(#[from] BlueprintError),
    #[error("Git error: {0}")]
    Git(#[from] GitError),
    #[error("LLM error: {0}")]
    Llm(#[from] LLMError),
    #[error("Eval error: {0}")]
    Eval(#[from] EvalError),
    #[error("Persist error: {0}")]
    Persist(#[from] PersistError),
    #[error("Secret error: {0}")]
    Secret(#[from] SecretError),
    #[error("Cancelled")]
    Cancelled,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Engine error: {0}")]
    Engine(#[from] EngineError),
    #[error("Blueprint error: {0}")]
    Blueprint(#[from] BlueprintError),
    #[error("Persist error: {0}")]
    Persist(#[from] PersistError),
    #[error("Secret error: {0}")]
    Secret(#[from] SecretError),
}
