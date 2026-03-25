use maabarium_core::Persistence;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::process::{Command, Output};
use uuid::Uuid;

fn temp_test_dir() -> PathBuf {
    std::env::temp_dir().join(format!(
        "maabarium-process-plugin-smoke-{}",
        Uuid::new_v4()
    ))
}

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("parent directory should be created");
    }
    std::fs::write(path, content).expect("file should be written");
}

fn run_git(temp_dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(temp_dir)
        .status()
        .expect("git should launch successfully");
    assert!(status.success(), "git command failed: {args:?}");
}

fn seed_process_plugin_workspace(temp_dir: &Path, blueprint_name: &str, plugin_script: &str) {
    std::fs::create_dir_all(temp_dir.join("src"))
        .expect("temporary source directory should be created");

    write_file(&temp_dir.join("src/lib.rs"), "pub fn baseline() {}\n");
    write_file(&temp_dir.join("temp-plugin.sh"), plugin_script);
    write_file(
        &temp_dir.join("process-plugin-manifest.toml"),
        "[plugin]\nid = \"temp-score\"\nversion = \"0.1.0\"\ndisplay_name = \"Temp Score Plugin\"\ntimeout_seconds = 5\n\n[process]\ncommand = \"sh\"\nargs = [\"./temp-plugin.sh\"]\nworking_dir = \".\"\n",
    );
    write_file(
        &temp_dir.join("blueprint.toml"),
        &format!(
            "[blueprint]\nname = \"{blueprint_name}\"\nversion = \"0.1.0\"\ndescription = \"Temporary process plugin workflow\"\n\n[domain]\nrepo_path = \".\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 1\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n  {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Overall quality\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n  {{ name = \"fixture-agent\", role = \"tester\", system_prompt = \"You are a fixture agent.\", model = \"mock\" }},\n]\n\n[models]\nmodels = [\n  {{ name = \"mock\", provider = \"mock\", endpoint = \"http://localhost\", temperature = 0.0, max_tokens = 128 }},\n]\n\n[evaluator]\nkind = \"process\"\nmanifest_path = \"./process-plugin-manifest.toml\"\nplugin_id = \"temp-score\"\n"
        ),
    );

    run_git(temp_dir, &["init", "-q"]);
    run_git(temp_dir, &["add", "."]);
    run_git(
        &temp_dir,
        &[
            "-c",
            "user.name=Maabarium",
            "-c",
            "user.email=maabarium@local.invalid",
            "commit",
            "-qm",
            "init",
        ],
    );
}

fn run_cli_workflow(temp_dir: &Path, database_path: &Path) -> ExitStatus {
    Command::new(env!("CARGO_BIN_EXE_maabarium"))
        .args([
            "run",
            temp_dir.join("blueprint.toml").to_str().expect("utf-8 path"),
            "--db",
            database_path.to_str().expect("utf-8 path"),
        ])
        .current_dir(temp_dir)
        .status()
        .expect("CLI should launch successfully")
}

fn run_cli_status(database_path: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_maabarium"))
        .args([
            "status",
            "--db",
            database_path.to_str().expect("utf-8 path"),
        ])
        .output()
        .expect("CLI status should launch successfully")
}

#[test]
fn cli_runs_process_plugin_workflow_end_to_end() {
    let temp_dir = temp_test_dir();
    seed_process_plugin_workspace(
        &temp_dir,
        "temp-process-plugin",
        "#!/bin/sh\ncat >/dev/null\nprintf '%s' '{\"scores\":[{\"name\":\"quality\",\"value\":0.91,\"weight\":1.0}],\"weightedTotal\":0.91,\"durationMs\":17}'\n",
    );

    let database_path = temp_dir.join("plugin.db");
    let status = run_cli_workflow(&temp_dir, &database_path);

    assert!(status.success(), "CLI run should succeed");

    let persistence = Persistence::open(database_path.to_str().expect("utf-8 path"))
        .expect("persistence should open the temporary db");
    let experiments = persistence
        .recent_experiments(5)
        .expect("experiments should be readable");
    let latest = experiments.first().expect("a persisted experiment should exist");

    assert_eq!(latest.blueprint_name, "temp-process-plugin");
    assert!(latest.error.is_none(), "latest experiment should succeed");
    assert!((latest.weighted_total - 0.91).abs() < f64::EPSILON);

    let status_output = run_cli_status(&database_path);
    assert!(status_output.status.success(), "CLI status should succeed");
    let status_stdout =
        String::from_utf8(status_output.stdout).expect("status stdout should be utf-8");
    assert!(status_stdout.contains("outcome=promoted"));

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn cli_records_process_plugin_failure_for_invalid_json_response() {
    let temp_dir = temp_test_dir();
    seed_process_plugin_workspace(
        &temp_dir,
        "temp-process-plugin-invalid-json",
        "#!/bin/sh\ncat >/dev/null\nprintf '%s' '{not-valid-json}'\n",
    );

    let database_path = temp_dir.join("plugin.db");
    let status = run_cli_workflow(&temp_dir, &database_path);

    assert!(
        status.success(),
        "CLI run should still complete even when evaluation fails"
    );

    let persistence = Persistence::open(database_path.to_str().expect("utf-8 path"))
        .expect("persistence should open the temporary db");
    let experiments = persistence
        .recent_experiments(5)
        .expect("experiments should be readable");
    let latest = experiments.first().expect("a persisted experiment should exist");

    assert_eq!(latest.blueprint_name, "temp-process-plugin-invalid-json");
    assert_eq!(latest.weighted_total, 0.0);
    assert_eq!(latest.duration_ms, 0);
    assert!(
        latest
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Invalid evaluator plugin response from 'temp-score'")),
        "expected persisted evaluator parse error, got: {:?}",
        latest.error
    );

    let _ = std::fs::remove_dir_all(temp_dir);
}

#[test]
fn cli_records_process_plugin_failure_for_timeout() {
    let temp_dir = temp_test_dir();
    seed_process_plugin_workspace(
        &temp_dir,
        "temp-process-plugin-timeout",
        "#!/bin/sh\ncat >/dev/null\nsleep 6\nprintf '%s' '{\"scores\":[{\"name\":\"quality\",\"value\":0.91,\"weight\":1.0}],\"weightedTotal\":0.91,\"durationMs\":17}'\n",
    );

    let database_path = temp_dir.join("plugin.db");
    let status = run_cli_workflow(&temp_dir, &database_path);

    assert!(
        status.success(),
        "CLI run should still complete even when evaluation times out"
    );

    let persistence = Persistence::open(database_path.to_str().expect("utf-8 path"))
        .expect("persistence should open the temporary db");
    let experiments = persistence
        .recent_experiments(5)
        .expect("experiments should be readable");
    let latest = experiments.first().expect("a persisted experiment should exist");

    assert_eq!(latest.blueprint_name, "temp-process-plugin-timeout");
    assert_eq!(latest.weighted_total, 0.0);
    assert_eq!(latest.duration_ms, 0);
    assert!(
        latest
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Evaluator plugin 'temp-score' timed out after 5s")),
        "expected persisted evaluator timeout, got: {:?}",
        latest.error
    );

    let _ = std::fs::remove_dir_all(temp_dir);
}