#[cfg(unix)]
mod tests {
    use maabarium_core::git_manager::{FilePatch, FilePatchOperation, Proposal};
    use maabarium_core::{BlueprintFile, EvaluationContext, EvaluatorRegistry};
    use std::path::PathBuf;

    fn fixture_directory() -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let current_dir = std::env::current_dir().expect("current directory should be available");
        let candidates = [
            manifest_dir
                .join("tests")
                .join("fixtures")
                .join("process-plugin"),
            manifest_dir
                .join("crates")
                .join("maabarium-core")
                .join("tests")
                .join("fixtures")
                .join("process-plugin"),
            current_dir
                .join("tests")
                .join("fixtures")
                .join("process-plugin"),
            current_dir
                .join("crates")
                .join("maabarium-core")
                .join("tests")
                .join("fixtures")
                .join("process-plugin"),
        ];

        candidates
            .into_iter()
            .find(|candidate| candidate.exists())
            .expect("process plugin fixture directory should exist")
    }

    #[tokio::test]
    async fn process_plugin_fixture_runs_end_to_end() {
        let fixture_directory = fixture_directory();
        let blueprint_path = fixture_directory.join("blueprint.toml");
        let mut blueprint = BlueprintFile::load(&blueprint_path)
            .expect("fixture blueprint should load successfully");
        blueprint.domain.repo_path = fixture_directory.display().to_string();

        let evaluator = EvaluatorRegistry::build(&blueprint)
            .expect("process plugin blueprint should resolve to a runnable evaluator");
        let proposal = Proposal {
            summary: "Improve plugin runtime diagnostics".to_owned(),
            file_patches: vec![FilePatch {
                path: "src/lib.rs".to_owned(),
                operation: FilePatchOperation::Modify,
                content: Some("pub fn plugin_fixture() {}\n".to_owned()),
            }],
        };

        let result = evaluator
            .evaluate(&proposal, 1, &EvaluationContext::default())
            .await
            .expect("fixture plugin should return a valid evaluation response");

        assert_eq!(result.iteration, 1);
        assert!((result.weighted_total - 0.87).abs() < f64::EPSILON);
        assert_eq!(result.duration_ms, 42);
        assert_eq!(result.scores.len(), 1);
        assert_eq!(result.scores[0].name, "quality");
        assert!((result.scores[0].value - 0.87).abs() < f64::EPSILON);

        let research = result
            .research
            .expect("fixture plugin should return research artifacts");
        assert_eq!(research.sources.len(), 1);
        assert_eq!(research.citations.len(), 1);
        assert_eq!(research.query_traces.len(), 1);
        assert_eq!(research.query_traces[0].provider, "brave");
        assert_eq!(
            research.query_traces[0].query_text,
            "maabarium plugin evaluator"
        );
        assert_eq!(research.query_traces[0].top_urls.len(), 2);
    }
}
