use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

use crate::error::EvalError;
use crate::git_manager::Proposal;

#[derive(Debug, Clone)]
pub struct SandboxSummary {
    pub file_count: usize,
    pub total_bytes: usize,
    pub root: PathBuf,
}

pub struct SandboxWorkspace {
    root: PathBuf,
}

impl SandboxWorkspace {
    pub fn new() -> Result<Self, EvalError> {
        let root = std::env::temp_dir().join(format!("maabarium-sandbox-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root)
            .map_err(|error| EvalError::Sandbox(format!("failed to create sandbox: {error}")))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn materialize(&self, proposal: &Proposal) -> Result<SandboxSummary, EvalError> {
        let mut total_bytes = 0;

        for patch in &proposal.file_patches {
            let safe_relative_path = sanitize_relative_path(&patch.path)?;
            let file_path = self.root.join(safe_relative_path);
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    EvalError::Sandbox(format!("failed to create sandbox subdirectory: {error}"))
                })?;
            }

            std::fs::write(&file_path, patch.content.as_bytes()).map_err(|error| {
                EvalError::Sandbox(format!(
                    "failed to write sandboxed patch '{}': {error}",
                    patch.path
                ))
            })?;
            total_bytes += patch.content.len();
        }

        Ok(SandboxSummary {
            file_count: proposal.file_patches.len(),
            total_bytes,
            root: self.root.clone(),
        })
    }
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
                content: "fn example() {}".into(),
            }],
        };

        let summary = workspace
            .materialize(&proposal)
            .expect("proposal should materialize");
        assert_eq!(summary.file_count, 1);
        assert!(workspace.root().join("src/lib.rs").exists());
    }
}
