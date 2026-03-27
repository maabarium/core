use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    if let Err(error) = prepare_bundled_cli() {
        panic!("failed to prepare bundled CLI resource: {error}");
    }

    if let Err(error) = configure_embedded_updater_pubkey() {
        panic!("failed to configure embedded updater public key: {error}");
    }

    if let Err(error) = configure_embedded_updater_endpoint() {
        panic!("failed to configure embedded updater endpoint: {error}");
    }

    tauri_build::build()
}

fn configure_embedded_updater_pubkey() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed=MAABARIUM_UPDATE_PUBKEY");
    println!("cargo:rerun-if-env-changed=MAABARIUM_UPDATE_PUBKEY_FILE");

    let env_pubkey = env::var("MAABARIUM_UPDATE_PUBKEY")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());

    let file_pubkey = env::var("MAABARIUM_UPDATE_PUBKEY_FILE")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(|path| {
            let file_path = PathBuf::from(&path);
            println!("cargo:rerun-if-changed={}", file_path.display());
            fs::read_to_string(&file_path)
                .map_err(|error| format!("failed to read {}: {error}", file_path.display()))
                .map(|value| value.trim().to_owned())
        })
        .transpose()?;

    if let Some(pubkey) = env_pubkey.or(file_pubkey).filter(|value| !value.is_empty()) {
        println!("cargo:rustc-env=MAABARIUM_COMPILED_UPDATE_PUBKEY={pubkey}");
    }

    Ok(())
}

fn configure_embedded_updater_endpoint() -> Result<(), String> {
    println!("cargo:rerun-if-env-changed=MAABARIUM_UPDATE_MANIFEST_URL");
    println!("cargo:rerun-if-env-changed=MAABARIUM_UPDATE_BASE_URL");
    println!("cargo:rerun-if-env-changed=MAABARIUM_UPDATE_CHANNEL");

    if let Some(manifest_url) = env::var("MAABARIUM_UPDATE_MANIFEST_URL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        println!("cargo:rustc-env=MAABARIUM_COMPILED_UPDATE_MANIFEST_URL={manifest_url}");
    }

    if let Some(base_url) = env::var("MAABARIUM_UPDATE_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
    {
        println!("cargo:rustc-env=MAABARIUM_COMPILED_UPDATE_BASE_URL={base_url}");
    }

    if let Some(channel) = env::var("MAABARIUM_UPDATE_CHANNEL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        println!("cargo:rustc-env=MAABARIUM_COMPILED_UPDATE_CHANNEL={channel}");
    }

    Ok(())
}

fn prepare_bundled_cli() -> Result<(), String> {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|error| error.to_string())?);
    let generated_cli_dir = manifest_dir.join("generated-resources").join("cli");
    fs::create_dir_all(&generated_cli_dir).map_err(|error| error.to_string())?;

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_owned());
    if profile != "release" && env::var_os("MAABARIUM_BUNDLE_CLI_IN_DEV").is_none() {
        return Ok(());
    }

    if generated_cli_dir.exists() {
        fs::remove_dir_all(&generated_cli_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&generated_cli_dir).map_err(|error| error.to_string())?;

    let workspace_root = manifest_dir.join("../..");
    let cli_manifest_path = workspace_root.join("crates/maabarium-cli/Cargo.toml");
    let bundled_target_dir = workspace_root.join("target/cli-bundle");
    let target = env::var("TARGET").map_err(|error| error.to_string())?;
    let resource_platform_key = bundled_cli_platform_key(&target);
    let cargo = env::var("CARGO").map_err(|error| error.to_string())?;

    let mut command = Command::new(cargo);
    command
        .current_dir(&workspace_root)
        .env("CARGO_TARGET_DIR", &bundled_target_dir)
        .arg("build")
        .arg("--manifest-path")
        .arg(&cli_manifest_path)
        .arg("--target")
        .arg(&target);
    if profile == "release" {
        command.arg("--release");
    }

    let status = command.status().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!(
            "building maabarium-cli for bundling exited with status {status}"
        ));
    }

    let binary_name = cli_binary_name();
    let built_binary = bundled_target_dir
        .join(&target)
        .join(&profile)
        .join(binary_name);
    if !built_binary.exists() {
        return Err(format!(
            "expected bundled CLI binary at {}",
            built_binary.display()
        ));
    }

    let destination_dir = generated_cli_dir.join(&resource_platform_key);
    fs::create_dir_all(&destination_dir).map_err(|error| error.to_string())?;
    let destination = destination_dir.join(binary_name);
    fs::copy(&built_binary, &destination).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&destination)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&destination, permissions).map_err(|error| error.to_string())?;
    }

    println!(
        "cargo:rerun-if-changed={}",
        Path::new(&workspace_root)
            .join("crates/maabarium-cli/src/main.rs")
            .display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        Path::new(&workspace_root)
            .join("crates/maabarium-cli/Cargo.toml")
            .display()
    );
    Ok(())
}

fn cli_binary_name() -> &'static str {
    if cfg!(windows) {
        "maabarium.exe"
    } else {
        "maabarium"
    }
}

fn bundled_cli_platform_key(target: &str) -> String {
    let os = if target.contains("apple-darwin") {
        "darwin"
    } else if target.contains("windows") {
        "windows"
    } else if target.contains("linux") {
        "linux"
    } else {
        target
    };

    let arch = if target.starts_with("aarch64") {
        "aarch64"
    } else if target.starts_with("x86_64") {
        "x86_64"
    } else if target.starts_with("i686") || target.starts_with("x86") {
        "i686"
    } else {
        target
    };

    format!("{os}-{arch}")
}
