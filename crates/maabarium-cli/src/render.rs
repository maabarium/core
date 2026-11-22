//! Terminal rendering helpers for CLI status and group results output.
//!
//! Provides table-formatting and status-icon helpers used by the group
//! and telegram CLI subcommands.

use maabarium_core::run_groups::{
    ExecutionMode, GroupRun, GroupRunExperiment, GroupRunStatus, RunExperimentStatus, RunGroup,
};

/// Render a single run group as a compact header + blueprint list.
pub fn render_group_card(group: &RunGroup) -> String {
    let mode_icon = match group.execution_mode {
        ExecutionMode::Sequential => "\u{25B6} Sequential",
        ExecutionMode::Parallel => "\u{25B6}\u{25B6} Parallel",
    };

    let schedule = match &group.schedule {
        Some(s) if s.enabled => format!("{}", s.kind.describe()),
        Some(_) => "Schedule: disabled".to_owned(),
        None => "No schedule".to_owned(),
    };

    let telegram = if group.telegram_enabled {
        "\u{1F4E1} Notifications on"
    } else {
        "\u{1F4E1} Notifications off"
    };

    let blueprint_lines: Vec<String> = group
        .blueprints
        .iter()
        .map(|bp| {
            let notify = if bp.notifications_enabled {
                ""
            } else {
                " [notifications off]"
            };
            format!(
                "  {}. {} \u{2192} {}{}",
                bp.sort_order + 1,
                bp.blueprint_name,
                bp.blueprint_path,
                notify,
            )
        })
        .collect();

    format!(
        "{}\n\
         {} | {} | {}\n\
         Blueprints ({}):\n\
         {}\n",
        group.name,
        mode_icon,
        schedule,
        telegram,
        group.blueprints.len(),
        blueprint_lines.join("\n"),
    )
}

/// Status icon for a run experiment status.
pub fn run_experiment_status_icon(status: RunExperimentStatus) -> &'static str {
    match status {
        RunExperimentStatus::Pending => "\u{25CB}",   // ○
        RunExperimentStatus::Running => "\u{25C9}",   // ◉
        RunExperimentStatus::Completed => "\u{2714}", // ✔
        RunExperimentStatus::Failed => "\u{26A0}",    // ⚠
        RunExperimentStatus::Skipped => "\u{2298}",   // ⊘
    }
}

/// Status icon for a group run status.
pub fn group_run_status_icon(status: GroupRunStatus) -> &'static str {
    match status {
        GroupRunStatus::Pending => "\u{25CB}",   // ○
        GroupRunStatus::Running => "\u{25C9}",   // ◉
        GroupRunStatus::Completed => "\u{2714}", // ✔
        GroupRunStatus::Failed => "\u{2718}",    // ✘
        GroupRunStatus::Cancelled => "\u{2298}", // ⊘
    }
}

/// Render a header line.
pub fn header(text: &str) -> String {
    let separator = "\u{2500}".repeat(text.len() + 4);
    format!("  {}  \n  {}", text, separator)
}

/// Render a group run's status table.
pub fn render_group_run_details(run: &GroupRun, experiments: &[GroupRunExperiment]) -> String {
    let status_icon = group_run_status_icon(run.status);
    let mode = match run.execution_mode {
        ExecutionMode::Sequential => "Sequential",
        ExecutionMode::Parallel => "Parallel",
    };

    let mut lines = vec![format!(
        "{} Group Run: {}     {}",
        status_icon, run.id, run.group_name
    )];

    if let Some(started) = &run.started_at {
        lines.push(format!("  Started: {}", started));
    }
    if let Some(completed) = &run.completed_at {
        lines.push(format!("  Completed: {}", completed));
    }
    lines.push(format!("  Mode: {} | Status: {:?}", mode, run.status));
    if let Some(summary) = &run.summary {
        lines.push(format!("  Summary: {}", summary));
    }

    lines.push(String::new());
    lines.push(format!(
        "  {:<5} {:<25} {:<10} {:<20}",
        "Sort", "Blueprint", "Status", "Duration"
    ));
    lines.push("  \u{2500}".repeat(65));

    for exp in experiments {
        let icon = run_experiment_status_icon(exp.status);
        let duration = match (&exp.started_at, &exp.completed_at) {
            (Some(_), Some(completed)) => format!("{}", completed),
            (Some(_), None) => "running...".to_owned(),
            (None, _) => "--".to_owned(),
        };
        let error_suffix = exp
            .error
            .as_ref()
            .map(|e| format!(" [{}]", e))
            .unwrap_or_default();
        lines.push(format!(
            "  {:<5} {:<25} {} {:<9} {:<20}{}",
            exp.sort_order + 1,
            exp.blueprint_name,
            icon,
            format!("{:?}", exp.status),
            duration,
            error_suffix,
        ));
    }

    lines.join("\n")
}

/// Render a compact list of recent group runs.
pub fn render_recent_group_runs(runs: &[GroupRun]) -> String {
    if runs.is_empty() {
        return "  (no runs yet)".to_owned();
    }

    let mut lines = vec![format!(
        "  {:<3} {:<12} {:<22} {:<12} {:40}",
        "#", "Run ID", "Date", "Status", "Summary"
    )];
    lines.push("  \u{2500}".repeat(90));

    for (i, run) in runs.iter().enumerate() {
        let icon = group_run_status_icon(run.status);
        let date = run
            .started_at
            .as_deref()
            .unwrap_or("--")
            .chars()
            .take(19)
            .collect::<String>();
        let summary = run.summary.as_deref().unwrap_or("--");
        lines.push(format!(
            "  {:<3} {:<12} {:<22} {} {:<11} {}",
            i + 1,
            &run.id[..run.id.len().min(10)],
            date,
            icon,
            format!("{:?}", run.status),
            summary,
        ));
    }

    lines.join("\n")
}
