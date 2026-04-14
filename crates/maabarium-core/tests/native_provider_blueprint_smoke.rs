use maabarium_core::blueprint::BlueprintFile;
use maabarium_core::llm::{CompletionRequest, provider_from_models};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use tempfile::TempDir;
use uuid::Uuid;

struct ScopedEnvVar {
    name: String,
}

impl ScopedEnvVar {
    fn set(name: String, value: &str) -> Self {
        unsafe {
            std::env::set_var(&name, value);
        }
        Self { name }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        unsafe {
            std::env::remove_var(&self.name);
        }
    }
}

fn write_blueprint(
    temp_dir: &Path,
    blueprint_name: &str,
    provider: &str,
    endpoint: &str,
    model_name: &str,
    api_key_env: &str,
) -> std::path::PathBuf {
    let blueprint_path = temp_dir.join(format!("{provider}-smoke.toml"));
    fs::write(
        &blueprint_path,
        format!(
            "[blueprint]\nname = \"{blueprint_name}\"\nversion = \"0.1.0\"\ndescription = \"Native provider smoke test\"\n\n[domain]\nrepo_path = \"{}\"\ntarget_files = [\"src/**/*.rs\"]\nlanguage = \"rust\"\n\n[constraints]\nmax_iterations = 1\ntimeout_seconds = 30\nrequire_tests_pass = false\nmin_improvement = 0.01\n\n[metrics]\nmetrics = [\n  {{ name = \"quality\", weight = 1.0, direction = \"maximize\", description = \"Overall quality\" }},\n]\n\n[agents]\ncouncil_size = 1\ndebate_rounds = 0\nagents = [\n  {{ name = \"smoke-agent\", role = \"tester\", system_prompt = \"You are a smoke test agent.\", model = \"{model_name}\" }},\n]\n\n[models]\nmodels = [\n  {{ name = \"{model_name}\", provider = \"{provider}\", endpoint = \"{endpoint}\", api_key_env = \"{api_key_env}\", temperature = 0.1, max_tokens = 64 }},\n]\n",
            temp_dir.display()
        ),
    )
    .expect("blueprint file should be written");
    blueprint_path
}

fn spawn_single_response_server(status_line: &str, body: &str) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let address = listener.local_addr().expect("local addr should resolve");
    let body_bytes = body.as_bytes().to_vec();
    let status_line = status_line.to_owned();
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("request should arrive");
        let mut buffer = [0_u8; 4096];
        let bytes_read = stream.read(&mut buffer).expect("request should be readable");
        tx.send(String::from_utf8_lossy(&buffer[..bytes_read]).into_owned())
            .expect("request payload should send back to test");
        let response = format!(
            "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body_bytes.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("response head should write");
        stream
            .write_all(&body_bytes)
            .expect("response body should write");
    });

    (format!("http://{address}"), rx)
}

#[tokio::test]
async fn anthropic_blueprint_model_loads_and_completes_without_live_api() {
    let temp_dir = TempDir::new().expect("temp dir should be created");
    let env_var_name = format!("TEST_ANTHROPIC_BLUEPRINT_KEY_{}", Uuid::new_v4().simple());
    let _api_key = ScopedEnvVar::set(env_var_name.clone(), "anthropic-test-key");
    let (endpoint, request_rx) = spawn_single_response_server(
        "200 OK",
        r#"{"content":[{"type":"text","text":"OK"}],"usage":{"input_tokens":2,"output_tokens":1}}"#,
    );
    let blueprint_path = write_blueprint(
        temp_dir.path(),
        "anthropic-smoke",
        "anthropic",
        &endpoint,
        "claude-sonnet-4-5",
        &env_var_name,
    );

    let blueprint = BlueprintFile::load(&blueprint_path).expect("blueprint should load");
    let provider = provider_from_models(&blueprint.models, Some("claude-sonnet-4-5"))
        .expect("provider should resolve from blueprint models");
    let response = provider
        .complete(&CompletionRequest {
            system: "Reply with OK.".to_owned(),
            prompt: "Say OK".to_owned(),
            temperature: 0.0,
            max_tokens: 8,
            response_format: None,
        })
        .await
        .expect("anthropic completion should succeed");

    let request = request_rx.recv().expect("request should be captured");
    assert!(request.contains("POST /v1/messages HTTP/1.1"));
    assert!(request.contains("x-api-key: anthropic-test-key"));
    assert!(request.contains("anthropic-version: 2023-06-01"));
    assert_eq!(response.content, "OK");
}

#[tokio::test]
async fn gemini_blueprint_model_loads_and_completes_without_live_api() {
    let temp_dir = TempDir::new().expect("temp dir should be created");
    let env_var_name = format!("TEST_GEMINI_BLUEPRINT_KEY_{}", Uuid::new_v4().simple());
    let _api_key = ScopedEnvVar::set(env_var_name.clone(), "gemini-test-key");
    let (endpoint, request_rx) = spawn_single_response_server(
        "200 OK",
        r#"{"candidates":[{"content":{"parts":[{"text":"OK"}]}}],"usageMetadata":{"totalTokenCount":4}}"#,
    );
    let blueprint_path = write_blueprint(
        temp_dir.path(),
        "gemini-smoke",
        "gemini",
        &endpoint,
        "gemini-2.5-flash",
        &env_var_name,
    );

    let blueprint = BlueprintFile::load(&blueprint_path).expect("blueprint should load");
    let provider = provider_from_models(&blueprint.models, Some("gemini-2.5-flash"))
        .expect("provider should resolve from blueprint models");
    let response = provider
        .complete(&CompletionRequest {
            system: "Reply with OK.".to_owned(),
            prompt: "Say OK".to_owned(),
            temperature: 0.0,
            max_tokens: 8,
            response_format: None,
        })
        .await
        .expect("gemini completion should succeed");

    let request = request_rx.recv().expect("request should be captured");
    assert!(
        request.contains("POST /v1beta/models/gemini-2.5-flash:generateContent HTTP/1.1")
    );
    assert!(request.contains("x-goog-api-key: gemini-test-key"));
    assert_eq!(response.content, "OK");
}