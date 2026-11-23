use rusqlite::Connection;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::Path;

#[tauri::command]
pub(crate) async fn research_subscription_check(lane: String) -> Result<String, String> {
    if lane == "deepseek" {
        if !cfg!(target_os = "macos") {
            return Err("The paid DeepSeek lane needs macOS Keychain.".into());
        }
        let status = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::process::Command::new("/usr/bin/security")
                .args([
                    "find-generic-password",
                    "-s",
                    "maabarium.deepseek",
                    "-a",
                    "api",
                ])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true)
                .status(),
        )
        .await
        .map_err(|_| "Keychain check timed out.")?
        .map_err(|_| "Could not check Keychain.")?;
        return Ok(if status.success() {
            "API key entry found. Account balance and worker access have not been checked."
        } else {
            "No accessible DeepSeek key entry. Follow the Keychain setup steps."
        }
        .into());
    }
    let cli = match lane.as_str() {
        "codex" => "codex",
        "claude" => "claude",
        "antigravity" => "agy",
        "muse" => "muse",
        _ => return Err("Unknown subscription lane".into()),
    };
    let home = std::env::var_os("HOME").ok_or("Home directory unavailable")?;
    let home = std::path::PathBuf::from(home);
    let installed = [
        home.join(".local/bin").join(cli),
        std::path::PathBuf::from("/opt/homebrew/bin").join(cli),
        std::path::PathBuf::from("/usr/local/bin").join(cli),
        std::path::PathBuf::from("/usr/bin").join(cli),
        std::path::PathBuf::from(
            "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS",
        )
        .join(cli),
    ]
    .into_iter()
    .find(|p| p.is_file());
    let Some(binary) = installed else {
        return Ok(format!("{cli} was not found in standard locations. Install the official client or follow the manual setup below."));
    };
    if cli == "muse" {
        return muse_account_status(&binary, &home).await;
    }
    let (args, positive) = match lane.as_str() {
        "codex" => (&["-c", "forced_login_method=\"chatgpt\"", "-c", "model_provider=\"openai\"", "login", "status"][..], "ChatGPT login verified. Launch-agent status is not checked."),
        "claude" => (&["auth", "status"][..], "Claude CLI reports account login. Verify Usage credits are off before opting into the local worker."),
        _ => return Ok(format!("{cli} found. Verify account credit overages are off before opting into the local worker.")),
    };
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .current_dir("/")
        .env_clear()
        .env("HOME", home)
        .kill_on_drop(true);
    if cli == "codex" {
        if let Some(config) = std::env::var_os("CODEX_HOME") {
            command.env("CODEX_HOME", config);
        }
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), command.output())
        .await
        .map_err(|_| "The local sign-in check timed out")?
        .map_err(|_| "The local sign-in check could not start")?;
    let matched = if cli == "codex" {
        [&output.stdout, &output.stderr].into_iter().any(|out| {
            String::from_utf8_lossy(out)
                .lines()
                .any(|line| line.trim() == "Logged in using ChatGPT")
        })
    } else {
        serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .is_ok_and(|auth| auth["loggedIn"] == true && auth["authMethod"] == "claude.ai")
    };
    Ok(if output.status.success() && matched {
        positive.into()
    } else {
        format!("{cli} did not confirm subscription login. Follow the official sign-in steps below, then check again.")
    })
}

async fn muse_account_status(
    binary: &std::path::Path,
    home: &std::path::Path,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    let result = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        let mut child = tokio::process::Command::new(binary)
            .args(["serve", "--provider", "meta", "--no-session-log", "--disable-shell", "--disable-write"])
            .current_dir("/")
            .env_clear()
            .env("HOME", home)
            .env("PATH", "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin")
            .env("MUSE_NO_AUTO_UPDATE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn().ok()?;
        let mut input = child.stdin.take()?;
        let mut output = BufReader::new(child.stdout.take()?).take(65536);
        async fn response(
            output: &mut (impl AsyncBufReadExt + Unpin),
            id: u64,
        ) -> Option<serde_json::Value> {
            loop {
                let mut line = Vec::new();
                if output.read_until(b'\n', &mut line).await.ok()? == 0 {
                    return None;
                }
                let value: serde_json::Value = serde_json::from_slice(&line).ok()?;
                if value["jsonrpc"] == "2.0" && value["id"] == id {
                    return value.get("result").cloned();
                }
            }
        }
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"maabarium_account\",\"version\":\"0.1.0\"},\"capabilities\":{\"experimentalApi\":true}}}\n").await.ok()?;
        let handshake = response(&mut output, 1).await?;
        if handshake["experimentalApi"] != true || !handshake["schema"]["fingerprint"].is_string() {
            return None;
        }
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"account/read\",\"params\":{}}\n").await.ok()?;
        let state = response(&mut output, 2).await?;
        Some(state["state"] == "accountLogin")
    }).await;
    Ok(match result {
        Ok(Some(true)) => "Muse confirms browser-account login with API-key overrides excluded. Verify your active subscription before enabling its local worker.",
        Ok(Some(false)) => "Muse did not confirm browser-account login. Run the official sign-in command, then check again.",
        _ => "The installed Muse client did not return a compatible account status. This lane stays manual.",
    }.into())
}

#[derive(Serialize)]
pub(crate) struct QueueJob {
    id: String,
    lane: String,
    state: String,
    attempts: u32,
    detail: Option<String>,
    result: Option<String>,
    usage: Option<serde_json::Value>,
    due: i64,
    model: Option<String>,
    effort: Option<String>,
    experiment_title: Option<String>,
    experiment_active: Option<bool>,
    review_pending: bool,
    review_continues: bool,
}

#[derive(serde::Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum ResearchStep {
    Lane(String),
    Configured {
        lane: String,
        model: Option<String>,
        effort: Option<String>,
    },
}

impl ResearchStep {
    fn fields(&self) -> (&str, Option<&str>, Option<&str>) {
        match self {
            Self::Lane(lane) => (lane, None, None),
            Self::Configured {
                lane,
                model,
                effort,
            } => (lane, model.as_deref(), effort.as_deref()),
        }
    }

    fn is_valid(&self) -> bool {
        let (lane, model, effort) = self.fields();
        let levels: &[&str] = match lane {
            "codex" => &["low", "medium", "high", "xhigh"],
            "claude" | "antigravity" => &["low", "medium", "high", "xhigh", "max"],
            "muse" => &[
                "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
            ],
            "deepseek" => &["low", "high", "max"],
            _ => return false,
        };
        model.is_none_or(|m| {
            m.len() <= 128
                && (lane != "deepseek" || matches!(m, "deepseek-flash" | "deepseek-v4-pro"))
                && m.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
                && m.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c))
        }) && effort.is_none_or(|e| levels.contains(&e))
            && !(lane == "antigravity"
                && effort.is_some()
                && model.is_some_and(|m| m.to_ascii_lowercase().contains("orchestrator")))
    }
}

#[derive(Serialize)]
pub(crate) struct QueueReport {
    experiments: i64,
    campaigns: Vec<CampaignReport>,
    lanes: Vec<LaneReport>,
    trend: Vec<TrendDay>,
}

#[derive(Serialize)]
struct CampaignReport {
    id: String,
    status: String,
    limit: i64,
    audited_trials: i64,
}

fn campaign_report(db: &Connection) -> rusqlite::Result<Vec<CampaignReport>> {
    let available = db.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type='table'
           AND name IN ('campaigns','campaign_trials')",
        [],
        |row| row.get::<_, i64>(0),
    )? == 2;
    if !available {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare(
        "SELECT id,status,trial_limit,(SELECT COUNT(*) FROM campaign_trials
         WHERE campaign=campaigns.id AND outcome IN ('pass','fail'))
         FROM campaigns ORDER BY rowid DESC LIMIT 50",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(CampaignReport {
            id: row.get(0)?,
            status: row.get(1)?,
            limit: row.get(2)?,
            audited_trials: row.get(3)?,
        })
    })?;
    rows.collect()
}

#[derive(Serialize)]
struct TrendDay {
    day: String,
    completed: i64,
    failed: i64,
    input: Option<i64>,
    output: Option<i64>,
}

#[derive(Serialize)]
struct LaneReport {
    lane: String,
    jobs: i64,
    completed: i64,
    failed: i64,
    stopped: i64,
    pending: i64,
    attempts: i64,
    observed_jobs: i64,
    input: Option<i64>,
    output: Option<i64>,
    cached: Option<i64>,
    cache_write: Option<i64>,
    reasoning: Option<i64>,
}

fn report(db: &Connection) -> rusqlite::Result<QueueReport> {
    let experiments = db.query_row("SELECT COUNT(*) FROM research_loops", [], |r| r.get(0))?;
    let mut stmt = db.prepare(
        "WITH observations AS (
            SELECT *, CASE WHEN json_valid(usage_json) THEN usage_json END AS usage FROM jobs
         )
         SELECT lane,COUNT(*),COUNT(*) FILTER (WHERE state='done'),
                COUNT(*) FILTER (WHERE state='failed' AND detail IS NOT 'loop stopped'),
                COUNT(*) FILTER (WHERE state='failed' AND detail='loop stopped'),
                COUNT(*) FILTER (WHERE state IN ('queued','running')),
                SUM(attempts),COUNT(usage),
                SUM(json_extract(usage,'$.input')), SUM(json_extract(usage,'$.output')),
                SUM(json_extract(usage,'$.cached')), SUM(json_extract(usage,'$.cache_write')),
                SUM(json_extract(usage,'$.reasoning'))
         FROM observations GROUP BY lane ORDER BY lane",
    )?;
    let lanes = stmt
        .query_map([], |r| {
            Ok(LaneReport {
                lane: r.get(0)?,
                jobs: r.get(1)?,
                completed: r.get(2)?,
                failed: r.get(3)?,
                stopped: r.get(4)?,
                pending: r.get(5)?,
                attempts: r.get(6)?,
                observed_jobs: r.get(7)?,
                input: r.get(8)?,
                output: r.get(9)?,
                cached: r.get(10)?,
                cache_write: r.get(11)?,
                reasoning: r.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut daily = db.prepare("WITH RECURSIVE days(day) AS (
        SELECT date('now','-13 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now')
      ), activity AS (
        SELECT date(finished_at,'unixepoch') AS day,
          COUNT(*) FILTER(WHERE state='done') AS completed,
          COUNT(*) FILTER(WHERE state='failed' AND detail IS NOT 'loop stopped') AS failed,
          SUM(CASE WHEN json_valid(usage_json) THEN json_extract(usage_json,'$.input') END) AS input,
          SUM(CASE WHEN json_valid(usage_json) THEN json_extract(usage_json,'$.output') END) AS output
        FROM jobs WHERE finished_at >= unixepoch(date('now','-13 days')) GROUP BY day
      )
      SELECT days.day,coalesce(completed,0),coalesce(failed,0),input,output
      FROM days LEFT JOIN activity USING(day) ORDER BY days.day")?;
    let trend = daily
        .query_map([], |r| {
            Ok(TrendDay {
                day: r.get(0)?,
                completed: r.get(1)?,
                failed: r.get(2)?,
                input: r.get(3)?,
                output: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(QueueReport {
        experiments,
        campaigns: campaign_report(db)?,
        lanes,
        trend,
    })
}

#[tauri::command]
pub(crate) async fn research_queue_report() -> Result<QueueReport, String> {
    tauri::async_runtime::spawn_blocking(|| report(&connect()?).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn research_muse_allowance() -> Result<Option<serde_json::Value>, String> {
    let home = std::env::var_os("HOME").ok_or("Home directory unavailable")?;
    let binary = std::path::PathBuf::from(&home).join(".local/bin/muse");
    if !binary.is_file() {
        return Ok(None);
    }
    // Never start a model, read credentials directly, or return raw provider data.
    let mut cmd = tokio::process::Command::new(binary);
    cmd.args(["usage", "--json"])
        .current_dir("/")
        .env_clear()
        .env("HOME", home)
        .env("PATH", "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin")
        .env("MUSE_NO_AUTO_UPDATE", "1")
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output())
        .await
        .map_err(|_| "Muse allowance check timed out")?
        .map_err(|_| "Muse allowance check could not start")?;
    if !output.status.success() || output.stdout.len() > 65536 {
        return Ok(None);
    }
    let Ok(data) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return Ok(None);
    };
    Ok(allowance_summary(&data["allowance"]))
}

fn allowance_summary(usage: &serde_json::Value) -> Option<serde_json::Value> {
    let observed = usage["observedAtMs"].as_u64()?;
    let mut windows = Vec::new();
    for (key, label) in [("window", "Current window"), ("weekly", "Weekly")] {
        if let (Some(used), Some(reset)) = (
            usage[key]["usedPercent"].as_u64(),
            usage[key]["resetsAtMs"].as_u64(),
        ) {
            windows.push(serde_json::json!({"label":label,"used":used,"reset":reset}));
        }
    }
    (!windows.is_empty()).then(|| serde_json::json!({"observed":observed,"windows":windows}))
}

#[cfg(target_os = "macos")]
pub(super) fn connect() -> Result<Connection, String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    let home = std::env::var_os("HOME").ok_or("Home directory unavailable")?;
    let dir = Path::new(&home).join(".maabarium/subscription-lane");
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
        .map_err(|e| format!("Could not create the queue directory: {e}"))?;
    let metadata = std::fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
    let home_metadata = std::fs::metadata(home).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.mode() & 0o077 != 0 || metadata.uid() != home_metadata.uid() {
        return Err("The queue directory must be private and owned by your account".into());
    }
    let path = dir.join("queue.db");
    if let Ok(file) = std::fs::symlink_metadata(&path) {
        if !file.is_file() || file.uid() != metadata.uid() || file.mode() & 0o077 != 0 {
            return Err("The queue database must be a private regular file".into());
        }
    }
    use std::os::unix::fs::OpenOptionsExt;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
    {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("Could not create the queue database: {e}")),
    }
    let mut db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    initialise(&mut db).map_err(|e| e.to_string())?;
    Ok(db)
}

#[cfg(not(target_os = "macos"))]
pub(super) fn connect() -> Result<Connection, String> {
    Err("The local subscription queue currently requires macOS".into())
}

fn initialise(db: &mut Connection) -> rusqlite::Result<()> {
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
            detail TEXT, result TEXT, lane TEXT NOT NULL DEFAULT 'codex');",
    )?;
    let has_lane: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name='lane')",
        [],
        |r| r.get(0),
    )?;
    if !has_lane {
        tx.execute_batch("ALTER TABLE jobs ADD COLUMN lane TEXT NOT NULL DEFAULT 'codex'")?;
    }
    let has_prompt: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name='prompt')",
        [],
        |r| r.get(0),
    )?;
    if !has_prompt {
        tx.execute_batch("ALTER TABLE jobs ADD COLUMN prompt TEXT")?;
    }
    let has_usage: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name='usage_json')",
        [],
        |r| r.get(0),
    )?;
    if !has_usage {
        tx.execute_batch("ALTER TABLE jobs ADD COLUMN usage_json TEXT")?;
    }
    let has_finished_at: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name='finished_at')",
        [],
        |r| r.get(0),
    )?;
    if !has_finished_at {
        tx.execute_batch("ALTER TABLE jobs ADD COLUMN finished_at INTEGER")?;
    }
    tx.execute_batch("CREATE INDEX IF NOT EXISTS jobs_finished_at ON jobs(finished_at)")?;
    for (name, migration) in [
        ("model", "ALTER TABLE jobs ADD COLUMN model TEXT"),
        ("effort", "ALTER TABLE jobs ADD COLUMN effort TEXT"),
    ] {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name=?)",
            [name],
            |row| row.get(0),
        )?;
        if !exists {
            tx.execute_batch(migration)?;
        }
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS research_loops (
        id TEXT PRIMARY KEY, target TEXT NOT NULL, plan TEXT NOT NULL,
        step INTEGER NOT NULL, status TEXT NOT NULL)",
    )?;
    let has_checkpoint: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('research_loops') WHERE name='review_every')",
        [],
        |r| r.get(0),
    )?;
    if !has_checkpoint {
        tx.execute_batch(
            "ALTER TABLE research_loops ADD COLUMN review_every INTEGER NOT NULL DEFAULT 1",
        )?;
    }
    tx.execute_batch(super::research_evaluator::TABLE)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS research_reviewers (
        loop_id TEXT PRIMARY KEY, selection TEXT NOT NULL)",
    )?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_benchmarks (
        loop_id TEXT PRIMARY KEY, spec TEXT NOT NULL, outcome TEXT)",
    )?;
    tx.commit()
}

#[derive(serde::Deserialize, Serialize)]
pub(crate) struct BenchmarkExecutable {
    path: String,
    sha256: String,
}

fn inspect_benchmark_file(path: &str) -> Result<BenchmarkExecutable, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    const MAX_BYTES: u64 = 64 * 1024 * 1024;
    let requested = std::path::Path::new(path);
    if !requested.is_absolute() {
        return Err("Select an executable by its full path.".into());
    }
    let path = requested.canonicalize().map_err(|e| e.to_string())?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BYTES {
        return Err("Choose a regular executable file no larger than 64 MiB.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err("The selected file is not executable.".into());
        }
    }
    let mut file = std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(MAX_BYTES + 1);
    let mut digest = Sha256::new();
    let mut chunk = [0; 16 * 1024];
    let mut bytes = 0u64;
    loop {
        let n = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        digest.update(&chunk[..n]);
    }
    if bytes != metadata.len() {
        return Err("The file changed while it was being checked. Select it again.".into());
    }
    Ok(BenchmarkExecutable {
        path: path
            .into_os_string()
            .into_string()
            .map_err(|_| "The executable path must be valid UTF-8")?,
        sha256: format!("{:x}", digest.finalize()),
    })
}

#[tauri::command]
pub(crate) async fn research_inspect_benchmark_executable(
    path: String,
) -> Result<BenchmarkExecutable, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_benchmark_file(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn research_enqueue_benchmark(
    title: String,
    public_brief: String,
    reviewer: Option<String>,
    timeout: u32,
    runner: BenchmarkExecutable,
    auditor: BenchmarkExecutable,
    confirmed: bool,
) -> Result<String, String> {
    if !confirmed
        || title.trim().is_empty()
        || title.len() > 256
        || public_brief.len() > 4096
        || !(1..=300).contains(&timeout)
    {
        return Err("Confirm you trust both programs, name the experiment, and set a time limit of 1–300 seconds.".into());
    }
    match reviewer.as_deref() {
        Some("codex" | "claude" | "antigravity") if !public_brief.trim().is_empty() => {}
        None if public_brief.is_empty() => {}
        _ => {
            return Err(
                "Choose a supported evaluator and enter a public brief, or turn off sharing."
                    .into(),
            )
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let checked_runner = inspect_benchmark_file(&runner.path)?;
        let checked_auditor = inspect_benchmark_file(&auditor.path)?;
        if checked_runner.sha256 != runner.sha256 || checked_auditor.sha256 != auditor.sha256 {
            return Err("A selected file changed. Choose it again before queuing.".into());
        }
        if checked_runner.sha256 == checked_auditor.sha256
            || checked_runner.path == checked_auditor.path
        {
            return Err("Choose a different program to check the results.".into());
        }
        let mut db = connect()?;
        let id = uuid::Uuid::new_v4().to_string();
        insert_local_benchmark(
            &mut db,
            &id,
            title.trim(),
            serde_json::json!({
                "runner": checked_runner.path, "runner_sha256": checked_runner.sha256,
                "auditor": checked_auditor.path, "auditor_sha256": checked_auditor.sha256,
                "reviewer": reviewer, "public_brief": public_brief, "timeout": timeout,
            })
            .to_string(),
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn insert_local_benchmark(
    db: &mut Connection,
    id: &str,
    title: &str,
    spec: String,
) -> rusqlite::Result<()> {
    let tx = db.transaction()?;
    tx.execute(
        "INSERT INTO research_loops(id,target,plan,step,status,review_every)
        VALUES (?,?,'[\"Local evidence\"]',1,'active',1)",
        rusqlite::params![id, title],
    )?;
    tx.execute("INSERT INTO jobs(id,lane,detail) VALUES (?,'Local evidence','Waiting for the managed benchmark worker')",
        [format!("loop:{id}:1")])?;
    tx.execute(
        "INSERT INTO local_benchmarks(loop_id,spec) VALUES (?,?)",
        rusqlite::params![id, spec],
    )?;
    tx.commit()
}

fn dismiss_local_checkpoint(db: &Connection, job_id: &str, approved: bool) -> Result<(), String> {
    let (prefix, _) = job_id
        .rsplit_once(':')
        .filter(|(_, step)| *step == "1")
        .ok_or("Invalid experiment job.")?;
    let id = prefix
        .strip_prefix("loop:")
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .ok_or("Invalid experiment job.")?;
    let count = db.execute("UPDATE research_loops SET status=? WHERE id=? AND status='active' AND step=1
        AND EXISTS (SELECT 1 FROM jobs WHERE id='loop:' || ? || ':1' AND lane='Local evidence' AND state='done')
        AND (NOT EXISTS (SELECT 1 FROM research_reviewers WHERE loop_id=?)
             OR EXISTS (SELECT 1 FROM jobs WHERE id='loop:' || ? || ':review' AND state='done'))",
        rusqlite::params![if approved { "done" } else { "stopped" }, id, id, id, id],
    ).map_err(|e| e.to_string())?;
    if count != 1 {
        return Err("This local experiment is no longer awaiting human review.".into());
    }
    release_successor(db, id, approved).map_err(|e| e.to_string())
}

/// Start (on approval) or stop the held adaptive successor of a reviewed
/// local experiment. Successors never run before a human decides.
fn release_successor(db: &Connection, loop_id: &str, approved: bool) -> rusqlite::Result<()> {
    let successor = format!("{loop_id}-next");
    let job = format!("loop:{successor}:1");
    if approved {
        if db.execute(
            "UPDATE research_loops SET status='active' WHERE id=? AND status='held'",
            [&successor],
        )? == 1
        {
            db.execute(
                "UPDATE jobs SET detail='Approved; waiting for the managed benchmark worker' WHERE id=?",
                [&job],
            )?;
        }
    } else if db.execute(
        "UPDATE research_loops SET status='stopped' WHERE id=? AND status='held'",
        [&successor],
    )? == 1
    {
        db.execute(
            "UPDATE jobs SET state='failed',finished_at=unixepoch(),detail='loop stopped' WHERE id=? AND state='queued'",
            [&job],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn research_decide_local_checkpoint(
    job_id: String,
    approved: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = connect()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        decide_checkpoint(&tx, &job_id, approved)?;
        tx.commit().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn decide_checkpoint(db: &Connection, job_id: &str, approved: bool) -> Result<(), String> {
    let stale = || "This checkpoint is no longer current. Refresh the research queue.".to_owned();
    let (prefix, suffix) = job_id.rsplit_once(':').ok_or_else(stale)?;
    let id = prefix
        .strip_prefix("loop:")
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .ok_or_else(stale)?;
    let (target, raw_plan, step, every): (String, String, u32, u32) = db.query_row(
        "SELECT target,plan,step,review_every FROM research_loops WHERE id=? AND status='active'",
        [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).map_err(|_| stale())?;
    let step = usize::try_from(step).map_err(|_| stale())?;
    let every = usize::try_from(every).map_err(|_| stale())?;
    let jobs: Vec<serde_json::Value> = serde_json::from_str(&raw_plan).map_err(|_| stale())?;
    if step == 0 || step > jobs.len() || jobs.len() > 20 || every == 0 {
        return Err(stale());
    }
    let final_step = step == jobs.len();
    let primary = format!("{prefix}:{step}");
    let (lane, state, detail): (String, String, Option<String>) = db
        .query_row(
            "SELECT lane,state,detail FROM jobs WHERE id=?",
            [&primary],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| stale())?;
    if !final_step
        && step % every != 0
        && detail.as_deref() != Some("manual result; billing unverified")
    {
        return Err(stale());
    }
    if lane == "Local evidence" && suffix == "1" {
        return dismiss_local_checkpoint(db, job_id, approved);
    }
    let (reviewer, evidence_pending): (bool, bool) = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_reviewers WHERE loop_id=?1), EXISTS(SELECT 1 FROM research_evaluations WHERE loop_id=?1 AND verdict IS NULL)",
        [id], |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|e| e.to_string())?;
    let expected = if final_step && reviewer {
        format!("{prefix}:review")
    } else {
        primary
    };
    if job_id != expected || state != "done" {
        return Err(stale());
    }
    let done: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='done')",
            [job_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !done || (approved && final_step && evidence_pending) {
        return Err(stale());
    }
    if !approved || final_step {
        db.execute(
            "UPDATE research_loops SET status=? WHERE id=?",
            rusqlite::params![if approved { "done" } else { "stopped" }, id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let next: ResearchStep = serde_json::from_value(jobs[step].clone()).map_err(|_| stale())?;
    if !next.is_valid() {
        return Err(stale());
    }
    let (lane, model, effort) = next.fields();
    let next_step = step + 1;
    let prompt = format!("Public synthetic experiment, step {next_step} of {}. Do not use tools or read local files. Work on this public target and report a bounded result: {target}", jobs.len());
    db.execute(
        "INSERT INTO jobs(id,lane,prompt,model,effort) VALUES (?,?,?,?,?)",
        rusqlite::params![format!("{prefix}:{next_step}"), lane, prompt, model, effort],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE research_loops SET step=? WHERE id=?",
        rusqlite::params![u32::try_from(next_step).map_err(|_| stale())?, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn research_loop_start(
    target: String,
    plan: Vec<ResearchStep>,
    review_every: usize,
    evaluation: Option<super::research_evaluator::EvaluationSetup>,
    reviewer: Option<ResearchStep>,
    allow_paid: Option<bool>,
) -> Result<String, String> {
    if target.trim().is_empty()
        || target.len() > 4096
        || plan.is_empty()
        || plan.len() > 20
        || !(1..=plan.len()).contains(&review_every)
        || plan.iter().any(|step| !step.is_valid())
        || reviewer.as_ref().is_some_and(|step| {
            !step.is_valid()
                || plan
                    .last()
                    .is_some_and(|last| last.fields().0 == step.fields().0)
        })
    {
        return Err(
            "Enter a public target, 1–20 valid steps, and a checkpoint within the plan. An AI reviewer must use a different provider from the last step.".into(),
        );
    }
    if plan
        .iter()
        .chain(reviewer.iter())
        .any(|step| step.fields().0 == "deepseek")
        && allow_paid != Some(true)
    {
        return Err("Confirm paid DeepSeek API use before starting the experiment.".into());
    }
    let locked = evaluation
        .map(super::research_evaluator::LockedRule::new)
        .transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = connect()?;
        let id = uuid::Uuid::new_v4().to_string();
        insert_loop(
            &mut db,
            &id,
            target.trim(),
            &plan,
            review_every,
            locked.as_ref(),
            reviewer.as_ref(),
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn insert_loop(
    db: &mut Connection,
    id: &str,
    target: &str,
    plan: &[ResearchStep],
    review_every: usize,
    rule: Option<&super::research_evaluator::LockedRule>,
    reviewer: Option<&ResearchStep>,
) -> rusqlite::Result<()> {
    let [first, ..] = plan else {
        return Err(rusqlite::Error::InvalidQuery);
    };
    let (lane, model, effort) = first.fields();
    let plan_json = serde_json::to_string(plan)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let prompt = format!(
        "Public synthetic experiment, step 1 of {}. Do not use tools or read local files. Work on this public target and report a bounded result: {target}",
        plan.len()
    );
    let tx = db.transaction()?;
    tx.execute(
        "INSERT INTO research_loops(id,target,plan,step,status,review_every) VALUES (?,?,?,1,'active',?)",
        rusqlite::params![id, target, plan_json,
            u32::try_from(review_every).map_err(|_| rusqlite::Error::InvalidQuery)?],
    )?;
    tx.execute(
        "INSERT INTO jobs(id,lane,detail,prompt,model,effort) VALUES (?,?,?,?,?,?)",
        rusqlite::params![
            format!("loop:{id}:1"),
            lane,
            match lane {
                "codex" => None,
                "deepseek" => Some("Paid DeepSeek API; waiting for enabled worker"),
                _ => Some("awaiting manual handoff"),
            },
            prompt,
            model,
            effort,
        ],
    )?;
    if let Some(rule) = rule {
        let json = serde_json::to_string(rule)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        tx.execute(
            "INSERT INTO research_evaluations(loop_id,rule) VALUES (?,?)",
            rusqlite::params![id, json],
        )?;
    }
    if let Some(reviewer) = reviewer {
        let (lane, model, effort) = reviewer.fields();
        let json =
            serde_json::json!({ "lane": lane, "model": model, "effort": effort }).to_string();
        tx.execute(
            "INSERT INTO research_reviewers(loop_id,selection) VALUES (?,?)",
            rusqlite::params![id, json],
        )?;
    }
    tx.commit()
}

#[tauri::command]
pub(crate) async fn research_queue_list() -> Result<Vec<QueueJob>, String> {
    tauri::async_runtime::spawn_blocking(|| list_jobs(&connect()?).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Most queue jobs the console receives per refresh.
const LIST_CAP: i64 = 1000;

/// Jobs for the console: the newest 50 jobs, plus every job of each active
/// experiment and of the 20 most recently active experiments, so experiment
/// reports and token totals are never built from a partial run. A plan has
/// at most 20 steps and a review, so whole experiments fit within the cap.
fn list_jobs(db: &Connection) -> rusqlite::Result<Vec<QueueJob>> {
    let mut stmt = db.prepare(
        "WITH job_loops AS (
            SELECT rowid AS rid, substr(id,6,instr(substr(id,6),':')-1) AS loop_id
            FROM jobs WHERE substr(id,1,5)='loop:'
         ), loop_rank AS (
            SELECT l.id, l.status, MAX(jl.rid) AS latest
            FROM research_loops l LEFT JOIN job_loops jl ON jl.loop_id=l.id GROUP BY l.id
         ), chosen AS (
            SELECT id FROM loop_rank WHERE status='active'
            UNION SELECT id FROM (SELECT id FROM loop_rank ORDER BY latest DESC LIMIT 20)
         ), picked AS (
            SELECT rid FROM (SELECT rowid AS rid FROM jobs ORDER BY rowid DESC LIMIT 50)
            UNION SELECT rid FROM job_loops WHERE loop_id IN (SELECT id FROM chosen)
         )
         SELECT j.id,j.lane,j.state,j.attempts,j.detail,substr(j.result,1,16384),j.usage_json,j.due,j.model,j.effort,
                l.target, l.status='active',
                COALESCE(l.status='active' AND j.state='done' AND (
                    j.id='loop:' || l.id || ':review' OR
                    (j.id='loop:' || l.id || ':' || l.step
                     AND (l.step % l.review_every=0 OR l.step=json_array_length(l.plan) OR j.detail='manual result; billing unverified')
                     AND (NOT EXISTS (SELECT 1 FROM research_reviewers WHERE loop_id=l.id)
                          OR l.step < json_array_length(l.plan))
                     AND (l.step < json_array_length(l.plan) OR NOT EXISTS (
                          SELECT 1 FROM research_evaluations WHERE loop_id=l.id AND verdict IS NULL)))
                ), 0),
                COALESCE(l.step < json_array_length(l.plan) OR EXISTS(
                    SELECT 1 FROM research_loops successor WHERE successor.id=l.id || '-next' AND successor.status='held'
                ), 0)
         FROM (SELECT rowid,* FROM jobs WHERE rowid IN (SELECT rid FROM picked)
               ORDER BY rowid DESC LIMIT ?1) j
         LEFT JOIN research_loops l ON substr(j.id,1,5)='loop:'
             AND l.id=substr(j.id,6,instr(substr(j.id,6),':')-1)
         ORDER BY j.rowid DESC",
    )?;
    let rows = stmt.query_map([LIST_CAP], |r| {
        Ok(QueueJob {
            id: r.get(0)?,
            lane: r.get(1)?,
            state: r.get(2)?,
            attempts: r.get(3)?,
            detail: r.get(4)?,
            result: r.get(5)?,
            usage: r
                .get::<_, Option<String>>(6)?
                .and_then(|raw| serde_json::from_str(&raw).ok()),
            due: r.get(7)?,
            model: r.get(8)?,
            effort: r.get(9)?,
            experiment_title: r.get(10)?,
            experiment_active: r.get(11)?,
            review_pending: r.get(12)?,
            review_continues: r.get(13)?,
        })
    })?;
    rows.collect()
}

#[tauri::command]
pub(crate) async fn research_queue_enqueue(lane: String) -> Result<String, String> {
    if !matches!(lane.as_str(), "codex" | "claude" | "antigravity" | "muse") {
        return Err("Unknown subscription lane".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let db = connect()?;
        let id = format!("{lane}-{}", uuid::Uuid::new_v4());
        let detail = (lane != "codex").then_some("awaiting manual handoff");
        db.execute(
            "INSERT INTO jobs(id,lane,detail) VALUES (?,?,?)",
            rusqlite::params![id, lane, detail],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn campaign_report_counts_only_scientific_verdicts() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        assert!(super::campaign_report(&db).unwrap().is_empty());
        db.execute_batch(
            "CREATE TABLE campaigns(id TEXT, status TEXT, trial_limit INTEGER);
             CREATE TABLE campaign_trials(campaign TEXT, outcome TEXT);
             INSERT INTO campaigns VALUES ('demo','human_review',200);
             INSERT INTO campaign_trials VALUES ('demo','fail'),('demo','operational_failure'),
                ('another','pass');",
        )
        .unwrap();
        let rows = super::campaign_report(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "demo");
        assert_eq!(rows[0].audited_trials, 1);
        assert_eq!(rows[0].limit, 200);
        assert_eq!(rows[0].status, "human_review");
    }

    #[test]
    fn provider_checkpoint_advances_once() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        insert_loop(
            &mut db,
            "pilot",
            "Public target",
            &[
                ResearchStep::Lane("codex".into()),
                ResearchStep::Lane("claude".into()),
            ],
            1,
            None,
            None,
        )
        .unwrap();
        assert!(decide_checkpoint(&db, "loop:pilot:1", true).is_err());
        db.execute("UPDATE jobs SET state='done' WHERE id='loop:pilot:1'", [])
            .unwrap();
        decide_checkpoint(&db, "loop:pilot:1", true).unwrap();
        assert!(decide_checkpoint(&db, "loop:pilot:1", true).is_err());
        let next: String = db
            .query_row("SELECT lane FROM jobs WHERE id='loop:pilot:2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(next, "claude");
        db.execute("UPDATE jobs SET state='done' WHERE id='loop:pilot:2'", [])
            .unwrap();
        decide_checkpoint(&db, "loop:pilot:2", false).unwrap();
        assert!(decide_checkpoint(&db, "loop:pilot:2", true).is_err());
    }

    fn loop_with_jobs(db: &Connection, id: &str, steps: usize) {
        let plan = serde_json::to_string(&vec!["codex"; steps]).unwrap();
        db.execute(
            "INSERT INTO research_loops(id,target,plan,step,status,review_every) VALUES (?,?,?,?, 'active', ?)",
            rusqlite::params![id, format!("{id} target"), plan, steps as i64, steps as i64],
        )
        .unwrap();
        for step in 1..=steps {
            db.execute(
                "INSERT INTO jobs(id,lane,state,usage_json) VALUES (?,'codex','done','{\"input\":10,\"output\":1}')",
                [format!("loop:{id}:{step}")],
            )
            .unwrap();
        }
    }

    #[test]
    fn list_keeps_whole_experiments_beyond_the_newest_fifty_jobs() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        loop_with_jobs(&db, "old_run", 10);
        for n in 0..80 {
            db.execute(
                "INSERT INTO jobs(id,lane,state) VALUES (?,'codex','done')",
                [format!("adhoc-{n}")],
            )
            .unwrap();
        }
        let jobs = list_jobs(&db).unwrap();
        let old: Vec<_> = jobs
            .iter()
            .filter(|job| job.id.starts_with("loop:old_run:"))
            .collect();
        assert_eq!(
            old.len(),
            10,
            "every step of an active experiment must be listed"
        );
        assert!(old.iter().all(|job| job.usage.is_some()));
        assert_eq!(
            jobs.iter()
                .filter(|job| job.id.starts_with("adhoc-"))
                .count(),
            50
        );
        // The full title is returned for the UI to wrap or shorten.
        assert_eq!(old[0].experiment_title.as_deref(), Some("old_run target"));
    }

    #[test]
    fn list_matches_experiment_ids_exactly() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        loop_with_jobs(&db, "a_b", 1);
        db.execute(
            "INSERT INTO research_loops(id,target,plan,step,status,review_every) VALUES ('axb','other','[\"codex\"]',1,'done',1)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO jobs(id,lane,state) VALUES ('loop:axb:1','codex','done')",
            [],
        )
        .unwrap();
        let jobs = list_jobs(&db).unwrap();
        let axb = jobs.iter().find(|job| job.id == "loop:axb:1").unwrap();
        assert_eq!(axb.experiment_title.as_deref(), Some("other"));
        let ab = jobs.iter().find(|job| job.id == "loop:a_b:1").unwrap();
        assert_eq!(ab.experiment_title.as_deref(), Some("a_b target"));
    }

    use super::*;

    #[test]
    fn local_checkpoint_releases_or_stops_a_held_successor() {
        for approved in [true, false] {
            let mut db = Connection::open_in_memory().unwrap();
            initialise(&mut db).unwrap();
            insert_local_benchmark(&mut db, "pilot", "Pilot", "{}".into()).unwrap();
            db.execute("UPDATE jobs SET state='done' WHERE id='loop:pilot:1'", [])
                .unwrap();
            db.execute(
                "INSERT INTO research_loops(id,target,plan,step,status,review_every) VALUES ('pilot-next','Next','[\"Local evidence\"]',1,'held',1)",
                [],
            )
            .unwrap();
            db.execute(
                "INSERT INTO jobs(id,lane,detail) VALUES ('loop:pilot-next:1','Local evidence','Held until pilot is approved')",
                [],
            )
            .unwrap();
            dismiss_local_checkpoint(&db, "loop:pilot:1", approved).unwrap();
            let (status, state): (String, String) = db
                .query_row(
                    "SELECT l.status, j.state FROM research_loops l JOIN jobs j ON j.id='loop:pilot-next:1' WHERE l.id='pilot-next'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            if approved {
                assert_eq!((status.as_str(), state.as_str()), ("active", "queued"));
            } else {
                assert_eq!((status.as_str(), state.as_str()), ("stopped", "failed"));
            }
        }
    }

    #[test]
    fn local_checkpoint_closes_only_a_completed_primary_job() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        insert_local_benchmark(&mut db, "pilot", "Pilot", "{}".into()).unwrap();
        assert!(dismiss_local_checkpoint(&db, "loop:pilot:1", true).is_err());
        db.execute("UPDATE jobs SET state='done' WHERE id='loop:pilot:1'", [])
            .unwrap();
        assert!(dismiss_local_checkpoint(&db, "loop:pilot:review", true).is_err());
        dismiss_local_checkpoint(&db, "loop:pilot:1", true).unwrap();
        assert!(dismiss_local_checkpoint(&db, "loop:pilot:1", false).is_err());
        let (status, jobs): (String, i64) = db
            .query_row(
                "SELECT status, (SELECT count(*) FROM jobs) FROM research_loops WHERE id='pilot'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((status.as_str(), jobs), ("done", 1));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "uses live subscription quota; run only for an authorized pilot"]
    fn live_public_research_pilot() {
        use super::super::research_evaluator::{record, EvaluationSetup, LockedRule};

        let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let state = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(state.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut db = Connection::open(state.path().join("queue.db")).unwrap();
        initialise(&mut db).unwrap();
        let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
        let run = |args: &[&str]| {
            let output = std::process::Command::new("python3")
                .arg(workspace.join("scripts/subscription_lane.py"))
                .arg("--state")
                .arg(state.path())
                .arg("--claude")
                .arg(home.join(".local/bin/claude"))
                .arg("--antigravity")
                .arg(home.join(".local/bin/agy"))
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{args:?}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            output.stdout
        };
        let job = |db: &Connection, id: &str| {
            db.query_row(
                "SELECT state, attempts, detail FROM jobs WHERE id=?",
                [id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .unwrap()
        };

        let values: Vec<u32> = (0..16).collect();
        let queries = [15, 21, 31];
        let cases = |answers: [bool; 3]| {
            queries.into_iter().zip(answers).map(|(q, answer)| {
                serde_json::json!({"id": q.to_string(), "answer": answer.to_string()})
            }).collect::<Vec<_>>()
        };
        let mut comparisons = 0;
        let baseline_cases = cases(queries.map(|query| {
            values.iter().any(|&value| {
                comparisons += 1;
                value == query
            })
        }));
        let mut insertions = 0;
        let bits = values.iter().fold(0u32, |bits, value| {
            insertions += 1;
            bits | (1 << value)
        });
        let mut probes = 0;
        let candidate_cases = cases(queries.map(|query| {
            probes += 1;
            bits & (1 << query) != 0
        }));
        let evidence = |cases, setup, execute| {
            serde_json::json!({
            "fixture": "public-membership-0-15-v1", "cases": cases,
            "work": {"setup": setup, "execute": execute, "propose": 0, "verify": queries.len(), "fallback": 0}
        }).to_string()
        };
        let baseline = evidence(baseline_cases, 0, comparisons);
        let candidate = evidence(candidate_cases, insertions, probes);
        let rule = LockedRule::new(
            serde_json::from_value::<EvaluationSetup>(serde_json::json!({
                "baseline": baseline, "minimumSavingsPercent": 20
            }))
            .unwrap(),
        )
        .unwrap();
        insert_loop(
            &mut db,
            "public-pilot",
            "Review a toy exact membership comparison: scan 0 through 15 for queries 15, 21 and 31 versus building and probing a 32-bit bitset. Count one unit per comparison, insertion, probe and answer check. Discuss what would invalidate the comparison. Do not execute anything.",
            &[ResearchStep::Lane("codex".into()), ResearchStep::Lane("claude".into())],
            2,
            Some(&rule),
            Some(&ResearchStep::Lane("antigravity".into())),
        ).unwrap();
        for (id, lane) in [
            ("loop:public-pilot:1", "Codex"),
            ("loop:public-pilot:2", "Claude"),
        ] {
            run(&["tick"]);
            let result = job(&db, id);
            println!("{lane}: {result:?}");
            assert_eq!(result.0, "done");
        }
        assert_eq!(
            db.query_row("SELECT count(*) FROM jobs", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            2
        );
        let verdict =
            serde_json::to_value(record(&mut db, "public-pilot", &candidate).unwrap()).unwrap();
        println!("Local verdict: {verdict}");
        assert_eq!(verdict["outcome"], "pass");
        assert_eq!(verdict["baseline_work"], "51");
        assert_eq!(verdict["candidate_work"], "22");
        drop(db);
        run(&["tick"]);
        let db = Connection::open(state.path().join("queue.db")).unwrap();
        let reviewer = job(&db, "loop:public-pilot:review");
        println!("Antigravity after worker restart: {reviewer:?}");
        assert_eq!(reviewer.0, "done");
        let status: serde_json::Value =
            serde_json::from_slice(&run(&["loop-status", "--id", "public-pilot"])).unwrap();
        assert_eq!(status["phase"], "awaiting_review");
        println!("Final phase: awaiting human review (isolated test queue discarded)");
    }

    #[test]
    fn report_separates_stops_and_missing_token_data() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        db.execute_batch(
            "INSERT INTO jobs(id,lane,state,attempts,detail,usage_json) VALUES
            ('a','claude','done',1,NULL,'{\"input\":25,\"cached\":0}'),
            ('b','claude','done',0,'manual result',NULL),
            ('c','claude','failed',4,'attempt limit',NULL),
            ('d','claude','failed',0,'loop stopped',NULL),
            ('e','muse','queued',1,NULL,NULL)",
        )
        .unwrap();
        let report = report(&db).unwrap();
        let claude = &report.lanes[0];
        assert_eq!(
            (claude.jobs, claude.completed, claude.failed, claude.stopped),
            (4, 2, 1, 1)
        );
        assert_eq!((claude.attempts, claude.observed_jobs), (5, 1));
        assert_eq!(
            (claude.input, claude.output, claude.cached),
            (Some(25), None, Some(0))
        );
        assert_eq!(report.lanes[1].pending, 1);
        assert!(report.lanes[1].input.is_none());
    }

    #[test]
    fn daily_trend_ignores_undated_jobs_and_keeps_missing_token_counters_null() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        db.execute_batch(
            "INSERT INTO jobs(id,lane,state,detail,usage_json,finished_at) VALUES
            ('legacy','codex','done',NULL,NULL,NULL),
            ('today','codex','done',NULL,'{\"input\":25}',unixepoch()),
            ('error','claude','failed','attempt limit',NULL,unixepoch()),
            ('stopped','muse','failed','loop stopped',NULL,unixepoch()),
            ('future','codex','done',NULL,NULL,unixepoch('now','+2 days'))",
        )
        .unwrap();
        let result = report(&db).unwrap();
        assert_eq!(result.trend.len(), 14);
        let today = result.trend.last().unwrap();
        assert_eq!(
            (today.completed, today.failed, today.input, today.output),
            (1, 1, Some(25), None)
        );
        assert!(result.trend[..13]
            .iter()
            .all(|day| day.completed == 0 && day.input.is_none()));
    }

    #[test]
    fn allowance_is_optional_and_filters_extra_fields() {
        assert!(allowance_summary(&serde_json::Value::Null).is_none());
        let summary = allowance_summary(&serde_json::json!({
            "observedAtMs": 100, "accountIdentifier": "not shown",
            "weekly": {"usedPercent": 44, "resetsAtMs": 200}
        }))
        .unwrap();
        assert_eq!(
            summary,
            serde_json::json!({"observed":100,"windows":[{"label":"Weekly","used":44,"reset":200}]})
        );
    }

    #[test]
    fn legacy_rows_are_routed_to_codex() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE jobs (id TEXT PRIMARY KEY, state TEXT, attempts INTEGER,
                due INTEGER, detail TEXT, result TEXT);
             INSERT INTO jobs VALUES ('legacy','done',1,0,NULL,'answer');",
        )
        .unwrap();
        initialise(&mut db).unwrap();
        initialise(&mut db).unwrap();
        let row: (String, String) = db
            .query_row("SELECT lane,result FROM jobs WHERE id='legacy'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(row, ("codex".into(), "answer".into()));
    }

    #[test]
    fn loop_creates_only_the_first_job_and_rolls_back_on_collision() {
        let mut db = Connection::open_in_memory().unwrap();
        initialise(&mut db).unwrap();
        let plan = [
            ResearchStep::Lane("muse".into()),
            ResearchStep::Lane("codex".into()),
        ];
        insert_loop(&mut db, "first", "public target", &plan, 2, None, None).unwrap();
        let row: (String, String) = db
            .query_row("SELECT id,lane FROM jobs", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(row, ("loop:first:1".into(), "muse".into()));
        db.execute("INSERT INTO jobs(id) VALUES ('loop:second:1')", [])
            .unwrap();
        assert!(insert_loop(&mut db, "second", "public target", &plan, 1, None, None).is_err());
        let count: u32 = db
            .query_row("SELECT COUNT(*) FROM research_loops", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
