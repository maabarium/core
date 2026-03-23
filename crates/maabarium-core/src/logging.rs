use std::path::{Path, PathBuf};

pub fn default_log_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/maabarium.log")
}

pub fn read_recent_log_lines(max_lines: usize) -> std::io::Result<Vec<String>> {
    read_recent_log_lines_from_path(&default_log_path(), max_lines)
}

pub fn read_recent_log_lines_from_path(path: &Path, max_lines: usize) -> std::io::Result<Vec<String>> {
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
