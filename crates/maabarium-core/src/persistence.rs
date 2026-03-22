use std::io::Write;
use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::PersistError;
use crate::evaluator::{ExperimentResult, MetricScore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedExperiment {
    pub iteration: u64,
    pub blueprint_name: String,
    pub proposal_summary: String,
    pub weighted_total: f64,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub created_at: String,
    pub metrics: Vec<MetricScore>,
}

#[derive(Debug, Clone, Copy)]
pub enum ExportFormat {
    Json,
    Csv,
}

pub struct Persistence {
    conn: Connection,
}

impl Persistence {
    pub fn open(db_path: &str) -> Result<Self, PersistError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS experiments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                iteration INTEGER NOT NULL,
                blueprint_name TEXT NOT NULL,
                proposal_summary TEXT NOT NULL,
                weighted_total REAL NOT NULL,
                duration_ms INTEGER NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experiment_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                value REAL NOT NULL,
                weight REAL NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS proposals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experiment_id INTEGER NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );",
        )?;
        Ok(Self { conn })
    }

    pub fn log_experiment(
        &self,
        blueprint_name: &str,
        result: &ExperimentResult,
    ) -> Result<i64, PersistError> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO experiments (iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![
                result.iteration as i64,
                blueprint_name,
                result.proposal.summary,
                result.weighted_total,
                result.duration_ms as i64,
                now,
            ],
        )?;
        let exp_id = self.conn.last_insert_rowid();
        for score in &result.scores {
            self.conn.execute(
                "INSERT INTO metrics (experiment_id, name, value, weight) VALUES (?1, ?2, ?3, ?4)",
                params![exp_id, score.name, score.value, score.weight],
            )?;
        }
        Ok(exp_id)
    }

    pub fn log_failure(
        &self,
        blueprint_name: &str,
        iteration: u64,
        error: &str,
    ) -> Result<(), PersistError> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO experiments (iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at)
             VALUES (?1, ?2, '', 0.0, 0, ?3, ?4)",
            params![iteration as i64, blueprint_name, error, now],
        )?;
        Ok(())
    }

    pub fn load_baseline(&self, blueprint_name: &str) -> Result<Option<f64>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT weighted_total FROM experiments
             WHERE blueprint_name = ?1 AND error IS NULL
             ORDER BY weighted_total DESC LIMIT 1",
        )?;
        let result = stmt.query_row(params![blueprint_name], |row| row.get::<_, f64>(0));
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(PersistError::Sqlite(e)),
        }
    }

    pub fn recent_experiments(
        &self,
        limit: usize,
    ) -> Result<Vec<PersistedExperiment>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at
             FROM experiments
             ORDER BY id DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;

        let mut experiments = Vec::new();
        for row in rows {
            let (
                id,
                iteration,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms,
                error,
                created_at,
            ) = row?;
            let metrics = self.load_metrics(id)?;
            experiments.push(PersistedExperiment {
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                created_at,
                metrics,
            });
        }

        Ok(experiments)
    }

    pub fn export(
        &self,
        format: ExportFormat,
        output: impl AsRef<Path>,
    ) -> Result<(), PersistError> {
        match format {
            ExportFormat::Json => self.export_json(output),
            ExportFormat::Csv => self.export_csv(output),
        }
    }

    pub fn export_json(&self, output: impl AsRef<Path>) -> Result<(), PersistError> {
        let file = std::fs::File::create(output)?;
        let mut writer = std::io::BufWriter::new(file);
        writer.write_all(b"[\n")?;

        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at
             FROM experiments
             ORDER BY id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;

        let mut first = true;
        for row in rows {
            let (
                id,
                iteration,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms,
                error,
                created_at,
            ) = row?;
            let record = PersistedExperiment {
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                created_at,
                metrics: self.load_metrics(id)?,
            };
            if !first {
                writer.write_all(b",\n")?;
            }
            serde_json::to_writer_pretty(&mut writer, &record)?;
            first = false;
        }
        writer.write_all(b"\n]\n")?;
        Ok(())
    }

    pub fn export_csv(&self, output: impl AsRef<Path>) -> Result<(), PersistError> {
        let mut writer = csv::Writer::from_path(output)?;
        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at
             FROM experiments
             ORDER BY id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?;

        for row in rows {
            let (
                id,
                iteration,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms,
                error,
                created_at,
            ) = row?;
            let metrics_json = serde_json::to_string(&self.load_metrics(id)?)?;
            writer.serialize((
                iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms as u64,
                error.unwrap_or_default(),
                created_at,
                metrics_json,
            ))?;
        }
        writer.flush()?;
        Ok(())
    }

    fn load_metrics(&self, experiment_id: i64) -> Result<Vec<MetricScore>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT name, value, weight FROM metrics WHERE experiment_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![experiment_id], |row| {
            Ok(MetricScore {
                name: row.get(0)?,
                value: row.get(1)?,
                weight: row.get(2)?,
            })
        })?;

        let mut metrics = Vec::new();
        for row in rows {
            metrics.push(row?);
        }
        Ok(metrics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_manager::Proposal;

    fn sample_result() -> ExperimentResult {
        ExperimentResult {
            iteration: 1,
            proposal: Proposal {
                summary: "Improve export coverage".into(),
                file_patches: vec![],
            },
            scores: vec![MetricScore {
                name: "quality".into(),
                value: 0.8,
                weight: 1.0,
            }],
            weighted_total: 0.8,
            duration_ms: 12,
        }
    }

    #[test]
    fn exports_json_and_csv() {
        let db_path =
            std::env::temp_dir().join(format!("maabarium-export-{}.db", uuid::Uuid::new_v4()));
        let json_path =
            std::env::temp_dir().join(format!("maabarium-export-{}.json", uuid::Uuid::new_v4()));
        let csv_path =
            std::env::temp_dir().join(format!("maabarium-export-{}.csv", uuid::Uuid::new_v4()));

        let persistence =
            Persistence::open(db_path.to_str().expect("temp db path should be valid"))
                .expect("db should open");
        persistence
            .log_experiment("example", &sample_result())
            .expect("experiment should be logged");

        persistence
            .export_json(&json_path)
            .expect("json export should succeed");
        persistence
            .export_csv(&csv_path)
            .expect("csv export should succeed");

        let json = std::fs::read_to_string(&json_path).expect("json export should exist");
        let csv = std::fs::read_to_string(&csv_path).expect("csv export should exist");

        assert!(json.contains("\"blueprint_name\": \"example\""));
        assert!(csv.contains("example"));

        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(json_path);
        let _ = std::fs::remove_file(csv_path);
    }
}
