use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use uuid::Uuid;
use wasmtime::{Engine, InstancePre, Linker, Module, Store};
use tracing::instrument;

use crate::error::EvalError;
use crate::git_manager::{FilePatchOperation, Proposal};

const POLICY_WAT: &str = r#"
    (module
      (func (export "validate")
        (param $file_count i32)
        (param $total_bytes i64)
        (param $max_files i32)
        (param $max_total_bytes i64)
        (result i32)
        local.get $file_count
        local.get $max_files
        i32.le_u
        local.get $total_bytes
        local.get $max_total_bytes
        i64.le_u
        i32.and))
"#;

struct WasmtimePolicyRuntime {
    engine: Engine,
    instance_pre: InstancePre<()>,
}

fn cached_policy_runtime() -> Result<&'static WasmtimePolicyRuntime, EvalError> {
    static POLICY_RUNTIME: OnceLock<Result<WasmtimePolicyRuntime, String>> = OnceLock::new();

    match POLICY_RUNTIME.get_or_init(|| {
        let engine = Engine::default();
        let module = Module::new(&engine, POLICY_WAT)
            .map_err(|error| format!("failed to compile wasmtime policy: {error}"))?;
        let linker = Linker::new(&engine);
        let instance_pre = linker
            .instantiate_pre(&module)
            .map_err(|error| format!("failed to pre-instantiate wasmtime policy: {error}"))?;
        Ok(WasmtimePolicyRuntime { engine, instance_pre })
    }) {
        Ok(runtime) => Ok(runtime),
        Err(error) => Err(EvalError::Sandbox(error.clone())),
    }
}

#[derive(Debug, Clone)]
pub struct SandboxSummary {
    pub file_count: usize,
    pub total_bytes: usize,
    pub root: PathBuf,
}

#[derive(Debug, Clone, Copy)]
pub struct WasmtimeIsolationPolicy {
    pub max_files: usize,
    pub max_total_bytes: usize,
}

impl Default for WasmtimeIsolationPolicy {
    fn default() -> Self {
        Self {
            max_files: 256,
            max_total_bytes: 1_048_576,
        }
    }
}

pub struct SandboxWorkspace {
    root: PathBuf,
    policy: WasmtimeIsolationPolicy,
}

#[derive(Debug, Clone)]
pub struct SubprocessRunResult {
    pub status_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone)]
pub struct SubprocessRunner {
    program: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
    timeout: Duration,
}

impl SubprocessRunner {
    pub fn new(program: impl Into<String>, args: Vec<String>, timeout: Duration) -> Self {
        Self {
            program: program.into(),
            args,
            env: Vec::new(),
            timeout,
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }

    #[instrument(name = "subprocess_runner_run", skip(self), fields(program = %self.program, timeout_secs = self.timeout.as_secs()))]
    pub async fn run(&self, work_dir: &Path) -> Result<SubprocessRunResult, EvalError> {
        use tokio::process::Command;

        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .current_dir(work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        for (key, value) in &self.env {
            command.env(key, value);
        }

        let child = command
            .spawn()
            .map_err(|error| EvalError::Sandbox(format!("failed to spawn subprocess '{}': {error}", self.program)))?;

        let output = tokio::time::timeout(self.timeout, child.wait_with_output())
            .await
            .map_err(|_| EvalError::Sandbox(format!(
                "subprocess '{}' timed out after {}s",
                self.program,
                self.timeout.as_secs()
            )))?
            .map_err(|error| EvalError::Sandbox(format!("failed to wait on subprocess '{}': {error}", self.program)))?;

        Ok(SubprocessRunResult {
            status_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        })
    }
}

impl SandboxWorkspace {
    #[instrument(name = "sandbox_workspace_new")]
    pub fn new() -> Result<Self, EvalError> {
        Self::new_with_policy(WasmtimeIsolationPolicy::default())
    }

    #[instrument(name = "sandbox_workspace_new_with_policy")]
    pub fn new_with_policy(policy: WasmtimeIsolationPolicy) -> Result<Self, EvalError> {
        let root = std::env::temp_dir().join(format!("maabarium-sandbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root)
            .map_err(|error| EvalError::Sandbox(format!("failed to create sandbox: {error}")))?;
        Ok(Self { root, policy })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    #[instrument(name = "sandbox_workspace_from_repo", fields(repo = %repo_path.display()))]
    pub fn from_repo(repo_path: &Path) -> Result<Self, EvalError> {
        let workspace = Self::new()?;
        copy_repo_snapshot(repo_path, workspace.root())?;
        Ok(workspace)
    }

    #[instrument(name = "sandbox_materialize", skip(self, proposal), fields(file_count = proposal.file_patches.len()))]
    pub fn materialize(&self, proposal: &Proposal) -> Result<SandboxSummary, EvalError> {
        let mut total_bytes = 0;

        for patch in &proposal.file_patches {
            let safe_relative_path = sanitize_relative_path(&patch.path)?;
            let file_path = self.root.join(safe_relative_path);
            match patch.operation {
                FilePatchOperation::Delete => {
                    if file_path.exists() {
                        std::fs::remove_file(&file_path).map_err(|error| {
                            EvalError::Sandbox(format!(
                                "failed to delete sandboxed patch '{}': {error}",
                                patch.path
                            ))
                        })?;
                    }
                }
                FilePatchOperation::Create | FilePatchOperation::Modify => {
                    let content = patch.content.as_deref().ok_or_else(|| {
                        EvalError::Sandbox(format!(
                            "sandbox patch '{}' is missing file content",
                            patch.path
                        ))
                    })?;
                    if let Some(parent) = file_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|error| {
                            EvalError::Sandbox(format!("failed to create sandbox subdirectory: {error}"))
                        })?;
                    }

                    std::fs::write(&file_path, content.as_bytes()).map_err(|error| {
                        EvalError::Sandbox(format!(
                            "failed to write sandboxed patch '{}': {error}",
                            patch.path
                        ))
                    })?;
                    total_bytes += content.len();
                }
            }
        }

        let summary = SandboxSummary {
            file_count: proposal.file_patches.len(),
            total_bytes,
            root: self.root.clone(),
        };

        self.validate_with_wasmtime(&summary)?;
        Ok(summary)
    }

    #[instrument(name = "sandbox_wasmtime_policy", skip(self), fields(max_files = self.policy.max_files, max_total_bytes = self.policy.max_total_bytes))]
    fn validate_with_wasmtime(&self, summary: &SandboxSummary) -> Result<(), EvalError> {
        let runtime = cached_policy_runtime()?;
        let mut store = Store::new(&runtime.engine, ());
        let instance = runtime.instance_pre.instantiate(&mut store)
            .map_err(|error| EvalError::Sandbox(format!("failed to instantiate wasmtime policy: {error}")))?;
        let validate = instance
            .get_typed_func::<(i32, i64, i32, i64), i32>(&mut store, "validate")
            .map_err(|error| EvalError::Sandbox(format!("failed to bind wasmtime policy: {error}")))?;
        let accepted = validate
            .call(
                &mut store,
                (
                    summary.file_count as i32,
                    summary.total_bytes as i64,
                    self.policy.max_files as i32,
                    self.policy.max_total_bytes as i64,
                ),
            )
            .map_err(|error| EvalError::Sandbox(format!("wasmtime policy execution failed: {error}")))?;

        if accepted == 1 {
            Ok(())
        } else {
            Err(EvalError::Sandbox(format!(
                "wasmtime isolation policy rejected sandbox output: file_count={} total_bytes={} limits=({}, {})",
                summary.file_count,
                summary.total_bytes,
                self.policy.max_files,
                self.policy.max_total_bytes,
            )))
        }
    }
}

fn copy_repo_snapshot(source_root: &Path, destination_root: &Path) -> Result<(), EvalError> {
    for entry in std::fs::read_dir(source_root)
        .map_err(|error| EvalError::Sandbox(format!("failed to read repo snapshot root: {error}")))?
    {
        let entry = entry.map_err(|error| EvalError::Sandbox(format!("failed to inspect snapshot entry: {error}")))?;
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if matches!(name.as_ref(), ".git" | "target") {
            continue;
        }

        let destination = destination_root.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|error| EvalError::Sandbox(format!("failed to inspect snapshot metadata: {error}")))?;
        if metadata.is_dir() {
            std::fs::create_dir_all(&destination)
                .map_err(|error| EvalError::Sandbox(format!("failed to create snapshot directory: {error}")))?;
            copy_repo_snapshot(&path, &destination)?;
        } else if metadata.is_file() {
            std::fs::copy(&path, &destination)
                .map_err(|error| EvalError::Sandbox(format!("failed to copy snapshot file '{}': {error}", path.display())))?;
        }
    }

    Ok(())
}

impl Drop for SandboxWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub fn sanitize_relative_path(path: &str) -> Result<PathBuf, EvalError> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(EvalError::Sandbox(format!(
            "absolute paths are not allowed in sandbox proposals: {path}"
        )));
    }

    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(EvalError::Sandbox(format!(
                    "path traversal is not allowed in sandbox proposals: {path}"
                )));
            }
            Component::CurDir => {
                return Err(EvalError::Sandbox(format!(
                    "current-directory path components are not allowed in sandbox proposals: {path}"
                )));
            }
        }
    }

    Ok(candidate.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal_paths() {
        let error =
            sanitize_relative_path("../etc/passwd").expect_err("parent traversal should fail");
        assert!(error.to_string().contains("path traversal"));
    }

    #[test]
    fn rejects_current_directory_components() {
        let error =
            sanitize_relative_path("./src/lib.rs").expect_err("curdir components should fail");
        assert!(error.to_string().contains("current-directory"));
    }

    #[test]
    fn materializes_files_inside_sandbox() {
        let workspace = SandboxWorkspace::new().expect("sandbox should be created");
        let proposal = Proposal {
            summary: "sandbox test".into(),
            file_patches: vec![crate::git_manager::FilePatch {
                path: "src/lib.rs".into(),
                operation: FilePatchOperation::Create,
                content: Some("fn example() {}".into()),
            }],
        };

        let summary = workspace
            .materialize(&proposal)
            .expect("proposal should materialize");
        assert_eq!(summary.file_count, 1);
        assert!(workspace.root().join("src/lib.rs").exists());
    }

    #[test]
    fn rejects_materialization_when_wasmtime_policy_limits_are_exceeded() {
        let workspace = SandboxWorkspace::new_with_policy(WasmtimeIsolationPolicy {
            max_files: 1,
            max_total_bytes: 4,
        })
        .expect("sandbox should be created");

        let proposal = Proposal {
            summary: "sandbox policy test".into(),
            file_patches: vec![crate::git_manager::FilePatch {
                path: "src/lib.rs".into(),
                operation: FilePatchOperation::Create,
                content: Some("fn example() {}".into()),
            }],
        };

        let error = workspace
            .materialize(&proposal)
            .expect_err("wasmtime policy should reject oversized content");
        assert!(error.to_string().contains("wasmtime isolation policy rejected"));
    }

    #[test]
    fn reuses_cached_wasmtime_runtime() {
        let first = cached_policy_runtime().expect("policy runtime should initialize") as *const _;
        let second = cached_policy_runtime().expect("policy runtime should reuse cache") as *const _;

        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn subprocess_runner_captures_output() {
        let runner = SubprocessRunner::new(
            "sh",
            vec!["-c".into(), "printf 'ok'".into()],
            Duration::from_secs(2),
        );
        let output = runner
            .run(Path::new("."))
            .await
            .expect("subprocess should complete");

        assert_eq!(output.status_code, Some(0));
        assert_eq!(output.stdout, "ok");
    }
}
