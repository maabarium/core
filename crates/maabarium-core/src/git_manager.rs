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

#[derive(Debug, Clone)]
pub struct ExperimentWorkspace {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct ApplyProposalTiming {
    pub worktree_registration_ms: u64,
    pub reset_clean_ms: u64,
    pub checkout_detach_ms: u64,
    pub checkout_target_branch_ms: u64,
    pub patch_materialization_ms: u64,
    pub reused_workspace: bool,
    pub macos_no_checkout_used: bool,
    pub workspace_exists_before: bool,
    pub workspace_valid_before: bool,
    pub workspace_exists_after_apply: bool,
    pub workspace_valid_after_apply: bool,
}

#[derive(Debug, Clone)]
pub struct AppliedProposal {
    pub workspace: ExperimentWorkspace,
    pub timing: ApplyProposalTiming,
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

    pub fn experiment_branch_name(run_id: &str, iteration: u64) -> String {
        format!("experiment-{run_id}/iter-{iteration}")
    }

    pub async fn create_experiment_branch(
        &self,
        run_id: &str,
        iteration: u64,
    ) -> Result<String, GitError> {
        let path = self.repo_path.clone();
        let branch_name = Self::experiment_branch_name(run_id, iteration);
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

    pub async fn create_branch_at_workspace_head(
        &self,
        workspace_path: &Path,
        branch: &str,
    ) -> Result<(), GitError> {
        let workspace_path = workspace_path.to_path_buf();
        let branch = branch.to_owned();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo = discover_repository(&workspace_path)?;
            let head = repo.head()?;
            let head_commit = head.peel_to_commit()?;
            repo.branch(&branch, &head_commit, false).map_err(|e| {
                if e.code() == git2::ErrorCode::Exists {
                    GitError::BranchExists(branch.clone())
                } else {
                    GitError::Git2(e)
                }
            })?;
            Ok(())
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

    pub async fn apply_proposal(
        &self,
        branch: &str,
        proposal: &Proposal,
        workspace: Option<&ExperimentWorkspace>,
    ) -> Result<AppliedProposal, GitError> {
        let path = self.repo_path.clone();
        let branch = branch.to_owned();
        let proposal = proposal.clone();
        let reusable_workspace_path = workspace.map(|workspace| workspace.path.clone());
        tokio::task::spawn_blocking(move || -> Result<AppliedProposal, GitError> {
            let repo_root = discover_repository_root(&path)?;
            let workspace_path = reusable_workspace_path.unwrap_or_else(|| {
                std::env::temp_dir().join(format!(
                    "maabarium-{}-{}",
                    branch.replace('/', "-"),
                    uuid::Uuid::new_v4()
                ))
            });

            let result = (|| -> Result<AppliedProposal, GitError> {
                let mut timing = prepare_worktree(&repo_root, &workspace_path)?;

                let patch_started = std::time::Instant::now();

                for patch in &proposal.file_patches {
                    let file_path = workspace_path.join(&patch.path);
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
                timing.patch_materialization_ms = patch_started.elapsed().as_millis() as u64;
                timing.workspace_exists_after_apply = workspace_path.exists();
                timing.workspace_valid_after_apply = is_valid_git_workspace(&workspace_path);

                Ok(AppliedProposal {
                    workspace: ExperimentWorkspace {
                        path: workspace_path.clone(),
                    },
                    timing,
                })
            })();

            if result.is_err() && workspace_path.exists() {
                let _ = remove_git_worktree(&repo_root, &workspace_path);
                let _ = std::fs::remove_dir_all(&workspace_path);
            }

            result
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn detach_experiment_workspace(
        &self,
        workspace_path: &Path,
    ) -> Result<(), GitError> {
        let workspace_path = workspace_path.to_path_buf();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            if !workspace_path.exists() {
                return Ok(());
            }

            let _ = run_git(&workspace_path, ["reset", "--hard"]);
            let _ = run_git(&workspace_path, ["clean", "-fd"]);
            run_git(&workspace_path, ["checkout", "--force", "--detach", "HEAD"])
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn cleanup_experiment_workspace(
        &self,
        workspace_path: &Path,
    ) -> Result<(), GitError> {
        let path = self.repo_path.clone();
        let workspace_path = workspace_path.to_path_buf();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo_root = discover_repository_root(&path)?;
            let _ = run_git(&workspace_path, ["checkout", "--force", "--detach", "HEAD"]);
            remove_git_worktree(&repo_root, &workspace_path)?;
            let _ = std::fs::remove_dir_all(&workspace_path);
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn commit_experiment_workspace(
        &self,
        workspace_path: &Path,
        proposal_summary: &str,
    ) -> Result<bool, GitError> {
        let workspace_path = workspace_path.to_path_buf();
        let proposal_summary = proposal_summary.to_owned();
        tokio::task::spawn_blocking(move || -> Result<bool, GitError> {
            run_git(&workspace_path, ["add", "--all"])?;
            let staged_changes = run_git_status(&workspace_path, ["diff", "--cached", "--quiet"]);
            if matches!(staged_changes, Ok(0)) {
                return Ok(false);
            }

            run_git(
                &workspace_path,
                [
                    "-c",
                    "user.name=Maabarium",
                    "-c",
                    "user.email=maabarium@local.invalid",
                    "commit",
                    "-m",
                    &format!("experiment: {}", proposal_summary),
                    "--author",
                    "Maabarium <maabarium@bot>",
                ],
            )?;
            Ok(true)
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }
}

fn prepare_worktree(repo_root: &Path, workspace_path: &Path) -> Result<ApplyProposalTiming, GitError> {
    let workspace_exists_before = workspace_path.exists();
    let workspace_valid_before = workspace_exists_before && is_valid_git_workspace(workspace_path);
    let created_workspace = !workspace_exists_before || !workspace_valid_before;
    let mut timing = ApplyProposalTiming {
        reused_workspace: !created_workspace,
        workspace_exists_before,
        workspace_valid_before,
        ..ApplyProposalTiming::default()
    };

    let detach_started = std::time::Instant::now();
    if created_workspace {
        let registration_started = std::time::Instant::now();
        if workspace_path.exists() {
            let _ = std::fs::remove_dir_all(workspace_path);
        }
        let _ = run_git(repo_root, ["worktree", "prune"]);
        std::fs::create_dir_all(workspace_path).map_err(GitError::Io)?;
        timing.macos_no_checkout_used = add_worktree(repo_root, workspace_path)?;
        timing.worktree_registration_ms = registration_started.elapsed().as_millis() as u64;
    } else {
        let reset_clean_started = std::time::Instant::now();
        let _ = run_git(workspace_path, ["reset", "--hard"]);
        let _ = run_git(workspace_path, ["clean", "-fd"]);
        timing.reset_clean_ms = reset_clean_started.elapsed().as_millis() as u64;

        if is_branch_attached(workspace_path) {
            run_git(workspace_path, ["checkout", "--force", "--detach", "HEAD"])?;
            timing.checkout_detach_ms = detach_started.elapsed().as_millis() as u64;
        }
    }

    Ok(timing)
}

fn add_worktree(repo_root: &Path, workspace_path: &Path) -> Result<bool, GitError> {
    #[cfg(target_os = "macos")]
    {
        if run_git(
            repo_root,
            [
                "worktree",
                "add",
                "--force",
                "--detach",
                "--no-checkout",
                workspace_path.to_str().unwrap_or_default(),
                "HEAD",
            ],
        )
        .is_ok()
        {
            return Ok(true);
        }
    }

    run_git(
        repo_root,
        [
            "worktree",
            "add",
            "--force",
            "--detach",
            workspace_path.to_str().unwrap_or_default(),
            "HEAD",
        ],
    )?;
    Ok(false)
}

fn is_valid_git_workspace(workspace_path: &Path) -> bool {
    matches!(
        run_git_status(workspace_path, ["rev-parse", "--is-inside-work-tree"]),
        Ok(0)
    )
}

fn is_branch_attached(workspace_path: &Path) -> bool {
    matches!(run_git_status(workspace_path, ["symbolic-ref", "-q", "HEAD"]), Ok(0))
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

    #[tokio::test]
    async fn reuses_existing_worktree_path_across_iterations() {
        let temp_dir = create_test_repo();
        let git = GitManager::new(temp_dir.path());

        let first_branch = git
            .create_experiment_branch("runreuse1", 1)
            .await
            .expect("first branch should be created");
        let second_branch = git
            .create_experiment_branch("runreuse1", 2)
            .await
            .expect("second branch should be created");

        let first_workspace = git
            .apply_proposal(
                &first_branch,
                &Proposal {
                    summary: "first".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("first\n".into()),
                    }],
                },
                None,
            )
            .await
            .expect("first proposal should apply")
            .workspace;

        let first_path = first_workspace.path.clone();
        let second_workspace = git
            .apply_proposal(
                &second_branch,
                &Proposal {
                    summary: "second".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("second\n".into()),
                    }],
                },
                Some(&first_workspace),
            )
            .await
            .expect("second proposal should reuse the workspace")
            .workspace;

        assert_eq!(first_path, second_workspace.path);

        git.cleanup_experiment_workspace(&second_workspace.path)
            .await
            .expect("workspace should clean up");
    }

    #[tokio::test]
    async fn apply_proposal_does_not_require_existing_branch() {
        let temp_dir = create_test_repo();
        let git = GitManager::new(temp_dir.path());

        let applied = git
            .apply_proposal(
                "experiment-detached/iter-1",
                &Proposal {
                    summary: "detached".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("detached\n".into()),
                    }],
                },
                None,
            )
            .await
            .expect("proposal should apply without a pre-created branch");

        assert!(applied.workspace.path.exists());
        assert_eq!(applied.timing.checkout_target_branch_ms, 0);

        git.cleanup_experiment_workspace(&applied.workspace.path)
            .await
            .expect("workspace should clean up");
    }

    #[tokio::test]
    async fn recreates_missing_reusable_worktree_path() {
        let temp_dir = create_test_repo();
        let git = GitManager::new(temp_dir.path());

        let first_branch = git
            .create_experiment_branch("runrecreate1", 1)
            .await
            .expect("first branch should be created");
        let second_branch = git
            .create_experiment_branch("runrecreate1", 2)
            .await
            .expect("second branch should be created");

        let first_workspace = git
            .apply_proposal(
                &first_branch,
                &Proposal {
                    summary: "first".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("first\n".into()),
                    }],
                },
                None,
            )
            .await
            .expect("first proposal should apply")
            .workspace;

        std::fs::remove_dir_all(&first_workspace.path)
            .expect("stale workspace path should be removable");

        let recreated_workspace = git
            .apply_proposal(
                &second_branch,
                &Proposal {
                    summary: "second".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("second\n".into()),
                    }],
                },
                Some(&first_workspace),
            )
            .await
            .expect("missing reusable workspace should be recreated")
            .workspace;

        assert_eq!(first_workspace.path, recreated_workspace.path);
        assert!(recreated_workspace.path.exists());

        git.cleanup_experiment_workspace(&recreated_workspace.path)
            .await
            .expect("workspace should clean up");
    }

    #[tokio::test]
    async fn reuses_workspace_after_promoting_previous_branch() {
        let temp_dir = create_test_repo();
        let git = GitManager::new(temp_dir.path());

        let first_branch = GitManager::experiment_branch_name("runpromote1", 1);
        let first_applied = git
            .apply_proposal(
                &first_branch,
                &Proposal {
                    summary: "first".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("first\n".into()),
                    }],
                },
                None,
            )
            .await
            .expect("first proposal should apply");

        git.commit_experiment_workspace(&first_applied.workspace.path, "first")
            .await
            .expect("workspace should commit successfully");
        git.create_branch_at_workspace_head(&first_applied.workspace.path, &first_branch)
            .await
            .expect("branch should be created from detached workspace head");

        git.promote_branch(&first_branch)
            .await
            .expect("first branch should promote");

        let second_branch = GitManager::experiment_branch_name("runpromote1", 2);
        let second_applied = git
            .apply_proposal(
                &second_branch,
                &Proposal {
                    summary: "second".into(),
                    file_patches: vec![FilePatch {
                        path: "README.md".into(),
                        operation: FilePatchOperation::Modify,
                        content: Some("second\n".into()),
                    }],
                },
                Some(&first_applied.workspace),
            )
            .await
            .expect("second proposal should reuse the promoted workspace");

        assert!(second_applied.timing.reused_workspace);
        assert_eq!(second_applied.timing.worktree_registration_ms, 0);
        assert!(second_applied.timing.reset_clean_ms > 0);
        assert_eq!(second_applied.timing.checkout_detach_ms, 0);
        assert_eq!(second_applied.timing.checkout_target_branch_ms, 0);

        git.cleanup_experiment_workspace(&second_applied.workspace.path)
            .await
            .expect("workspace should clean up");
    }
}

fn discover_repository(repo_path: &Path) -> Result<Repository, GitError> {
    Repository::discover(repo_path).map_err(GitError::from)
}

fn remove_git_worktree(repo_root: &Path, worktree_path: &Path) -> Result<(), GitError> {
    run_git(
        repo_root,
        [
            "worktree",
            "remove",
            "--force",
            worktree_path.to_str().unwrap_or_default(),
        ],
    )
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
