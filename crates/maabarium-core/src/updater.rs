use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use tar::Archive;

use crate::error::UpdaterError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub version: String,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub minimum_supported_version: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub migration_notice: Option<String>,
    #[serde(default)]
    pub cli: Option<CliArtifactManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliArtifactManifest {
    pub artifacts: BTreeMap<String, CliReleaseArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliReleaseArtifact {
    pub url: String,
    pub sha256: String,
    #[serde(default = "default_archive_kind")]
    pub archive_kind: String,
    #[serde(default = "default_binary_name")]
    pub binary_name: String,
}

#[derive(Debug, Clone)]
pub struct UpdaterConfiguration {
    pub channel: String,
    pub manifest_url: String,
}

#[derive(Debug, Clone)]
pub struct CliUpdatePlan {
    pub manifest: ReleaseManifest,
    pub artifact: CliReleaseArtifact,
    pub platform_key: String,
}

impl UpdaterConfiguration {
    pub fn from_env() -> Result<Self, UpdaterError> {
        let channel = std::env::var("MAABARIUM_UPDATE_CHANNEL")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "stable".to_owned());

        if let Ok(manifest_url) = std::env::var("MAABARIUM_UPDATE_MANIFEST_URL") {
            let manifest_url = manifest_url.trim().to_owned();
            if !manifest_url.is_empty() {
                return Ok(Self {
                    channel,
                    manifest_url,
                });
            }
        }

        let base_url = std::env::var("MAABARIUM_UPDATE_BASE_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_owned())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| UpdaterError::InvalidManifest("Set MAABARIUM_UPDATE_MANIFEST_URL or MAABARIUM_UPDATE_BASE_URL to enable CLI updates".to_owned()))?;

        Ok(Self {
            channel: channel.clone(),
            manifest_url: format!("{base_url}/{channel}/latest.json"),
        })
    }
}

pub async fn fetch_release_manifest(url: &str) -> Result<ReleaseManifest, UpdaterError> {
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    Ok(response.json::<ReleaseManifest>().await?)
}

pub async fn check_for_cli_update(
    current_version: &str,
    config: &UpdaterConfiguration,
) -> Result<Option<CliUpdatePlan>, UpdaterError> {
    let manifest = fetch_release_manifest(&config.manifest_url).await?;
    let platform_key = current_platform_key()?;
    let artifact = manifest
        .cli
        .as_ref()
        .and_then(|cli| cli.artifacts.get(&platform_key))
        .cloned()
        .ok_or_else(|| {
            UpdaterError::InvalidManifest(format!(
                "Release manifest does not include a CLI artifact for platform '{platform_key}'"
            ))
        })?;

    if let Some(minimum_supported_version) = manifest.minimum_supported_version.as_deref() {
        if version_less_than(current_version, minimum_supported_version) {
            return Err(UpdaterError::InvalidManifest(format!(
                "Current CLI version {current_version} is older than the minimum supported version {minimum_supported_version}"
            )));
        }
    }

    if !version_less_than(current_version, &manifest.version) {
        return Ok(None);
    }

    Ok(Some(CliUpdatePlan {
        manifest,
        artifact,
        platform_key,
    }))
}

pub async fn install_cli_update(
    executable_path: &Path,
    artifact: &CliReleaseArtifact,
) -> Result<(), UpdaterError> {
    #[cfg(target_os = "windows")]
    {
        let _ = executable_path;
        let _ = artifact;
        return Err(UpdaterError::UnsupportedInPlaceUpdate);
    }

    let bytes = reqwest::Client::new()
        .get(&artifact.url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    let checksum = sha256_hex(bytes.as_ref());
    if checksum != artifact.sha256.to_ascii_lowercase() {
        return Err(UpdaterError::ChecksumMismatch {
            artifact: artifact.url.clone(),
        });
    }

    let extracted_binary = extract_cli_binary(bytes.as_ref(), artifact)?;
    let executable_parent = executable_path.parent().ok_or_else(|| {
        UpdaterError::InvalidManifest(
            "CLI executable path is missing a parent directory".to_owned(),
        )
    })?;
    let temp_path = executable_parent.join(format!("{}.download", artifact.binary_name));
    fs::write(&temp_path, extracted_binary)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&temp_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&temp_path, permissions)?;
    }

    let backup_path = executable_parent.join(format!("{}.backup", artifact.binary_name));
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    fs::rename(executable_path, &backup_path)?;
    if let Err(error) = fs::rename(&temp_path, executable_path) {
        let _ = fs::rename(&backup_path, executable_path);
        let _ = fs::remove_file(&temp_path);
        return Err(UpdaterError::Io(error));
    }

    let _ = fs::remove_file(&backup_path);
    Ok(())
}

pub fn current_platform_key() -> Result<String, UpdaterError> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        other => return Err(UpdaterError::UnsupportedPlatform(other.to_owned())),
    };

    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        "x86" => "i686",
        other => return Err(UpdaterError::UnsupportedPlatform(other.to_owned())),
    };

    Ok(format!("{os}-{arch}"))
}

fn extract_cli_binary(
    bytes: &[u8],
    artifact: &CliReleaseArtifact,
) -> Result<Vec<u8>, UpdaterError> {
    match artifact.archive_kind.as_str() {
        "tar.gz" => extract_from_tar_gz(bytes, &artifact.binary_name),
        other => Err(UpdaterError::InvalidManifest(format!(
            "Unsupported CLI archive kind '{other}'"
        ))),
    }
}

fn extract_from_tar_gz(bytes: &[u8], binary_name: &str) -> Result<Vec<u8>, UpdaterError> {
    let decoder = GzDecoder::new(bytes);
    let mut archive = Archive::new(decoder);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        if path.file_name().and_then(|value| value.to_str()) == Some(binary_name) {
            let mut output = Vec::new();
            entry.read_to_end(&mut output)?;
            return Ok(output);
        }
    }

    Err(UpdaterError::InvalidManifest(format!(
        "Archive did not contain expected CLI binary '{binary_name}'"
    )))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn version_less_than(current: &str, candidate: &str) -> bool {
    parse_version(current) < parse_version(candidate)
}

fn parse_version(value: &str) -> Vec<u64> {
    value
        .trim_start_matches('v')
        .split(['.', '-'])
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn default_archive_kind() -> String {
    "tar.gz".to_owned()
}

fn default_binary_name() -> String {
    if cfg!(windows) {
        "maabarium.exe".to_owned()
    } else {
        "maabarium".to_owned()
    }
}
