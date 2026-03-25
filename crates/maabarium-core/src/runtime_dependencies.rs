#[cfg(target_os = "windows")]
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitInstallerKind {
    Homebrew,
    XcodeCommandLineTools,
    Apt,
    Dnf,
    Yum,
    Pacman,
    Zypper,
    Winget,
    Chocolatey,
}

impl GitInstallerKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Homebrew => "Homebrew",
            Self::XcodeCommandLineTools => "Xcode Command Line Tools",
            Self::Apt => "apt-get",
            Self::Dnf => "dnf",
            Self::Yum => "yum",
            Self::Pacman => "pacman",
            Self::Zypper => "zypper",
            Self::Winget => "winget",
            Self::Chocolatey => "Chocolatey",
        }
    }

    pub fn command_line(self) -> &'static str {
        match self {
            Self::Homebrew => "brew install git",
            Self::XcodeCommandLineTools => "xcode-select --install",
            Self::Apt => "sudo apt-get update && sudo apt-get install -y git",
            Self::Dnf => "sudo dnf install -y git",
            Self::Yum => "sudo yum install -y git",
            Self::Pacman => "sudo pacman -Sy --noconfirm git",
            Self::Zypper => "sudo zypper --non-interactive install git",
            Self::Winget => "winget install --id Git.Git -e --source winget",
            Self::Chocolatey => "choco install git -y",
        }
    }

    fn command_and_args(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Homebrew => ("brew", &["install", "git"]),
            Self::XcodeCommandLineTools => ("xcode-select", &["--install"]),
            Self::Apt => ("sudo", &["apt-get", "update"]),
            Self::Dnf => ("sudo", &["dnf", "install", "-y", "git"]),
            Self::Yum => ("sudo", &["yum", "install", "-y", "git"]),
            Self::Pacman => ("sudo", &["pacman", "-Sy", "--noconfirm", "git"]),
            Self::Zypper => (
                "sudo",
                &["zypper", "--non-interactive", "install", "git"],
            ),
            Self::Winget => (
                "winget",
                &["install", "--id", "Git.Git", "-e", "--source", "winget"],
            ),
            Self::Chocolatey => ("choco", &["install", "git", "-y"]),
        }
    }

    fn follow_up_message(self) -> &'static str {
        match self {
            Self::XcodeCommandLineTools => {
                "Git is still unavailable. Maabarium started the Xcode Command Line Tools installer because Git is required. Finish that installer, then retry the command or restart the desktop app."
            }
            _ => "Git is still unavailable after the automatic installation attempt. Retry once the package manager finishes, then start Maabarium again.",
        }
    }

    fn post_install_command(self) -> Option<(&'static str, &'static [&'static str])> {
        match self {
            Self::Apt => Some(("sudo", &["apt-get", "install", "-y", "git"])),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDependencyStatus {
    pub installed: bool,
    pub command_path: Option<PathBuf>,
    pub auto_install_supported: bool,
    pub installer: Option<GitInstallerKind>,
    pub install_command: Option<String>,
    pub status_detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitDependencyEnsureOutcome {
    AlreadyInstalled,
    Installed { installer: GitInstallerKind },
    InstallationStarted {
        installer: GitInstallerKind,
        message: String,
    },
}

pub fn git_dependency_status() -> GitDependencyStatus {
    git_dependency_status_with_runtime(&SystemRuntime)
}

pub fn ensure_git_dependency() -> Result<GitDependencyEnsureOutcome, String> {
    ensure_git_dependency_with_runtime(&SystemRuntime)
}

fn git_dependency_status_with_runtime(runtime: &impl GitDependencyRuntime) -> GitDependencyStatus {
    build_git_dependency_status(runtime.find_command("git"), detect_git_installer(runtime))
}

fn ensure_git_dependency_with_runtime(
    runtime: &impl GitDependencyRuntime,
) -> Result<GitDependencyEnsureOutcome, String> {
    if runtime.find_command("git").is_some() {
        return Ok(GitDependencyEnsureOutcome::AlreadyInstalled);
    }

    let installer = detect_git_installer(runtime).ok_or_else(|| {
        "Git is required for Maabarium's isolated worktree flow, but no supported automatic installer was found on this machine.".to_owned()
    })?;

    run_installer(runtime, installer)?;

    if runtime.find_command("git").is_some() {
        return Ok(GitDependencyEnsureOutcome::Installed { installer });
    }

    Ok(GitDependencyEnsureOutcome::InstallationStarted {
        installer,
        message: installer.follow_up_message().to_owned(),
    })
}

fn build_git_dependency_status(
    command_path: Option<PathBuf>,
    installer: Option<GitInstallerKind>,
) -> GitDependencyStatus {
    let installed = command_path.is_some();
    let auto_install_supported = installer.is_some();
    let install_command = installer.map(|value| value.command_line().to_owned());
    let status_detail = if installed {
        "Git is installed and ready for isolated worktree operations.".to_owned()
    } else if let Some(installer_kind) = installer {
        format!(
            "Git is missing. Maabarium can install it automatically via {}.",
            installer_kind.label()
        )
    } else {
        "Git is missing and no supported automatic installer was found on this machine. Install Git manually before running Maabarium workflows."
            .to_owned()
    };

    GitDependencyStatus {
        installed,
        command_path,
        auto_install_supported,
        installer,
        install_command,
        status_detail,
    }
}

fn detect_git_installer(runtime: &impl GitDependencyRuntime) -> Option<GitInstallerKind> {
    if cfg!(target_os = "macos") {
        if runtime.find_command("brew").is_some() {
            return Some(GitInstallerKind::Homebrew);
        }
        if runtime.find_command("xcode-select").is_some() {
            return Some(GitInstallerKind::XcodeCommandLineTools);
        }
        return None;
    }

    if cfg!(target_os = "windows") {
        if runtime.find_command("winget").is_some() {
            return Some(GitInstallerKind::Winget);
        }
        if runtime.find_command("choco").is_some() {
            return Some(GitInstallerKind::Chocolatey);
        }
        return None;
    }

    for (command, installer) in [
        ("apt-get", GitInstallerKind::Apt),
        ("dnf", GitInstallerKind::Dnf),
        ("yum", GitInstallerKind::Yum),
        ("pacman", GitInstallerKind::Pacman),
        ("zypper", GitInstallerKind::Zypper),
    ] {
        if runtime.find_command(command).is_some() {
            return Some(installer);
        }
    }

    None
}

fn run_installer(runtime: &impl GitDependencyRuntime, installer: GitInstallerKind) -> Result<(), String> {
    let (command_name, args) = installer.command_and_args();
    let command_path = runtime.find_command(command_name).ok_or_else(|| {
        format!(
            "Git is missing and Maabarium could not find the {} command needed for automatic installation.",
            installer.label()
        )
    })?;

    runtime.run_command(&command_path, args).map_err(|error| {
        format!(
            "Git is missing. Maabarium attempted automatic installation with {} ({}), but it failed: {error}",
            installer.label(),
            installer.command_line(),
        )
    })?;

    if let Some((command_name, args)) = installer.post_install_command() {
        let command_path = runtime.find_command(command_name).ok_or_else(|| {
            format!(
                "Git installation was partially started, but Maabarium could not find the {} command required to finish it.",
                command_name
            )
        })?;
        runtime.run_command(&command_path, args).map_err(|error| {
            format!(
                "Git installation started, but the follow-up command '{}' failed: {error}",
                [command_name, &args.join(" ")].join(" ")
            )
        })?;
    }

    Ok(())
}

trait GitDependencyRuntime {
    fn find_command(&self, name: &str) -> Option<PathBuf>;
    fn run_command(&self, command_path: &Path, args: &[&str]) -> Result<(), String>;
}

struct SystemRuntime;

impl GitDependencyRuntime for SystemRuntime {
    fn find_command(&self, name: &str) -> Option<PathBuf> {
        find_command(name)
    }

    fn run_command(&self, command_path: &Path, args: &[&str]) -> Result<(), String> {
        let status = Command::new(command_path)
            .args(args)
            .status()
            .map_err(|error| {
                format!(
                    "failed to launch '{}': {error}",
                    [command_path.display().to_string(), args.join(" ")].join(" ")
                )
            })?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("exited with status {status}"))
        }
    }
}

fn find_command(name: &str) -> Option<PathBuf> {
    let path_value = std::env::var_os("PATH")?;
    std::env::split_paths(&path_value)
        .find_map(|directory| find_command_in_directory(&directory, name))
}

fn find_command_in_directory(directory: &Path, name: &str) -> Option<PathBuf> {
    let direct_candidate = directory.join(name);
    if direct_candidate.is_file() {
        return Some(direct_candidate);
    }

    #[cfg(target_os = "windows")]
    {
        let pathext = std::env::var_os("PATHEXT")
            .unwrap_or_else(|| OsString::from(".EXE;.CMD;.BAT;.COM"));
        let extensions = pathext
            .to_string_lossy()
            .split(';')
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        for extension in extensions {
            let candidate = directory.join(format!("{name}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeSet;

    fn test_installer_fixture() -> (Vec<&'static str>, GitInstallerKind, &'static str) {
        #[cfg(target_os = "macos")]
        {
            return (
                vec!["brew"],
                GitInstallerKind::Homebrew,
                "brew install git",
            );
        }

        #[cfg(target_os = "windows")]
        {
            return (
                vec!["winget"],
                GitInstallerKind::Winget,
                "winget install --id Git.Git -e --source winget",
            );
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            return (
                vec!["apt-get", "sudo"],
                GitInstallerKind::Apt,
                "sudo apt-get install -y git",
            );
        }
    }

    struct MockRuntime {
        commands: RefCell<BTreeSet<String>>,
        executions: RefCell<Vec<String>>,
        install_git_after: Option<String>,
        failure: Option<String>,
    }

    impl MockRuntime {
        fn new(commands: &[&str]) -> Self {
            Self {
                commands: RefCell::new(commands.iter().map(|value| (*value).to_owned()).collect()),
                executions: RefCell::new(Vec::new()),
                install_git_after: None,
                failure: None,
            }
        }

        fn with_install_git_after(mut self, command: &str) -> Self {
            self.install_git_after = Some(command.to_owned());
            self
        }

        fn with_failure(mut self, message: &str) -> Self {
            self.failure = Some(message.to_owned());
            self
        }
    }

    impl GitDependencyRuntime for MockRuntime {
        fn find_command(&self, name: &str) -> Option<PathBuf> {
            self.commands
                .borrow()
                .contains(name)
                .then(|| PathBuf::from(format!("/mock/{name}")))
        }

        fn run_command(&self, command_path: &Path, args: &[&str]) -> Result<(), String> {
            let invocation = [
                command_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default(),
                &args.join(" "),
            ]
            .join(" ")
            .trim()
            .to_owned();
            self.executions.borrow_mut().push(invocation.clone());

            if let Some(message) = self.failure.as_ref() {
                return Err(message.clone());
            }

            if self.install_git_after.as_deref() == Some(invocation.as_str()) {
                self.commands.borrow_mut().insert("git".to_owned());
            }

            Ok(())
        }
    }

    #[test]
    fn installed_status_reports_ready() {
        let status = build_git_dependency_status(
            Some(PathBuf::from("/usr/bin/git")),
            Some(GitInstallerKind::Homebrew),
        );

        assert!(status.installed);
        assert!(status.auto_install_supported);
        assert_eq!(
            status.status_detail,
            "Git is installed and ready for isolated worktree operations."
        );
    }

    #[test]
    fn missing_status_reports_installer() {
        let status = build_git_dependency_status(None, Some(GitInstallerKind::Homebrew));

        assert!(!status.installed);
        assert_eq!(status.install_command.as_deref(), Some("brew install git"));
        assert!(status.status_detail.contains("Homebrew"));
    }

    #[test]
    fn ensure_git_dependency_reports_successful_install() {
        let (commands, installer, install_git_after) = test_installer_fixture();
        let runtime = MockRuntime::new(&commands).with_install_git_after(install_git_after);

        let outcome = ensure_git_dependency_with_runtime(&runtime).expect("install should succeed");

        assert_eq!(
            outcome,
            GitDependencyEnsureOutcome::Installed { installer }
        );
        assert!(runtime.find_command("git").is_some());
    }

    #[test]
    fn ensure_git_dependency_surfaces_installer_failure() {
        let (commands, installer, _) = test_installer_fixture();
        let runtime = MockRuntime::new(&commands).with_failure("permission denied");

        let error = ensure_git_dependency_with_runtime(&runtime).expect_err("install should fail");

        assert!(error.contains("permission denied"));
        assert!(error.contains(installer.label()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ensure_git_dependency_reports_follow_up_for_xcode_command_line_tools() {
        let runtime = MockRuntime::new(&["xcode-select"]);

        let outcome = ensure_git_dependency_with_runtime(&runtime)
            .expect("xcode-select path should produce a follow-up outcome");

        assert_eq!(
            outcome,
            GitDependencyEnsureOutcome::InstallationStarted {
                installer: GitInstallerKind::XcodeCommandLineTools,
                message: GitInstallerKind::XcodeCommandLineTools
                    .follow_up_message()
                    .to_owned(),
            }
        );
        assert_eq!(
            runtime.executions.borrow().as_slice(),
            ["xcode-select --install"]
        );
    }
}