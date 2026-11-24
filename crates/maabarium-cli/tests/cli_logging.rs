use std::path::PathBuf;
use std::process::{Command, Output};

struct IsolatedHome(PathBuf);

impl IsolatedHome {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("maabarium-cli-log-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_maabarium"))
            .args(args)
            .env("HOME", &self.0)
            .env("USERPROFILE", &self.0)
            .env_remove("XDG_STATE_HOME")
            .env_remove("LOCALAPPDATA")
            .current_dir(&self.0)
            .output()
            .unwrap()
    }

    fn log(&self) -> PathBuf {
        self.0.join(if cfg!(target_os = "macos") {
            "Library/Logs/com.maabarium.cli/maabarium.log"
        } else if cfg!(target_os = "windows") {
            "AppData/Local/Maabarium CLI/Logs/maabarium.log"
        } else {
            ".local/state/maabarium/cli/maabarium.log"
        })
    }
}

impl Drop for IsolatedHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn help_does_not_initialize_logging() {
    let home = IsolatedHome::new();
    let output = home.run(&["--help"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Usage:"));
    assert!(output.stderr.is_empty());
    assert!(!home.log().exists());
}

#[test]
fn installed_cli_logs_under_home_without_polluting_stdout() {
    let home = IsolatedHome::new();
    let output = home.run(&["self", "version"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("maabarium "));
    let log = std::fs::read_to_string(home.log()).unwrap();
    assert!(log.contains("Tracing initialized"));
}

#[test]
fn unusable_log_file_does_not_block_the_command() {
    let home = IsolatedHome::new();
    std::fs::create_dir_all(home.log()).unwrap();
    let output = home.run(&["self", "version"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("maabarium "));
    assert!(String::from_utf8_lossy(&output.stderr).contains("using stderr"));
}
