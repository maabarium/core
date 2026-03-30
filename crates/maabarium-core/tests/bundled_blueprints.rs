use maabarium_core::BlueprintFile;
use std::path::PathBuf;

#[test]
fn bundled_blueprints_load_successfully() {
    let blueprint_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../blueprints");
    let blueprint_files = [
        "code-quality.toml",
        "example.toml",
        "general-research.toml",
        "lora-adapter.toml",
        "product-builder.toml",
        "prompt-improvement.toml",
    ];

    for file_name in blueprint_files {
        let blueprint_path = blueprint_directory.join(file_name);
        BlueprintFile::load(&blueprint_path).unwrap_or_else(|error| {
            panic!(
                "bundled blueprint {} should load successfully: {}",
                blueprint_path.display(),
                error
            )
        });
    }
}