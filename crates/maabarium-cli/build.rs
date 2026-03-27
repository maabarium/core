use std::env;

fn main() {
    if let Err(error) = configure_embedded_updater_endpoint() {
        panic!("failed to configure embedded CLI updater endpoint: {error}");
    }
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