use rusqlite::Connection;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::Path;

#[tauri::command]
pub(crate) async fn research_subscription_check(lane: String) -> Result<String, String> {
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
}

#[derive(Serialize)]
pub(crate) struct QueueReport {
    experiments: i64,
    lanes: Vec<LaneReport>,
    trend: Vec<TrendDay>,
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
fn connect() -> Result<Connection, String> {
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
fn connect() -> Result<Connection, String> {
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
    tx.commit()
}

#[tauri::command]
pub(crate) async fn research_loop_start(
    target: String,
    plan: Vec<String>,
    review_every: usize,
) -> Result<String, String> {
    if target.trim().is_empty()
        || target.len() > 4096
        || plan.is_empty()
        || plan.len() > 20
        || !(1..=plan.len()).contains(&review_every)
        || plan
            .iter()
            .any(|lane| !matches!(lane.as_str(), "codex" | "claude" | "antigravity" | "muse"))
    {
        return Err(
            "Enter a public target, 1–20 provider steps, and a checkpoint within the plan.".into(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = connect()?;
        let id = uuid::Uuid::new_v4().to_string();
        insert_loop(&mut db, &id, target.trim(), &plan, review_every).map_err(|e| e.to_string())?;
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn insert_loop(
    db: &mut Connection,
    id: &str,
    target: &str,
    plan: &[String],
    review_every: usize,
) -> rusqlite::Result<()> {
    let [lane, ..] = plan else {
        return Err(rusqlite::Error::InvalidQuery);
    };
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
        "INSERT INTO jobs(id,lane,detail,prompt) VALUES (?,?,?,?)",
        rusqlite::params![
            format!("loop:{id}:1"),
            lane,
            (lane != "codex").then_some("awaiting manual handoff"),
            prompt,
        ],
    )?;
    tx.commit()
}

#[tauri::command]
pub(crate) async fn research_queue_list() -> Result<Vec<QueueJob>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let db = connect()?;
        let mut stmt = db
            .prepare(
                "SELECT id,lane,state,attempts,detail,substr(result,1,16384),usage_json,due
                      FROM jobs ORDER BY rowid DESC LIMIT 50",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
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
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
    use super::*;

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
        let plan = ["muse".into(), "codex".into()];
        insert_loop(&mut db, "first", "public target", &plan, 2).unwrap();
        let row: (String, String) = db
            .query_row("SELECT id,lane FROM jobs", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(row, ("loop:first:1".into(), "muse".into()));
        db.execute("INSERT INTO jobs(id) VALUES ('loop:second:1')", [])
            .unwrap();
        assert!(insert_loop(&mut db, "second", "public target", &plan, 1).is_err());
        let count: u32 = db
            .query_row("SELECT COUNT(*) FROM research_loops", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
