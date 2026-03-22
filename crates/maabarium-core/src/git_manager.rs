use std::path::PathBuf;
use git2::{Repository, BranchType, Signature};
use serde::{Deserialize, Serialize};
use crate::error::GitError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub summary: String,
    pub file_patches: Vec<FilePatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePatch {
    pub path: String,
    pub content: String,
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

    pub async fn create_experiment_branch(&self, iteration: u64) -> Result<String, GitError> {
        let path = self.repo_path.clone();
        let branch_name = format!("experiment/iter-{iteration}");
        let branch_clone = branch_name.clone();
        tokio::task::spawn_blocking(move || -> Result<String, GitError> {
            let repo = Repository::open(&path)?;
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
            let repo = Repository::open(&path)?;
            let branch_ref = repo.find_branch(&branch, BranchType::Local)?;
            let branch_commit = branch_ref.get().peel_to_commit()?;
            let mut main = repo.find_branch("main", BranchType::Local)
                .or_else(|_| repo.find_branch("master", BranchType::Local))?;
            main.get_mut().set_target(branch_commit.id(), &format!("Promote {branch}"))?;
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }

    pub async fn delete_branch(&self, branch: &str) -> Result<(), GitError> {
        let path = self.repo_path.clone();
        let branch = branch.to_owned();
        tokio::task::spawn_blocking(move || -> Result<(), GitError> {
            let repo = Repository::open(&path)?;
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
            let repo = Repository::open(&path)?;
            let branch_ref = repo.find_branch(&branch, BranchType::Local)?;
            let branch_commit = branch_ref.get().peel_to_commit()?;
            let mut index = repo.index()?;
            for patch in &proposal.file_patches {
                let file_path = path.join(&patch.path);
                if let Some(parent) = file_path.parent() {
                    std::fs::create_dir_all(parent).map_err(GitError::Io)?;
                }
                std::fs::write(&file_path, &patch.content).map_err(GitError::Io)?;
                index.add_path(std::path::Path::new(&patch.path))?;
            }
            index.write()?;
            let tree_id = index.write_tree()?;
            let tree = repo.find_tree(tree_id)?;
            let sig = Signature::now("Maabarium", "maabarium@bot")?;
            repo.commit(
                Some(&format!("refs/heads/{branch}")),
                &sig,
                &sig,
                &format!("experiment: {}", proposal.summary),
                &tree,
                &[&branch_commit],
            )?;
            Ok(())
        })
        .await
        .map_err(|e| GitError::Io(std::io::Error::other(e.to_string())))?
    }
}
