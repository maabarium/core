use crate::error::GitError;
use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub summary: String,
    pub file_patches: Vec<FilePatch>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilePatchOperation {
    Create,
    Modify,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePatch {
    pub path: String,
    pub operation: FilePatchOperation,
    pub content: Option<String>,
}

pub struct GitManager {
    repo_path: PathBuf,
}

impl GitManager {
    pub fn new(repo_path: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
        }
    }

    pub async fn create_experiment_branch(
        &self,
        run_id: &str,
        iteration: u64,
    ) -> Result<String, GitError> {
        let path = self.repo_path.clone();
        let branch_name = format!("experiment-{run_id}/iter-{iteration}");
        let branch_clone = branch_name.clone();
        tokio::task::spawn_blocking(move || -> Result<String, GitError> {
            let repo = discover_repository(&path)?;
            let head = repo.head()?;
            let head_commit = head.peel_to_commit()?;
            // `force = false` so an existing branch returns an error rather than
            // silently overwriting it. If the branch name already exists from a
            // prior interrupted run, treat it as a `BranchExists` error so callers
            // can decide whether to reuse or skip the iteration.
            repo.branch(&branch_clone, &head_commit, false)
                .map_err(|e| {
                    if e.code() == git2::ErrorCode::Exists {
                        GitError::BranchExists(branch_clone.clone())
                    } else {
                        GitError::Git2(e)
                    }
                })?;
            Ok(branch_clone)
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn promote_branch(&self, branch: &str) -> Result<(), GitError> {
        let path = self.repo_path.clone();
        let branch = branch.to_owned();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo = discover_repository(&path)?;
            let branch_ref = repo.find_branch(&branch, BranchType::Local)?;
            let branch_commit = branch_ref.get().peel_to_commit()?;
            let mut main = repo
                .find_branch("main", BranchType::Local)
                .or_else(|_| repo.find_branch("master", BranchType::Local))?;
            main.get_mut()
                .set_target(branch_commit.id(), &format!("Promote {branch}"))?;
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn delete_branch(&self, branch: &str) -> Result<(), GitError> {
        let path = self.repo_path.clone();
        let branch = branch.to_owned();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo = discover_repository(&path)?;
            let mut b = repo.find_branch(&branch, BranchType::Local)?;
            b.delete()?;
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn apply_proposal(&self, branch: &str, proposal: &Proposal) -> Result<(), GitError> {
        let path = self.repo_path.clone();
        let branch = branch.to_owned();
        let proposal = proposal.clone();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo_root = discover_repository_root(&path)?;
            let temp_dir = std::env::temp_dir().join(format!(
                "maabarium-{}-{}",
                branch.replace('/', "-"),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&temp_dir).map_err(GitError::Io)?;

            run_git(
                &repo_root,
                [
                    "worktree",
                    "add",
                    temp_dir.to_str().unwrap_or_default(),
                    &branch,
                ],
            )?;

            for patch in &proposal.file_patches {
                let file_path = temp_dir.join(&patch.path);
                match patch.operation {
                    FilePatchOperation::Delete => {
                        if file_path.exists() {
                            std::fs::remove_file(&file_path).map_err(GitError::Io)?;
                        }
                    }
                    FilePatchOperation::Create | FilePatchOperation::Modify => {
                        let content = patch.content.as_ref().ok_or_else(|| {
                            GitError::Io(std::io::Error::other(format!(
                                "patch '{}' is missing file content",
                                patch.path
                            )))
                        })?;
                        if let Some(parent) = file_path.parent() {
                            std::fs::create_dir_all(parent).map_err(GitError::Io)?;
                        }
                        std::fs::write(&file_path, content).map_err(GitError::Io)?;
                    }
                }
            }

            let add_result = run_git(&temp_dir, ["add", "--all"]);
            let staged_changes = run_git_status(&temp_dir, ["diff", "--cached", "--quiet"]);
            let commit_result = run_git(
                &temp_dir,
                [
                    "-c",
                    "user.name=Maabarium",
                    "-c",
                    "user.email=maabarium@local.invalid",
                    "commit",
                    "-m",
                    &format!("experiment: {}", proposal.summary),
                    "--author",
                    "Maabarium <maabarium@bot>",
                ],
            );
            let cleanup_result = run_git(
                &repo_root,
                [
                    "worktree",
                    "remove",
                    "--force",
                    temp_dir.to_str().unwrap_or_default(),
                ],
            );
            let _ = std::fs::remove_dir_all(&temp_dir);

            add_result?;
            if matches!(staged_changes, Ok(0)) {
                cleanup_result?;
                return Ok(());
            }
            commit_result?;
            cleanup_result?;
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};

    fn create_test_repo() -> tempfile::TempDir {
        let temp_dir = tempfile::tempdir().expect("tempdir should be created");
        let repo = Repository::init(temp_dir.path()).expect("repo should initialize");
        std::fs::write(temp_dir.path().join("README.md"), "baseline\n")
            .expect("baseline file should be written");

        let mut index = repo.index().expect("index should open");
        index
            .add_path(Path::new("README.md"))
            .expect("file should be staged");
        index.write().expect("index should write");

        let tree_id = index.write_tree().expect("tree should write");
        let tree = repo.find_tree(tree_id).expect("tree should load");
        let signature = Signature::now("Maabarium", "maabarium@local.invalid")
            .expect("signature should build");

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "init",
            &tree,
            &[],
        )
        .expect("initial commit should succeed");

        temp_dir
    }

    #[tokio::test]
    async fn create_experiment_branch_namespaces_by_run_id() {
        let temp_dir = create_test_repo();
        let git = GitManager::new(temp_dir.path());

        let first = git
            .create_experiment_branch("runaaaa1", 1)
            .await
            .expect("first branch should be created");
        let second = git
            .create_experiment_branch("runbbbb2", 1)
            .await
            .expect("second branch should be created");

        assert_eq!(first, "experiment-runaaaa1/iter-1");
        assert_eq!(second, "experiment-runbbbb2/iter-1");

        let repo = Repository::discover(temp_dir.path()).expect("repo should be discoverable");
        repo.find_branch(&first, BranchType::Local)
            .expect("first branch should exist");
        repo.find_branch(&second, BranchType::Local)
            .expect("second branch should exist");
    }
}

fn discover_repository(repo_path: &Path) -> Result<Repository, GitError> {
    Repository::discover(repo_path).map_err(GitError::from)
}

fn discover_repository_root(repo_path: &Path) -> Result<PathBuf, GitError> {
    let repo = discover_repository(repo_path)?;
    if let Some(workdir) = repo.workdir() {
        return Ok(workdir.to_path_buf());
    }

    repo.path()
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| GitError::Io(std::io::Error::other("Repository root is unavailable")))
}

fn run_git<const N: usize>(repo_path: &std::path::Path, args: [&str; N]) -> Result<(), GitError> {
    match run_git_status(repo_path, args) {
        Ok(0) => Ok(()),
        Ok(_) | Err(_) => {
            let output = Command::new("git")
                .arg("-C")
                .arg(repo_path)
                .args(args)
                .output()
                .map_err(GitError::Io)?;

            if output.status.success() {
                return Ok(());
            }

            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            Err(GitError::Io(std::io::Error::other(
                if !stderr.is_empty() { stderr } else { stdout },
            )))
        }
    }
}

fn run_git_status<const N: usize>(repo_path: &std::path::Path, args: [&str; N]) -> Result<i32, GitError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(GitError::Io)?;

    Ok(output.status.code().unwrap_or(1))
}
