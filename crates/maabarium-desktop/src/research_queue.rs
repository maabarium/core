use rusqlite::Connection;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::Path;

#[derive(Serialize)]
pub(crate) struct QueueJob {
    id: String,
    lane: String,
    state: String,
    attempts: u32,
    detail: Option<String>,
    result: Option<String>,
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
    tx.commit()
}

#[tauri::command]
pub(crate) async fn research_queue_list() -> Result<Vec<QueueJob>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let db = connect()?;
        let mut stmt = db
            .prepare(
                "SELECT id,lane,state,attempts,detail,substr(result,1,16384)
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
}
