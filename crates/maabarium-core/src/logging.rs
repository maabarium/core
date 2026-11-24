use std::path::{Path, PathBuf};

pub fn default_log_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/maabarium.log")
}

/// The installed CLI's per-user log, independent of the build and current directories.
pub fn cli_log_path() -> Option<PathBuf> {
    fn absolute_env(name: &str) -> Option<PathBuf> {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    }

    #[cfg(target_os = "macos")]
    let directory = absolute_env("HOME")?.join("Library/Logs/com.maabarium.cli");

    #[cfg(target_os = "windows")]
    let directory = absolute_env("LOCALAPPDATA")
        .or_else(|| absolute_env("USERPROFILE").map(|home| home.join("AppData/Local")))?
        .join("Maabarium CLI/Logs");

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let directory = absolute_env("XDG_STATE_HOME")
        .or_else(|| absolute_env("HOME").map(|home| home.join(".local/state")))?
        .join("maabarium/cli");

    Some(directory.join("maabarium.log"))
}

pub fn read_recent_log_lines(max_lines: usize) -> std::io::Result<Vec<String>> {
    read_recent_log_lines_from_path(&default_log_path(), max_lines)
}

pub fn read_recent_log_lines_from_path(
    path: &Path,
    max_lines: usize,
) -> std::io::Result<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(path)?;
    let mut lines = content
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if lines.len() > max_lines {
        lines.drain(0..(lines.len() - max_lines));
    }

    Ok(lines)
}
