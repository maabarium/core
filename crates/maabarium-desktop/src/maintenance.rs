use chrono::{DateTime, TimeZone, Utc};
use git2::{BranchType, Repository};
use serde::Serialize;
use std::path::{Path, PathBuf};

const DEFAULT_THRESHOLD_MONTHS: u32 = 3;
const AVAILABLE_THRESHOLD_MONTHS: [u32; 3] = [1, 3, 6];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBranchInfo {
    pub name: String,
    pub run_id: Option<String>,
    pub iteration: Option<u64>,
    pub last_commit_at: Option<String>,
    pub age_days: Option<u64>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBranchAgeMetrics {
    pub older_than_1_month: usize,
    pub older_than_3_months: usize,
    pub older_than_6_months: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBranchInventory {
    pub workspace_path: String,
    pub repository_root: String,
    pub current_branch: Option<String>,
    pub total_branches: usize,
    pub age_metrics: ExperimentBranchAgeMetrics,
    pub available_threshold_months: Vec<u32>,
    pub default_threshold_months: u32,
    pub branches: Vec<ExperimentBranchInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentBranchCleanupAction {
    Delete,
    SkipCurrent,
    SkipError,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBranchCleanupEntry {
    pub name: String,
    pub age_days: Option<u64>,
    pub last_commit_at: Option<String>,
    pub action: ExperimentBranchCleanupAction,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentBranchCleanupResult {
    pub threshold_months: u32,
    pub dry_run: bool,
    pub matched_branch_count: usize,
    pub deleted_branch_count: usize,
    pub skipped_branch_count: usize,
    pub current_branch_protected: bool,
    pub summary: String,
    pub branches: Vec<ExperimentBranchCleanupEntry>,
}

pub fn inspect_experiment_branch_inventory(
    workspace_path: &Path,
) -> Result<ExperimentBranchInventory, String> {
    let repo = Repository::discover(workspace_path).map_err(|error| {
        format!(
            "Failed to discover git repository from {}: {error}",
            workspace_path.display()
        )
    })?;
    let repository_root = repository_root(&repo)?;
    let current_branch = repo
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(str::to_owned));
    let mut branches = Vec::new();
    for branch in repo
        .branches(Some(BranchType::Local))
        .map_err(|error| format!("Failed to enumerate local branches: {error}"))?
    {
        let (branch, _) = branch.map_err(|error| format!("Failed to inspect local branch: {error}"))?;
        if let Some(info) = branch_info(&branch, current_branch.as_deref())? {
            branches.push(info);
        }
    }

    branches.sort_by(|left, right| {
        right
            .age_days
            .unwrap_or(0)
            .cmp(&left.age_days.unwrap_or(0))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(ExperimentBranchInventory {
        workspace_path: workspace_path.display().to_string(),
        repository_root: repository_root.display().to_string(),
        current_branch,
        total_branches: branches.len(),
        age_metrics: ExperimentBranchAgeMetrics {
            older_than_1_month: stale_count_for_threshold(&branches, 1),
            older_than_3_months: stale_count_for_threshold(&branches, 3),
            older_than_6_months: stale_count_for_threshold(&branches, 6),
        },
        available_threshold_months: AVAILABLE_THRESHOLD_MONTHS.to_vec(),
        default_threshold_months: DEFAULT_THRESHOLD_MONTHS,
        branches,
    })
}

pub fn cleanup_experiment_branches(
    workspace_path: &Path,
    threshold_months: u32,
    dry_run: bool,
) -> Result<ExperimentBranchCleanupResult, String> {
    if threshold_months == 0 {
        return Err("Cleanup threshold must be at least 1 month".to_owned());
    }

    let inventory = inspect_experiment_branch_inventory(workspace_path)?;
    let repo = Repository::discover(workspace_path).map_err(|error| {
        format!(
            "Failed to discover git repository from {}: {error}",
            workspace_path.display()
        )
    })?;
    let threshold_days = u64::from(threshold_months) * 30;
    let matched = inventory
        .branches
        .iter()
        .filter(|branch| branch.age_days.is_some_and(|age_days| age_days >= threshold_days))
        .cloned()
        .collect::<Vec<_>>();
    let mut deleted_branch_count = 0usize;
    let mut skipped_branch_count = 0usize;
    let mut current_branch_protected = false;
    let mut branches = Vec::with_capacity(matched.len());

    for branch in matched {
        if branch.is_current {
            current_branch_protected = true;
            skipped_branch_count += 1;
            branches.push(ExperimentBranchCleanupEntry {
                name: branch.name,
                age_days: branch.age_days,
                last_commit_at: branch.last_commit_at,
                action: ExperimentBranchCleanupAction::SkipCurrent,
                reason: Some("The currently checked out branch is protected from cleanup.".to_owned()),
            });
            continue;
        }

        if dry_run {
            branches.push(ExperimentBranchCleanupEntry {
                name: branch.name,
                age_days: branch.age_days,
                last_commit_at: branch.last_commit_at,
                action: ExperimentBranchCleanupAction::Delete,
                reason: None,
            });
            continue;
        }

        match delete_local_branch(&repo, &branch.name) {
            Ok(()) => {
                deleted_branch_count += 1;
                branches.push(ExperimentBranchCleanupEntry {
                    name: branch.name,
                    age_days: branch.age_days,
                    last_commit_at: branch.last_commit_at,
                    action: ExperimentBranchCleanupAction::Delete,
                    reason: None,
                });
            }
            Err(error) => {
                skipped_branch_count += 1;
                branches.push(ExperimentBranchCleanupEntry {
                    name: branch.name,
                    age_days: branch.age_days,
                    last_commit_at: branch.last_commit_at,
                    action: ExperimentBranchCleanupAction::SkipError,
                    reason: Some(error),
                });
            }
        }
    }

    let matched_branch_count = branches.len();
    let summary = if matched_branch_count == 0 {
        format!(
            "No experiment branches are older than {threshold_months} month(s)."
        )
    } else if dry_run {
        format!(
            "Dry run matched {matched_branch_count} experiment branch(es) older than {threshold_months} month(s)."
        )
    } else {
        format!(
            "Deleted {deleted_branch_count} stale experiment branch(es); {skipped_branch_count} were skipped."
        )
    };

    Ok(ExperimentBranchCleanupResult {
        threshold_months,
        dry_run,
        matched_branch_count,
        deleted_branch_count,
        skipped_branch_count,
        current_branch_protected,
        summary,
        branches,
    })
}

fn branch_info(
    branch: &git2::Branch<'_>,
    current_branch: Option<&str>,
) -> Result<Option<ExperimentBranchInfo>, String> {
    let Some(name) = branch
        .name()
        .map_err(|error| format!("Failed to resolve branch name: {error}"))?
        .map(str::to_owned)
    else {
        return Ok(None);
    };

    if !name.starts_with("experiment-") {
        return Ok(None);
    }

    let commit = branch
        .get()
        .peel_to_commit()
        .map_err(|error| format!("Failed to load branch commit for {name}: {error}"))?;
    let last_commit_at = utc_timestamp_from_git(commit.time().seconds());
    let age_days = last_commit_at.map(|timestamp| {
        Utc::now()
            .signed_duration_since(timestamp)
            .num_days()
            .max(0) as u64
    });
    let (run_id, iteration) = parse_experiment_branch_name(&name);

    Ok(Some(ExperimentBranchInfo {
        is_current: current_branch == Some(name.as_str()),
        name,
        run_id,
        iteration,
        last_commit_at: last_commit_at.map(|timestamp| timestamp.to_rfc3339()),
        age_days,
    }))
}

fn parse_experiment_branch_name(branch_name: &str) -> (Option<String>, Option<u64>) {
    let Some(rest) = branch_name.strip_prefix("experiment-") else {
        return (None, None);
    };
    let Some((run_id, iteration)) = rest.rsplit_once("/iter-") else {
        return (None, None);
    };

    (Some(run_id.to_owned()), iteration.parse::<u64>().ok())
}

fn stale_count_for_threshold(branches: &[ExperimentBranchInfo], threshold_months: u32) -> usize {
    let threshold_days = u64::from(threshold_months) * 30;
    branches
        .iter()
        .filter(|branch| branch.age_days.is_some_and(|age_days| age_days >= threshold_days))
        .count()
}

fn utc_timestamp_from_git(seconds: i64) -> Option<DateTime<Utc>> {
    Utc.timestamp_opt(seconds, 0).single()
}

fn repository_root(repo: &Repository) -> Result<PathBuf, String> {
    if let Some(workdir) = repo.workdir() {
        return Ok(workdir.to_path_buf());
    }

    repo.path()
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Resolved repository root is unavailable".to_owned())
}

fn delete_local_branch(repo: &Repository, branch_name: &str) -> Result<(), String> {
    let mut branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|error| format!("Failed to find branch {branch_name}: {error}"))?;
    branch
        .delete()
        .map_err(|error| format!("Failed to delete branch {branch_name}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration as ChronoDuration;
    use git2::{build::CheckoutBuilder, Repository, Signature, Time};

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

    fn current_branch_name(repo: &Repository) -> String {
        repo.head()
            .expect("head should exist")
            .shorthand()
            .expect("head branch should have a name")
            .to_owned()
    }

    fn checkout_branch(repo: &Repository, branch_name: &str) {
        repo.set_head(&format!("refs/heads/{branch_name}"))
            .expect("branch should be set as HEAD");
        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        repo.checkout_head(Some(&mut checkout))
            .expect("branch should be checked out");
    }

    fn commit_with_age(repo: &Repository, file_name: &str, age_days: i64) {
        let workdir = repo.workdir().expect("workdir should exist");
        std::fs::write(workdir.join(file_name), format!("{file_name}\n"))
            .expect("file should be written");

        let mut index = repo.index().expect("index should open");
        index
            .add_path(Path::new(file_name))
            .expect("file should be staged");
        index.write().expect("index should write");

        let tree_id = index.write_tree().expect("tree should write");
        let tree = repo.find_tree(tree_id).expect("tree should load");
        let head_commit = repo
            .head()
            .expect("head should exist")
            .peel_to_commit()
            .expect("head commit should resolve");
        let timestamp = (Utc::now() - ChronoDuration::days(age_days)).timestamp();
        let signature = Signature::new(
            "Maabarium",
            "maabarium@local.invalid",
            &Time::new(timestamp, 0),
        )
        .expect("signature should build");

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("commit {file_name}"),
            &tree,
            &[&head_commit],
        )
        .expect("commit should succeed");
    }

    fn create_experiment_branch(repo: &Repository, branch_name: &str, age_days: i64) {
        let base_branch = current_branch_name(repo);
        let head_commit = repo
            .head()
            .expect("head should exist")
            .peel_to_commit()
            .expect("head commit should resolve");
        repo.branch(branch_name, &head_commit, false)
            .expect("branch should be created");
        checkout_branch(repo, branch_name);
        commit_with_age(
            repo,
            &format!("{}.txt", branch_name.replace('/', "-")),
            age_days,
        );
        checkout_branch(repo, &base_branch);
    }

    #[test]
    fn inventory_counts_stale_branches_by_threshold() {
        let temp_dir = create_test_repo();
        let repo = Repository::discover(temp_dir.path()).expect("repo should be discoverable");

        create_experiment_branch(&repo, "experiment-runold/iter-1", 200);
        create_experiment_branch(&repo, "experiment-runmid/iter-1", 100);
        create_experiment_branch(&repo, "experiment-runnew/iter-1", 10);

        let inventory = inspect_experiment_branch_inventory(temp_dir.path())
            .expect("inventory should be collected");

        assert_eq!(inventory.total_branches, 3);
        assert_eq!(inventory.age_metrics.older_than_1_month, 2);
        assert_eq!(inventory.age_metrics.older_than_3_months, 2);
        assert_eq!(inventory.age_metrics.older_than_6_months, 1);
        assert_eq!(inventory.default_threshold_months, 3);
        assert_eq!(inventory.available_threshold_months, vec![1, 3, 6]);
    }

    #[test]
    fn cleanup_skips_current_branch_and_removes_other_stale_ones() {
        let temp_dir = create_test_repo();
        let repo = Repository::discover(temp_dir.path()).expect("repo should be discoverable");

        create_experiment_branch(&repo, "experiment-runold/iter-1", 200);
        create_experiment_branch(&repo, "experiment-runcurrent/iter-1", 120);
        checkout_branch(&repo, "experiment-runcurrent/iter-1");

        let result = cleanup_experiment_branches(temp_dir.path(), 3, false)
            .expect("cleanup should succeed");

        assert_eq!(result.matched_branch_count, 2);
        assert_eq!(result.deleted_branch_count, 1);
        assert_eq!(result.skipped_branch_count, 1);
        assert!(result.current_branch_protected);
        assert!(result.branches.iter().any(|branch| {
            matches!(branch.action, ExperimentBranchCleanupAction::SkipCurrent)
                && branch.name == "experiment-runcurrent/iter-1"
        }));

        let inventory = inspect_experiment_branch_inventory(temp_dir.path())
            .expect("inventory should be collected after cleanup");
        assert_eq!(inventory.total_branches, 1);
        assert_eq!(inventory.current_branch.as_deref(), Some("experiment-runcurrent/iter-1"));
    }
}