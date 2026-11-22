use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::error::PersistError;
use crate::evaluator::{
    ExperimentResult, LoraArtifacts, MetricScore, ResearchArtifacts, ResearchCitation,
    ResearchQueryTrace, ResearchSource,
};
use crate::git_manager::FilePatch;
use crate::run_groups::{
    ExecutionMode, GroupBlueprintEntry, GroupRun, GroupRunExperiment, GroupRunStatus,
    RunExperimentStatus, RunGroup,
};
use crate::telegram::TelegramConfig;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromotionOutcome {
    Unknown,
    Promoted,
    Rejected,
    Cancelled,
    PromotionFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedExperiment {
    pub id: i64,
    pub iteration: u64,
    pub blueprint_name: String,
    pub proposal_summary: String,
    pub weighted_total: f64,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub promotion_outcome: PromotionOutcome,
    pub promoted_branch_name: Option<String>,
    pub promoted_commit_oid: Option<String>,
    pub promoted_target_branch_name: Option<String>,
    pub created_at: String,
    pub metrics: Vec<MetricScore>,
    pub research: Option<ResearchArtifacts>,
    pub lora: Option<LoraArtifacts>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedProposal {
    pub id: i64,
    pub experiment_id: i64,
    pub summary: String,
    pub created_at: String,
    pub file_patches: Vec<FilePatch>,
}

#[derive(Debug, Clone, Copy)]
pub enum ExportFormat {
    Json,
    Csv,
}

pub struct Persistence {
    conn: Connection,
}

impl PromotionOutcome {
    fn as_db_value(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Promoted => "promoted",
            Self::Rejected => "rejected",
            Self::Cancelled => "cancelled",
            Self::PromotionFailed => "promotion_failed",
        }
    }

    fn from_db_value(value: &str) -> Self {
        match value {
            "promoted" => Self::Promoted,
            "rejected" => Self::Rejected,
            "cancelled" => Self::Cancelled,
            "promotion_failed" => Self::PromotionFailed,
            _ => Self::Unknown,
        }
    }

    pub fn as_db_value_for_display(self) -> &'static str {
        self.as_db_value()
    }
}

pub fn default_db_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/maabarium.db")
}

const TELEGRAM_KEYCHAIN_SERVICE: &str = "org.maabarium.telegram";

impl Persistence {
    pub fn open(db_path: &str) -> Result<Self, PersistError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        // Group runs and the scheduler write from several connections.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS experiments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                iteration INTEGER NOT NULL,
                blueprint_name TEXT NOT NULL,
                proposal_summary TEXT NOT NULL,
                weighted_total REAL NOT NULL,
                duration_ms INTEGER NOT NULL,
                error TEXT,
                promotion_outcome TEXT NOT NULL DEFAULT 'unknown',
                promoted_branch_name TEXT,
                promoted_commit_oid TEXT,
                promoted_target_branch_name TEXT,
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
                file_patches_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS research_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experiment_id INTEGER NOT NULL,
                url TEXT NOT NULL,
                final_url TEXT,
                host TEXT,
                label TEXT,
                title TEXT,
                citation_count INTEGER NOT NULL,
                verified INTEGER NOT NULL,
                status_code INTEGER,
                fetch_error TEXT,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS research_citations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experiment_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                source_url TEXT NOT NULL,
                label TEXT,
                line_number INTEGER NOT NULL,
                snippet TEXT NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS research_query_traces (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experiment_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                query_text TEXT NOT NULL,
                result_count INTEGER NOT NULL,
                top_urls_json TEXT NOT NULL DEFAULT '[]',
                latency_ms INTEGER NOT NULL,
                executed_at TEXT NOT NULL,
                error TEXT,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS lora_artifacts (
                experiment_id INTEGER PRIMARY KEY,
                metadata_json TEXT NOT NULL,
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS run_groups (
                name TEXT PRIMARY KEY,
                description TEXT NOT NULL DEFAULT '',
                execution_mode TEXT NOT NULL DEFAULT 'sequential',
                schedule_type TEXT NOT NULL DEFAULT 'none',
                schedule_cron TEXT,
                schedule_datetime TEXT,
                schedule_enabled INTEGER NOT NULL DEFAULT 0,
                schedule_last_run_at TEXT,
                schedule_next_run_at TEXT,
                telegram_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS group_blueprints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_name TEXT NOT NULL,
                blueprint_name TEXT NOT NULL,
                blueprint_path TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                notifications_enabled INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (group_name) REFERENCES run_groups(name) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS group_runs (
                id TEXT PRIMARY KEY,
                group_name TEXT NOT NULL,
                execution_mode TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                summary TEXT,
                FOREIGN KEY (group_name) REFERENCES run_groups(name)
            );
            CREATE TABLE IF NOT EXISTS group_run_experiments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_run_id TEXT NOT NULL,
                experiment_id INTEGER,
                blueprint_name TEXT NOT NULL,
                blueprint_path TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                started_at TEXT,
                completed_at TEXT,
                error TEXT,
                FOREIGN KEY (group_run_id) REFERENCES group_runs(id),
                FOREIGN KEY (experiment_id) REFERENCES experiments(id)
            );
            CREATE TABLE IF NOT EXISTS telegram_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                bot_token TEXT NOT NULL DEFAULT '',
                chat_id TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                notify_on_start INTEGER NOT NULL DEFAULT 1,
                notify_on_complete INTEGER NOT NULL DEFAULT 1,
                notify_on_error INTEGER NOT NULL DEFAULT 1,
                notify_on_promotion INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS telegram_notification_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                target TEXT NOT NULL,
                experiment_id INTEGER,
                group_run_id TEXT,
                message TEXT NOT NULL,
                sent_at TEXT NOT NULL,
                success INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_experiments_blueprint_success_score
                ON experiments (blueprint_name, weighted_total DESC)
                WHERE error IS NULL;
            CREATE INDEX IF NOT EXISTS idx_experiments_blueprint_id
                ON experiments (blueprint_name, id DESC);
            CREATE INDEX IF NOT EXISTS idx_metrics_experiment_id
                ON metrics (experiment_id);
            CREATE INDEX IF NOT EXISTS idx_proposals_experiment_id
                ON proposals (experiment_id);
            CREATE INDEX IF NOT EXISTS idx_research_sources_experiment_id
                ON research_sources (experiment_id);
            CREATE INDEX IF NOT EXISTS idx_research_citations_experiment_id
                ON research_citations (experiment_id);
            CREATE INDEX IF NOT EXISTS idx_research_query_traces_experiment_id
                ON research_query_traces (experiment_id);",
        )?;
        let _ = conn.execute(
            "ALTER TABLE proposals ADD COLUMN file_patches_json TEXT NOT NULL DEFAULT '[]'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE experiments ADD COLUMN promotion_outcome TEXT NOT NULL DEFAULT 'unknown'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE experiments ADD COLUMN promoted_branch_name TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE experiments ADD COLUMN promoted_commit_oid TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE experiments ADD COLUMN promoted_target_branch_name TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE run_groups ADD COLUMN schedule_last_run_at TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE run_groups ADD COLUMN schedule_next_run_at TEXT",
            [],
        );
        let _ = conn.execute("ALTER TABLE group_runs ADD COLUMN runner_pid INTEGER", []);
        // Earlier development builds stored the bot token in plain text.
        // The token now lives in the OS keychain, so scrub any leftover copy.
        conn.execute(
            "UPDATE telegram_config SET bot_token = '' WHERE bot_token <> ''",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn log_experiment(
        &self,
        blueprint_name: &str,
        result: &ExperimentResult,
        promotion_outcome: PromotionOutcome,
        promoted_branch_name: Option<&str>,
        promoted_target_branch_name: Option<&str>,
        promoted_commit_oid: Option<&str>,
    ) -> Result<i64, PersistError> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO experiments (iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, promoted_target_branch_name, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
            params![
                result.iteration as i64,
                blueprint_name,
                result.proposal.summary,
                result.weighted_total,
                result.duration_ms as i64,
                promotion_outcome.as_db_value(),
                promoted_branch_name,
                promoted_commit_oid,
                promoted_target_branch_name,
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
        let file_patches_json = serde_json::to_string(&result.proposal.file_patches)?;
        self.conn.execute(
            "INSERT INTO proposals (experiment_id, summary, file_patches_json, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![exp_id, result.proposal.summary, file_patches_json, now],
        )?;
        if let Some(research) = &result.research {
            self.log_research_artifacts(exp_id, research)?;
        }
        if let Some(lora) = &result.lora {
            self.log_lora_artifacts(exp_id, lora)?;
        }
        Ok(exp_id)
    }

    pub fn experiment_by_id(
        &self,
        experiment_id: i64,
    ) -> Result<Option<PersistedExperiment>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
             FROM experiments
             WHERE id = ?1
             LIMIT 1",
        )?;

        let mut rows = stmt.query(params![experiment_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };

        let id = row.get::<_, i64>(0)?;
        let metrics = self.load_metrics(id)?;
        Ok(Some(PersistedExperiment {
            id,
            iteration: row.get::<_, i64>(1)? as u64,
            blueprint_name: row.get::<_, String>(2)?,
            proposal_summary: row.get::<_, String>(3)?,
            weighted_total: row.get::<_, f64>(4)?,
            duration_ms: row.get::<_, i64>(5)? as u64,
            error: row.get::<_, Option<String>>(6)?,
            promotion_outcome: PromotionOutcome::from_db_value(&row.get::<_, String>(7)?),
            promoted_branch_name: row.get::<_, Option<String>>(8)?,
            promoted_commit_oid: row.get::<_, Option<String>>(9)?,
            created_at: row.get::<_, String>(10)?,
            promoted_target_branch_name: row.get::<_, Option<String>>(11)?,
            metrics,
            research: self.load_research_artifacts(id)?,
            lora: self.load_lora_artifacts(id)?,
        }))
    }

    pub fn log_failure(
        &self,
        blueprint_name: &str,
        iteration: u64,
        error: &str,
    ) -> Result<(), PersistError> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO experiments (iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, created_at)
             VALUES (?1, ?2, '', 0.0, 0, ?3, 'unknown', ?4)",
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
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
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
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
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
                promotion_outcome,
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
            ) = row?;
            let metrics = self.load_metrics(id)?;
            experiments.push(PersistedExperiment {
                id,
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                promotion_outcome: PromotionOutcome::from_db_value(&promotion_outcome),
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
                metrics,
                research: self.load_research_artifacts(id)?,
                lora: self.load_lora_artifacts(id)?,
            });
        }

        Ok(experiments)
    }

    pub fn recent_experiments_for_blueprint(
        &self,
        blueprint_name: &str,
        limit: usize,
    ) -> Result<Vec<PersistedExperiment>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
             FROM experiments
             WHERE blueprint_name = ?1
             ORDER BY id DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![blueprint_name, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
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
                promotion_outcome,
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
            ) = row?;
            let metrics = self.load_metrics(id)?;
            experiments.push(PersistedExperiment {
                id,
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                promotion_outcome: PromotionOutcome::from_db_value(&promotion_outcome),
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
                metrics,
                research: self.load_research_artifacts(id)?,
                lora: self.load_lora_artifacts(id)?,
            });
        }

        Ok(experiments)
    }

    pub fn promoted_experiments_for_blueprint(
        &self,
        blueprint_name: &str,
        limit: usize,
    ) -> Result<Vec<PersistedExperiment>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
             FROM experiments
             WHERE blueprint_name = ?1 AND promotion_outcome = 'promoted' AND error IS NULL
             ORDER BY id DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![blueprint_name, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
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
                promotion_outcome,
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
            ) = row?;
            let metrics = self.load_metrics(id)?;
            experiments.push(PersistedExperiment {
                id,
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                promotion_outcome: PromotionOutcome::from_db_value(&promotion_outcome),
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
                metrics,
                research: self.load_research_artifacts(id)?,
                lora: self.load_lora_artifacts(id)?,
            });
        }

        Ok(experiments)
    }

    pub fn recent_proposals(&self, limit: usize) -> Result<Vec<PersistedProposal>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, experiment_id, summary, file_patches_json, created_at
             FROM proposals
             ORDER BY id DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;

        let mut proposals = Vec::new();
        for row in rows {
            let (id, experiment_id, summary, file_patches_json, created_at) = row?;
            let file_patches =
                serde_json::from_str::<Vec<FilePatch>>(&file_patches_json).unwrap_or_default();
            proposals.push(PersistedProposal {
                id,
                experiment_id,
                summary,
                created_at,
                file_patches,
            });
        }

        Ok(proposals)
    }

    pub fn recent_proposals_for_blueprint(
        &self,
        blueprint_name: &str,
        limit: usize,
    ) -> Result<Vec<PersistedProposal>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT proposals.id, proposals.experiment_id, proposals.summary, proposals.file_patches_json, proposals.created_at
             FROM proposals
             INNER JOIN experiments ON experiments.id = proposals.experiment_id
             WHERE experiments.blueprint_name = ?1
             ORDER BY proposals.id DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![blueprint_name, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;

        let mut proposals = Vec::new();
        for row in rows {
            let (id, experiment_id, summary, file_patches_json, created_at) = row?;
            let file_patches =
                serde_json::from_str::<Vec<FilePatch>>(&file_patches_json).unwrap_or_default();
            proposals.push(PersistedProposal {
                id,
                experiment_id,
                summary,
                created_at,
                file_patches,
            });
        }

        Ok(proposals)
    }

    pub fn proposals_for_experiment_ids(
        &self,
        experiment_ids: &[i64],
    ) -> Result<Vec<PersistedProposal>, PersistError> {
        if experiment_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut proposals = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id, experiment_id, summary, file_patches_json, created_at
             FROM proposals
             WHERE experiment_id = ?1
             ORDER BY id DESC",
        )?;

        for experiment_id in experiment_ids {
            let rows = stmt.query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;

            for row in rows {
                let (id, experiment_id, summary, file_patches_json, created_at) = row?;
                let file_patches =
                    serde_json::from_str::<Vec<FilePatch>>(&file_patches_json).unwrap_or_default();
                proposals.push(PersistedProposal {
                    id,
                    experiment_id,
                    summary,
                    created_at,
                    file_patches,
                });
            }
        }

        proposals.sort_by(|left, right| right.id.cmp(&left.id));
        Ok(proposals)
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
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
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
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
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
                promotion_outcome,
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
            ) = row?;
            let record = PersistedExperiment {
                id,
                iteration: iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms: duration_ms as u64,
                error,
                promotion_outcome: PromotionOutcome::from_db_value(&promotion_outcome),
                promoted_branch_name,
                promoted_commit_oid,
                created_at,
                promoted_target_branch_name,
                metrics: self.load_metrics(id)?,
                research: self.load_research_artifacts(id)?,
                lora: self.load_lora_artifacts(id)?,
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
            "SELECT id, iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, promotion_outcome, promoted_branch_name, promoted_commit_oid, created_at, promoted_target_branch_name
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
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
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
                promotion_outcome,
                _promoted_branch_name,
                _promoted_commit_oid,
                created_at,
                _promoted_target_branch_name,
            ) = row?;
            let metrics_json = serde_json::to_string(&self.load_metrics(id)?)?;
            let research_json = serde_json::to_string(&self.load_research_artifacts(id)?)?;
            let lora_json = serde_json::to_string(&self.load_lora_artifacts(id)?)?;
            writer.serialize((
                iteration as u64,
                blueprint_name,
                proposal_summary,
                weighted_total,
                duration_ms as u64,
                error.unwrap_or_default(),
                PromotionOutcome::from_db_value(&promotion_outcome).as_db_value(),
                created_at,
                metrics_json,
                research_json,
                lora_json,
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

    fn log_research_artifacts(
        &self,
        experiment_id: i64,
        research: &ResearchArtifacts,
    ) -> Result<(), PersistError> {
        for source in &research.sources {
            self.conn.execute(
                "INSERT INTO research_sources (experiment_id, url, final_url, host, label, title, citation_count, verified, status_code, fetch_error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    experiment_id,
                    source.url,
                    source.final_url,
                    source.host,
                    source.label,
                    source.title,
                    source.citation_count as i64,
                    if source.verified { 1_i64 } else { 0_i64 },
                    source.status_code.map(i64::from),
                    source.fetch_error,
                ],
            )?;
        }

        for citation in &research.citations {
            self.conn.execute(
                "INSERT INTO research_citations (experiment_id, file_path, source_url, label, line_number, snippet)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    experiment_id,
                    citation.file_path,
                    citation.source_url,
                    citation.label,
                    citation.line_number as i64,
                    citation.snippet,
                ],
            )?;
        }

        for query_trace in &research.query_traces {
            let top_urls_json = serde_json::to_string(&query_trace.top_urls)?;
            self.conn.execute(
                "INSERT INTO research_query_traces (experiment_id, provider, query_text, result_count, top_urls_json, latency_ms, executed_at, error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    experiment_id,
                    query_trace.provider,
                    query_trace.query_text,
                    query_trace.result_count as i64,
                    top_urls_json,
                    query_trace.latency_ms as i64,
                    query_trace.executed_at,
                    query_trace.error,
                ],
            )?;
        }

        Ok(())
    }

    fn load_research_artifacts(
        &self,
        experiment_id: i64,
    ) -> Result<Option<ResearchArtifacts>, PersistError> {
        let mut source_stmt = self.conn.prepare(
            "SELECT url, final_url, host, label, title, citation_count, verified, status_code, fetch_error
             FROM research_sources
             WHERE experiment_id = ?1
             ORDER BY id ASC",
        )?;
        let source_rows = source_stmt.query_map(params![experiment_id], |row| {
            Ok(ResearchSource {
                url: row.get(0)?,
                final_url: row.get(1)?,
                host: row.get(2)?,
                label: row.get(3)?,
                title: row.get(4)?,
                citation_count: row.get::<_, i64>(5)? as u32,
                verified: row.get::<_, i64>(6)? != 0,
                status_code: row.get::<_, Option<i64>>(7)?.map(|value| value as u16),
                fetch_error: row.get(8)?,
            })
        })?;

        let mut sources = Vec::new();
        for row in source_rows {
            sources.push(row?);
        }

        let mut citation_stmt = self.conn.prepare(
            "SELECT file_path, source_url, label, line_number, snippet
             FROM research_citations
             WHERE experiment_id = ?1
             ORDER BY id ASC",
        )?;
        let citation_rows = citation_stmt.query_map(params![experiment_id], |row| {
            Ok(ResearchCitation {
                file_path: row.get(0)?,
                source_url: row.get(1)?,
                label: row.get(2)?,
                line_number: row.get::<_, i64>(3)? as u32,
                snippet: row.get(4)?,
            })
        })?;

        let mut citations = Vec::new();
        for row in citation_rows {
            citations.push(row?);
        }

        let mut trace_stmt = self.conn.prepare(
            "SELECT provider, query_text, result_count, top_urls_json, latency_ms, executed_at, error
             FROM research_query_traces
             WHERE experiment_id = ?1
             ORDER BY id ASC",
        )?;
        let trace_rows = trace_stmt.query_map(params![experiment_id], |row| {
            let top_urls_json = row.get::<_, String>(3)?;
            Ok(ResearchQueryTrace {
                provider: row.get(0)?,
                query_text: row.get(1)?,
                result_count: row.get::<_, i64>(2)? as u32,
                top_urls: serde_json::from_str(&top_urls_json).unwrap_or_default(),
                latency_ms: row.get::<_, i64>(4)? as u64,
                executed_at: row.get(5)?,
                error: row.get(6)?,
            })
        })?;

        let mut query_traces = Vec::new();
        for row in trace_rows {
            query_traces.push(row?);
        }

        if sources.is_empty() && citations.is_empty() && query_traces.is_empty() {
            Ok(None)
        } else {
            Ok(Some(ResearchArtifacts {
                sources,
                citations,
                query_traces,
            }))
        }
    }

    fn log_lora_artifacts(
        &self,
        experiment_id: i64,
        lora: &LoraArtifacts,
    ) -> Result<(), PersistError> {
        let metadata_json = serde_json::to_string(lora)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO lora_artifacts (experiment_id, metadata_json)
             VALUES (?1, ?2)",
            params![experiment_id, metadata_json],
        )?;
        Ok(())
    }

    fn load_lora_artifacts(
        &self,
        experiment_id: i64,
    ) -> Result<Option<LoraArtifacts>, PersistError> {
        let mut stmt = self
            .conn
            .prepare("SELECT metadata_json FROM lora_artifacts WHERE experiment_id = ?1")?;
        let result = stmt.query_row(params![experiment_id], |row| row.get::<_, String>(0));
        match result {
            Ok(metadata_json) => Ok(Some(serde_json::from_str(&metadata_json)?)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(PersistError::Sqlite(error)),
        }
    }

    // ============== Run Group CRUD ==============

    /// Create a new run group.
    pub fn create_group(&self, group: &RunGroup) -> Result<(), PersistError> {
        let schedule_type = group
            .schedule
            .as_ref()
            .map(|s| s.kind.as_db_type())
            .unwrap_or("none");
        let (schedule_cron, schedule_datetime) = match group.schedule.as_ref().map(|s| &s.kind) {
            Some(crate::run_groups::ScheduleKind::Cron { expression }) => {
                (Some(expression.as_str()), None)
            }
            Some(crate::run_groups::ScheduleKind::OneShot { datetime }) => {
                (None, Some(datetime.as_str()))
            }
            _ => (None, None),
        };
        let schedule_enabled = group
            .schedule
            .as_ref()
            .map(|s| if s.enabled { 1_i64 } else { 0_i64 })
            .unwrap_or(0);
        let execution_mode = group.execution_mode.as_str();
        let telegram_enabled = if group.telegram_enabled { 1_i64 } else { 0_i64 };
        self.conn.execute(
            "INSERT INTO run_groups (name, description, execution_mode, schedule_type, schedule_cron, schedule_datetime, schedule_enabled, telegram_enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                group.name,
                group.description,
                execution_mode,
                schedule_type,
                schedule_cron,
                schedule_datetime,
                schedule_enabled,
                telegram_enabled,
                group.created_at,
            ],
        )?;
        for blueprint in &group.blueprints {
            self.add_blueprint_to_group(&group.name, blueprint)?;
        }
        Ok(())
    }

    /// Add a blueprint to an existing group.
    pub fn add_blueprint_to_group(
        &self,
        group_name: &str,
        entry: &GroupBlueprintEntry,
    ) -> Result<(), PersistError> {
        let notifications = if entry.notifications_enabled {
            1_i64
        } else {
            0_i64
        };
        self.conn.execute(
            "INSERT INTO group_blueprints (group_name, blueprint_name, blueprint_path, sort_order, notifications_enabled)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                group_name,
                entry.blueprint_name,
                entry.blueprint_path,
                entry.sort_order as i64,
                notifications,
            ],
        )?;
        Ok(())
    }

    /// List all run groups.
    pub fn list_groups(&self) -> Result<Vec<RunGroup>, PersistError> {
        use crate::run_groups::ScheduleKind;

        let mut stmt = self.conn.prepare(
            "SELECT name, description, execution_mode, schedule_type, schedule_cron, schedule_datetime, schedule_enabled, telegram_enabled, created_at, schedule_last_run_at, schedule_next_run_at
             FROM run_groups
             ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let mut groups = Vec::new();
        for row in rows {
            let (
                name,
                description,
                exec_mode_str,
                sched_type,
                cron,
                datetime,
                sched_enabled,
                telegram,
                created_at,
                last_run_at,
                next_run_at,
            ) = row?;
            let execution_mode =
                ExecutionMode::from_str(&exec_mode_str).unwrap_or(ExecutionMode::Sequential);
            let kind = match sched_type.as_str() {
                "cron" => {
                    let expr = cron.unwrap_or_default();
                    ScheduleKind::Cron { expression: expr }
                }
                "one_shot" => {
                    let dt = datetime.unwrap_or_default();
                    ScheduleKind::OneShot { datetime: dt }
                }
                _ => ScheduleKind::None,
            };
            let schedule = if !matches!(kind, ScheduleKind::None) {
                Some(crate::run_groups::ScheduledRun {
                    kind,
                    enabled: sched_enabled != 0,
                    last_run_at,
                    next_run_at,
                })
            } else {
                None
            };
            let blueprints = self.list_group_blueprints(&name)?;
            groups.push(RunGroup {
                name,
                description,
                execution_mode,
                blueprints,
                schedule,
                telegram_enabled: telegram != 0,
                created_at,
            });
        }
        Ok(groups)
    }

    /// Get a single group by name.
    pub fn get_group(&self, name: &str) -> Result<Option<RunGroup>, PersistError> {
        use crate::run_groups::ScheduleKind;

        let mut stmt = self.conn.prepare(
            "SELECT name, description, execution_mode, schedule_type, schedule_cron, schedule_datetime, schedule_enabled, telegram_enabled, created_at, schedule_last_run_at, schedule_next_run_at
             FROM run_groups
             WHERE name = ?1",
        )?;
        let mut rows = stmt.query(params![name])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let name: String = row.get(0)?;
        let description: String = row.get(1)?;
        let exec_mode_str: String = row.get(2)?;
        let sched_type: String = row.get(3)?;
        let cron: Option<String> = row.get(4)?;
        let datetime: Option<String> = row.get(5)?;
        let sched_enabled: i64 = row.get(6)?;
        let telegram: i64 = row.get(7)?;
        let created_at: String = row.get(8)?;
        let last_run_at: Option<String> = row.get(9)?;
        let next_run_at: Option<String> = row.get(10)?;

        let execution_mode =
            ExecutionMode::from_str(&exec_mode_str).unwrap_or(ExecutionMode::Sequential);
        let kind = match sched_type.as_str() {
            "cron" => {
                let expr = cron.unwrap_or_default();
                ScheduleKind::Cron { expression: expr }
            }
            "one_shot" => {
                let dt = datetime.unwrap_or_default();
                ScheduleKind::OneShot { datetime: dt }
            }
            _ => ScheduleKind::None,
        };
        let schedule = if !matches!(kind, ScheduleKind::None) {
            Some(crate::run_groups::ScheduledRun {
                kind,
                enabled: sched_enabled != 0,
                last_run_at,
                next_run_at,
            })
        } else {
            None
        };
        let blueprints = self.list_group_blueprints(&name)?;
        Ok(Some(RunGroup {
            name,
            description,
            execution_mode,
            blueprints,
            schedule,
            telegram_enabled: telegram != 0,
            created_at,
        }))
    }

    /// List blueprints for a group.
    fn list_group_blueprints(
        &self,
        group_name: &str,
    ) -> Result<Vec<GroupBlueprintEntry>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT blueprint_name, blueprint_path, sort_order, notifications_enabled
             FROM group_blueprints
             WHERE group_name = ?1
             ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map(params![group_name], |row| {
            Ok(GroupBlueprintEntry {
                blueprint_name: row.get(0)?,
                blueprint_path: row.get(1)?,
                sort_order: row.get::<_, i64>(2)? as u32,
                notifications_enabled: row.get::<_, i64>(3)? != 0,
            })
        })?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row?);
        }
        Ok(entries)
    }

    /// Remove a blueprint from a group.
    pub fn remove_blueprint_from_group(
        &self,
        group_name: &str,
        blueprint_name: &str,
    ) -> Result<(), PersistError> {
        self.conn.execute(
            "DELETE FROM group_blueprints WHERE group_name = ?1 AND blueprint_name = ?2",
            params![group_name, blueprint_name],
        )?;
        Ok(())
    }

    /// Delete a group entirely.
    pub fn delete_group(&self, name: &str) -> Result<(), PersistError> {
        let tx = self.conn.unchecked_transaction()?;
        let active: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM group_runs WHERE group_name = ?1 AND status IN ('pending', 'running'))",
            params![name],
            |row| row.get(0),
        )?;
        if active {
            return Err(PersistError::GroupActive);
        }
        tx.execute(
            "DELETE FROM group_run_experiments WHERE group_run_id IN (SELECT id FROM group_runs WHERE group_name = ?1)",
            params![name],
        )?;
        tx.execute(
            "DELETE FROM group_runs WHERE group_name = ?1",
            params![name],
        )?;
        tx.execute(
            "DELETE FROM group_blueprints WHERE group_name = ?1",
            params![name],
        )?;
        tx.execute("DELETE FROM run_groups WHERE name = ?1", params![name])?;
        tx.commit()?;
        Ok(())
    }

    /// Update group execution mode.
    pub fn update_group_execution_mode(
        &self,
        name: &str,
        mode: ExecutionMode,
    ) -> Result<(), PersistError> {
        self.conn.execute(
            "UPDATE run_groups SET execution_mode = ?1 WHERE name = ?2",
            params![mode.as_str(), name],
        )?;
        Ok(())
    }

    /// Update group schedule.
    pub fn update_group_schedule(
        &self,
        name: &str,
        schedule: &crate::run_groups::ScheduledRun,
    ) -> Result<(), PersistError> {
        use crate::run_groups::ScheduleKind;

        let schedule_type = schedule.kind.as_db_type();
        let (schedule_cron, schedule_datetime) = match &schedule.kind {
            ScheduleKind::Cron { expression } => (Some(expression.as_str()), None::<&str>),
            ScheduleKind::OneShot { datetime } => (None, Some(datetime.as_str())),
            ScheduleKind::None => (None, None),
        };
        let enabled_int = if schedule.enabled { 1_i64 } else { 0_i64 };
        self.conn.execute(
            "UPDATE run_groups SET schedule_type = ?1, schedule_cron = ?2, schedule_datetime = ?3, schedule_enabled = ?4, schedule_last_run_at = ?5, schedule_next_run_at = ?6 WHERE name = ?7",
            params![
                schedule_type,
                schedule_cron,
                schedule_datetime,
                enabled_int,
                schedule.last_run_at,
                schedule.next_run_at,
                name
            ],
        )?;
        Ok(())
    }

    pub fn mark_group_schedule_run(
        &self,
        name: &str,
        last_run_at: &str,
        next_run_at: Option<&str>,
    ) -> Result<(), PersistError> {
        self.conn.execute(
            "UPDATE run_groups SET schedule_last_run_at = ?1, schedule_next_run_at = ?2 WHERE name = ?3",
            params![last_run_at, next_run_at, name],
        )?;
        Ok(())
    }

    // ============== Group Run CRUD ==============

    /// Create a new group run record.
    pub fn create_group_run(&self, group_run: &GroupRun) -> Result<(), PersistError> {
        let mode = group_run.execution_mode.as_str();
        let status = group_run.status.as_str();
        self.conn.execute(
            "INSERT INTO group_runs (id, group_name, execution_mode, started_at, completed_at, status, summary, runner_pid)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                group_run.id,
                group_run.group_name,
                mode,
                group_run.started_at,
                group_run.completed_at,
                status,
                group_run.summary,
                std::process::id() as i64,
            ],
        )?;
        Ok(())
    }

    /// Close out group runs whose runner is gone.
    ///
    /// A run is still live if its group is in `active_groups` (tracked by this
    /// process) or if another process recorded it and `pid_alive` says that
    /// process still exists. Every other pending or running run was cut short
    /// by a crash or quit: it is marked failed, its running workflows failed
    /// and its pending workflows skipped. Returns the number of runs closed.
    pub fn reconcile_interrupted_group_runs(
        &self,
        active_groups: &std::collections::HashSet<String>,
        pid_alive: &dyn Fn(u32) -> bool,
    ) -> Result<usize, PersistError> {
        let own_pid = std::process::id();
        let stale: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, group_name, runner_pid FROM group_runs WHERE status IN ('pending', 'running')",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })?;
            let mut stale = Vec::new();
            for row in rows {
                let (id, group_name, pid) = row?;
                let live = active_groups.contains(&group_name)
                    || pid.is_some_and(|pid| {
                        let pid = pid as u32;
                        pid != own_pid && pid_alive(pid)
                    });
                if !live {
                    stale.push(id);
                }
            }
            stale
        };
        if stale.is_empty() {
            return Ok(0);
        }
        let now = chrono::Utc::now().to_rfc3339();
        let tx = self.conn.unchecked_transaction()?;
        for id in &stale {
            tx.execute(
                "UPDATE group_run_experiments SET status = 'failed', completed_at = ?1, error = COALESCE(error, 'Interrupted before completion') WHERE group_run_id = ?2 AND status = 'running'",
                params![now, id],
            )?;
            tx.execute(
                "UPDATE group_run_experiments SET status = 'skipped', error = COALESCE(error, 'Interrupted before start') WHERE group_run_id = ?1 AND status = 'pending'",
                params![id],
            )?;
            tx.execute(
                "UPDATE group_runs SET status = 'failed', completed_at = ?1, summary = 'Interrupted before completion' WHERE id = ?2",
                params![now, id],
            )?;
        }
        tx.commit()?;
        Ok(stale.len())
    }

    /// Record when a workflow inside a group run started.
    pub fn mark_group_run_experiment_started(
        &self,
        id: i64,
        started_at: &str,
    ) -> Result<(), PersistError> {
        self.conn.execute(
            "UPDATE group_run_experiments SET status = 'running', started_at = ?1 WHERE id = ?2",
            params![started_at, id],
        )?;
        Ok(())
    }

    /// The highest experiment id recorded so far (0 when there are none).
    pub fn max_experiment_id(&self) -> Result<i64, PersistError> {
        Ok(self
            .conn
            .query_row("SELECT COALESCE(MAX(id), 0) FROM experiments", [], |row| {
                row.get(0)
            })?)
    }

    /// Experiments for one blueprint recorded after `after_id`, newest first.
    pub fn experiments_for_blueprint_after(
        &self,
        blueprint_name: &str,
        after_id: i64,
    ) -> Result<Vec<(i64, PromotionOutcome)>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, promotion_outcome FROM experiments WHERE blueprint_name = ?1 AND id > ?2 ORDER BY id DESC",
        )?;
        let rows = stmt.query_map(params![blueprint_name, after_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, outcome) = row?;
            out.push((id, PromotionOutcome::from_db_value(&outcome)));
        }
        Ok(out)
    }

    /// Update a group run's status.
    pub fn update_group_run_status(
        &self,
        run_id: &str,
        status: GroupRunStatus,
        completed_at: Option<&str>,
        summary: Option<&str>,
    ) -> Result<(), PersistError> {
        let status_str = status.as_str();
        self.conn.execute(
            "UPDATE group_runs SET status = ?1, completed_at = COALESCE(?2, completed_at), summary = COALESCE(?3, summary) WHERE id = ?4",
            params![status_str, completed_at, summary, run_id],
        )?;
        Ok(())
    }

    /// Get a group run by ID.
    pub fn get_group_run(&self, run_id: &str) -> Result<Option<GroupRun>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, group_name, execution_mode, started_at, completed_at, status, summary
             FROM group_runs
             WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![run_id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(GroupRun {
            id: row.get(0)?,
            group_name: row.get(1)?,
            execution_mode: ExecutionMode::from_str(&row.get::<_, String>(2)?)
                .unwrap_or(ExecutionMode::Sequential),
            started_at: row.get(3)?,
            completed_at: row.get(4)?,
            status: GroupRunStatus::from_str(&row.get::<_, String>(5)?),
            summary: row.get(6)?,
        }))
    }

    /// List group runs for a group.
    pub fn list_group_runs(
        &self,
        group_name: &str,
        limit: usize,
    ) -> Result<Vec<GroupRun>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, group_name, execution_mode, started_at, completed_at, status, summary
             FROM group_runs
             WHERE group_name = ?1
             ORDER BY started_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![group_name, limit as i64], |row| {
            Ok(GroupRun {
                id: row.get(0)?,
                group_name: row.get(1)?,
                execution_mode: ExecutionMode::from_str(&row.get::<_, String>(2)?)
                    .unwrap_or(ExecutionMode::Sequential),
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
                status: GroupRunStatus::from_str(&row.get::<_, String>(5)?),
                summary: row.get(6)?,
            })
        })?;
        let mut runs = Vec::new();
        for row in rows {
            runs.push(row?);
        }
        Ok(runs)
    }

    /// Create a group run experiment record.
    pub fn create_group_run_experiment(
        &self,
        entry: &GroupRunExperiment,
    ) -> Result<i64, PersistError> {
        let status = entry.status.as_str();
        self.conn.execute(
            "INSERT INTO group_run_experiments (group_run_id, experiment_id, blueprint_name, blueprint_path, sort_order, status, started_at, completed_at, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.group_run_id,
                entry.experiment_id,
                entry.blueprint_name,
                entry.blueprint_path,
                entry.sort_order as i64,
                status,
                entry.started_at,
                entry.completed_at,
                entry.error,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Update a group run experiment's status.
    pub fn update_group_run_experiment(
        &self,
        id: i64,
        status: RunExperimentStatus,
        experiment_id: Option<i64>,
        completed_at: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), PersistError> {
        let status_str = status.as_str();
        self.conn.execute(
            "UPDATE group_run_experiments SET status = ?1, experiment_id = COALESCE(?2, experiment_id), completed_at = COALESCE(?3, completed_at), error = COALESCE(?4, error) WHERE id = ?5",
            params![status_str, experiment_id, completed_at, error, id],
        )?;
        Ok(())
    }

    /// List experiments for a group run.
    pub fn list_group_run_experiments(
        &self,
        group_run_id: &str,
    ) -> Result<Vec<GroupRunExperiment>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, group_run_id, experiment_id, blueprint_name, blueprint_path, sort_order, status, started_at, completed_at, error
             FROM group_run_experiments
             WHERE group_run_id = ?1
             ORDER BY sort_order ASC",
        )?;
        let rows = stmt.query_map(params![group_run_id], |row| {
            Ok(GroupRunExperiment {
                id: row.get(0)?,
                group_run_id: row.get(1)?,
                experiment_id: row.get(2)?,
                blueprint_name: row.get(3)?,
                blueprint_path: row.get(4)?,
                sort_order: row.get::<_, i64>(5)? as u32,
                status: RunExperimentStatus::from_str(&row.get::<_, String>(6)?),
                started_at: row.get(7)?,
                completed_at: row.get(8)?,
                error: row.get(9)?,
            })
        })?;
        let mut experiments = Vec::new();
        for row in rows {
            experiments.push(row?);
        }
        Ok(experiments)
    }

    // ============== Telegram Config CRUD ==============

    /// Get the Telegram settings without reading the bot token.
    ///
    /// The console and status views only need the settings, so they avoid a
    /// keychain read (and any keychain prompt) on every refresh.
    pub fn telegram_get_settings(&self) -> Result<Option<TelegramConfig>, PersistError> {
        self.read_telegram_row(false)
    }

    /// Get the Telegram config (singleton), including the keychain token
    /// when notifications are enabled.
    pub fn telegram_get_config(&self) -> Result<Option<TelegramConfig>, PersistError> {
        self.read_telegram_row(true)
    }

    fn read_telegram_row(&self, with_token: bool) -> Result<Option<TelegramConfig>, PersistError> {
        let mut stmt = self.conn.prepare(
            "SELECT chat_id, enabled, notify_on_start, notify_on_complete, notify_on_error, notify_on_promotion, updated_at
             FROM telegram_config
             WHERE id = 1",
        )?;
        let mut rows = stmt.query([])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let chat_id: String = row.get(0)?;
        let enabled = row.get::<_, i64>(1)? != 0;
        let bot_token = if enabled && with_token {
            match keyring::Entry::new(TELEGRAM_KEYCHAIN_SERVICE, &chat_id)
                .and_then(|entry| entry.get_password())
            {
                Ok(token) => token,
                Err(keyring::Error::NoEntry) => String::new(),
                Err(error) => return Err(PersistError::TelegramKeychain(error)),
            }
        } else {
            String::new()
        };
        Ok(Some(TelegramConfig {
            bot_token,
            chat_id,
            enabled,
            notify_on_start: row.get::<_, i64>(2)? != 0,
            notify_on_complete: row.get::<_, i64>(3)? != 0,
            notify_on_error: row.get::<_, i64>(4)? != 0,
            notify_on_promotion: row.get::<_, i64>(5)? != 0,
            updated_at: row.get(6)?,
        }))
    }

    /// Set the Telegram config (upsert).
    ///
    /// A non-empty token is stored in the keychain under the chat id. When the
    /// chat id changes, the token stored for the previous chat is removed so
    /// no orphaned credential is left behind.
    pub fn telegram_set_config(&self, config: &TelegramConfig) -> Result<(), PersistError> {
        let previous_chat: Option<String> = self
            .conn
            .query_row(
                "SELECT chat_id FROM telegram_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .ok();
        if !config.bot_token.is_empty() {
            keyring::Entry::new(TELEGRAM_KEYCHAIN_SERVICE, &config.chat_id)
                .and_then(|entry| entry.set_password(&config.bot_token))
                .map_err(PersistError::TelegramKeychain)?;
        }
        if let Some(previous) = previous_chat.filter(|p| !p.is_empty() && *p != config.chat_id) {
            match keyring::Entry::new(TELEGRAM_KEYCHAIN_SERVICE, &previous)
                .and_then(|entry| entry.delete_credential())
            {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => return Err(PersistError::TelegramKeychain(error)),
            }
        }
        let flag = |value: bool| if value { 1_i64 } else { 0_i64 };
        self.conn.execute(
            "INSERT OR REPLACE INTO telegram_config (id, bot_token, chat_id, enabled, notify_on_start, notify_on_complete, notify_on_error, notify_on_promotion, updated_at)
             VALUES (1, '', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                config.chat_id,
                flag(config.enabled),
                flag(config.notify_on_start),
                flag(config.notify_on_complete),
                flag(config.notify_on_error),
                flag(config.notify_on_promotion),
                config.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Log a sent notification.
    pub fn telegram_log_notification(
        &self,
        event_type: &str,
        target: &str,
        experiment_id: Option<i64>,
        group_run_id: Option<&str>,
        message: &str,
        success: bool,
    ) -> Result<(), PersistError> {
        let now = chrono::Utc::now().to_rfc3339();
        let success_int = if success { 1_i64 } else { 0_i64 };
        self.conn.execute(
            "INSERT INTO telegram_notification_log (event_type, target, experiment_id, group_run_id, message, sent_at, success)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![event_type, target, experiment_id, group_run_id, message, now, success_int],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git_manager::{FilePatch, FilePatchOperation, Proposal};

    fn sample_result() -> ExperimentResult {
        ExperimentResult {
            iteration: 1,
            proposal: Proposal {
                summary: "Improve export coverage".into(),
                file_patches: vec![FilePatch {
                    path: "src/lib.rs".into(),
                    operation: FilePatchOperation::Modify,
                    content: Some("pub fn improved() {}".into()),
                }],
            },
            scores: vec![MetricScore {
                name: "quality".into(),
                value: 0.8,
                weight: 1.0,
            }],
            weighted_total: 0.8,
            duration_ms: 12,
            research: Some(ResearchArtifacts {
                sources: vec![ResearchSource {
                    url: "https://sqlite.org/index.html".into(),
                    final_url: Some("https://sqlite.org/index.html".into()),
                    host: Some("sqlite.org".into()),
                    label: Some("SQLite docs".into()),
                    title: Some("SQLite Home Page".into()),
                    citation_count: 1,
                    verified: true,
                    status_code: Some(200),
                    fetch_error: None,
                }],
                citations: vec![ResearchCitation {
                    file_path: "docs/research.md".into(),
                    source_url: "https://sqlite.org/index.html".into(),
                    label: Some("SQLite docs".into()),
                    line_number: 3,
                    snippet: "See [SQLite docs](https://sqlite.org/index.html).".into(),
                }],
                query_traces: vec![ResearchQueryTrace {
                    provider: "brave".into(),
                    query_text: "sqlite documentation".into(),
                    result_count: 1,
                    top_urls: vec!["https://sqlite.org/index.html".into()],
                    latency_ms: 42,
                    executed_at: Utc::now().to_rfc3339(),
                    error: None,
                }],
            }),
            lora: Some(LoraArtifacts {
                trainer: "mlx_lm".into(),
                base_model: "mlx-community/Llama-3".into(),
                dataset: "fixtures/dataset.jsonl".into(),
                adapter_path: "adapter/model.safetensors".into(),
                output_dir: Some("adapter".into()),
                eval_command: Some("python -m mlx_lm.evaluate".into()),
                epochs: Some(2),
                learning_rate: Some(0.0002),
                adapter_ratio: 0.8,
                metadata_ratio: 1.0,
                reproducibility_ratio: 0.9,
                trainer_signal: 1.0,
                execution_signal: 0.95,
                sandbox_file_count: 4,
                sandbox_total_bytes: 128,
                stages: vec![crate::evaluator::LoraStageArtifact {
                    name: "train".into(),
                    command: "sh".into(),
                    args: vec!["-c".into(), "printf trained > adapter/train.log".into()],
                    working_dir: "/tmp/maabarium-sandbox".into(),
                    timeout_seconds: 5,
                    expected_artifacts: vec!["adapter/train.log".into()],
                    verified_artifacts: vec!["adapter/train.log".into()],
                }],
            }),
        }
    }

    fn group_fixture() -> (Persistence, std::path::PathBuf) {
        let db_path =
            std::env::temp_dir().join(format!("maabarium-groups-{}.db", uuid::Uuid::new_v4()));
        let persistence = Persistence::open(db_path.to_str().unwrap()).unwrap();
        persistence
            .create_group(&RunGroup {
                name: "synthetic".into(),
                description: String::new(),
                created_at: chrono::Utc::now().to_rfc3339(),
                blueprints: vec![],
                execution_mode: ExecutionMode::Sequential,
                schedule: None,
                telegram_enabled: false,
            })
            .unwrap();
        (persistence, db_path)
    }

    fn running_run(persistence: &Persistence, id: &str) -> (i64, i64) {
        persistence
            .create_group_run(&GroupRun {
                id: id.into(),
                group_name: "synthetic".into(),
                execution_mode: ExecutionMode::Sequential,
                started_at: Some(chrono::Utc::now().to_rfc3339()),
                completed_at: None,
                status: GroupRunStatus::Running,
                summary: None,
            })
            .unwrap();
        let entry = |name: &str| GroupRunExperiment {
            id: 0,
            group_run_id: id.into(),
            experiment_id: None,
            blueprint_name: name.into(),
            blueprint_path: format!("/fixtures/{name}.toml"),
            sort_order: 0,
            status: RunExperimentStatus::Pending,
            started_at: None,
            completed_at: None,
            error: None,
        };
        let first = persistence
            .create_group_run_experiment(&entry("alpha"))
            .unwrap();
        let second = persistence
            .create_group_run_experiment(&entry("beta"))
            .unwrap();
        (first, second)
    }

    #[test]
    fn workflow_start_time_is_recorded_as_started_at() {
        let (persistence, db_path) = group_fixture();
        let (first, _) = running_run(&persistence, "run-start");
        persistence
            .mark_group_run_experiment_started(first, "2026-11-22T09:00:00Z")
            .unwrap();
        let rows = persistence.list_group_run_experiments("run-start").unwrap();
        let row = rows.iter().find(|row| row.id == first).unwrap();
        assert_eq!(row.started_at.as_deref(), Some("2026-11-22T09:00:00Z"));
        assert_eq!(row.completed_at, None);
        assert_eq!(row.status, RunExperimentStatus::Running);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn interrupted_runs_are_closed_and_group_can_be_deleted() {
        let (persistence, db_path) = group_fixture();
        let (first, _) = running_run(&persistence, "run-crashed");
        persistence
            .mark_group_run_experiment_started(first, "2026-11-22T09:00:00Z")
            .unwrap();
        // Simulate a restart: the run was recorded by a process that is gone.
        persistence
            .conn
            .execute(
                "UPDATE group_runs SET runner_pid = 999999999 WHERE id = 'run-crashed'",
                [],
            )
            .unwrap();
        assert!(matches!(
            persistence.delete_group("synthetic"),
            Err(PersistError::GroupActive)
        ));

        let none = std::collections::HashSet::new();
        let closed = persistence
            .reconcile_interrupted_group_runs(&none, &|_| false)
            .unwrap();
        assert_eq!(closed, 1);
        let run = persistence.get_group_run("run-crashed").unwrap().unwrap();
        assert_eq!(run.status, GroupRunStatus::Failed);
        assert!(run.completed_at.is_some());
        let rows = persistence
            .list_group_run_experiments("run-crashed")
            .unwrap();
        let statuses: Vec<_> = rows.iter().map(|row| row.status).collect();
        assert!(statuses.contains(&RunExperimentStatus::Failed));
        assert!(statuses.contains(&RunExperimentStatus::Skipped));
        persistence.delete_group("synthetic").unwrap();
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn live_runs_are_not_reconciled() {
        let (persistence, db_path) = group_fixture();
        running_run(&persistence, "run-tracked");
        running_run(&persistence, "run-other-process");
        persistence
            .conn
            .execute(
                "UPDATE group_runs SET runner_pid = 4242 WHERE id = 'run-other-process'",
                [],
            )
            .unwrap();
        // run-tracked belongs to this process and its group is tracked as active.
        let active: std::collections::HashSet<String> = ["synthetic".to_owned()].into();
        assert_eq!(
            persistence
                .reconcile_interrupted_group_runs(&active, &|_| false)
                .unwrap(),
            0
        );
        // Untracked here, but another live process owns run-other-process.
        let none = std::collections::HashSet::new();
        assert_eq!(
            persistence
                .reconcile_interrupted_group_runs(&none, &|pid| pid == 4242)
                .unwrap(),
            1
        );
        let other = persistence
            .get_group_run("run-other-process")
            .unwrap()
            .unwrap();
        assert_eq!(other.status, GroupRunStatus::Running);
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn experiments_are_linked_by_blueprint_and_baseline() {
        let (persistence, db_path) = group_fixture();
        persistence
            .log_experiment(
                "alpha",
                &sample_result(),
                PromotionOutcome::Rejected,
                None,
                None,
                None,
            )
            .unwrap();
        let baseline = persistence.max_experiment_id().unwrap();
        persistence
            .log_experiment(
                "alpha",
                &sample_result(),
                PromotionOutcome::Promoted,
                Some("runs/a"),
                None,
                None,
            )
            .unwrap();
        // A concurrent workflow writes later; it must not be attributed to alpha.
        persistence
            .log_experiment(
                "beta",
                &sample_result(),
                PromotionOutcome::Rejected,
                None,
                None,
                None,
            )
            .unwrap();
        let alpha = persistence
            .experiments_for_blueprint_after("alpha", baseline)
            .unwrap();
        assert_eq!(alpha.len(), 1);
        assert_eq!(alpha[0].1, PromotionOutcome::Promoted);
        assert!(
            persistence
                .experiments_for_blueprint_after("gamma", baseline)
                .unwrap()
                .is_empty()
        );
        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn legacy_plaintext_telegram_token_is_scrubbed_on_open() {
        let (persistence, db_path) = group_fixture();
        persistence
            .conn
            .execute(
                "INSERT INTO telegram_config (id, bot_token, chat_id, enabled, updated_at) VALUES (1, 'synthetic-legacy-token', '42', 0, 'now')",
                [],
            )
            .unwrap();
        drop(persistence);
        let reopened = Persistence::open(db_path.to_str().unwrap()).unwrap();
        let stored: String = reopened
            .conn
            .query_row(
                "SELECT bot_token FROM telegram_config WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "");
        let settings = reopened.telegram_get_settings().unwrap().unwrap();
        assert_eq!(settings.chat_id, "42");
        assert!(settings.bot_token.is_empty());
        let _ = std::fs::remove_file(db_path);
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
            .log_experiment(
                "example",
                &sample_result(),
                PromotionOutcome::Promoted,
                Some("runs/example/1"),
                Some("master"),
                Some("abc123def456"),
            )
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
        assert!(json.contains("\"promotion_outcome\": \"promoted\""));
        assert!(json.contains("sqlite.org"));
        assert!(csv.contains("example"));
        assert!(csv.contains("promoted"));
        assert!(csv.contains("sqlite.org"));

        let proposals = persistence
            .recent_proposals(1)
            .expect("proposals should load");
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].file_patches.len(), 1);
        assert_eq!(proposals[0].file_patches[0].path, "src/lib.rs");

        let experiments = persistence
            .recent_experiments(1)
            .expect("experiments should load");
        assert_eq!(experiments[0].promotion_outcome, PromotionOutcome::Promoted);
        assert_eq!(
            experiments[0].promoted_branch_name.as_deref(),
            Some("runs/example/1")
        );
        assert_eq!(
            experiments[0].promoted_commit_oid.as_deref(),
            Some("abc123def456")
        );
        assert_eq!(
            experiments[0].promoted_target_branch_name.as_deref(),
            Some("master")
        );
        let research = experiments[0]
            .research
            .as_ref()
            .expect("research metadata should persist");
        assert_eq!(research.sources.len(), 1);
        assert_eq!(research.citations.len(), 1);
        let lora = experiments[0]
            .lora
            .as_ref()
            .expect("lora metadata should persist");
        assert_eq!(lora.trainer, "mlx_lm");
        assert_eq!(lora.stages.len(), 1);

        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(json_path);
        let _ = std::fs::remove_file(csv_path);
    }

    #[test]
    fn loads_recent_history_for_a_single_blueprint() {
        let db_path = std::env::temp_dir().join(format!(
            "maabarium-blueprint-history-{}.db",
            uuid::Uuid::new_v4()
        ));

        let persistence =
            Persistence::open(db_path.to_str().expect("temp db path should be valid"))
                .expect("db should open");

        persistence
            .log_experiment(
                "general-research-test",
                &sample_result(),
                PromotionOutcome::Rejected,
                None,
                None,
                None,
            )
            .expect("workflow experiment should be logged");
        persistence
            .log_failure(
                "general-research-test",
                2,
                "Git operation failed: could not find repository",
            )
            .expect("workflow failure should be logged");
        persistence
            .log_experiment(
                "example",
                &sample_result(),
                PromotionOutcome::Promoted,
                Some("runs/example/1"),
                Some("master"),
                Some("abc123def456"),
            )
            .expect("other workflow experiment should be logged");

        let workflow_experiments = persistence
            .recent_experiments_for_blueprint("general-research-test", 10)
            .expect("workflow experiments should load");
        assert_eq!(workflow_experiments.len(), 2);
        assert!(
            workflow_experiments
                .iter()
                .all(|experiment| { experiment.blueprint_name == "general-research-test" })
        );
        assert_eq!(
            workflow_experiments[0].error.as_deref(),
            Some("Git operation failed: could not find repository")
        );
        assert_eq!(
            workflow_experiments[1].promotion_outcome,
            PromotionOutcome::Rejected
        );

        let workflow_proposals = persistence
            .recent_proposals_for_blueprint("general-research-test", 10)
            .expect("workflow proposals should load");
        assert_eq!(workflow_proposals.len(), 1);

        let retained_winners = persistence
            .promoted_experiments_for_blueprint("general-research-test", 10)
            .expect("retained winners should load");
        assert!(retained_winners.is_empty());

        let retained_other_winners = persistence
            .promoted_experiments_for_blueprint("example", 10)
            .expect("other retained winners should load");
        assert_eq!(retained_other_winners.len(), 1);
        assert_eq!(
            retained_other_winners[0].promoted_commit_oid.as_deref(),
            Some("abc123def456")
        );
        assert_eq!(
            retained_other_winners[0]
                .promoted_target_branch_name
                .as_deref(),
            Some("master")
        );

        let retained_other_proposals = persistence
            .proposals_for_experiment_ids(&[retained_other_winners[0].id])
            .expect("winner proposals should load by experiment id");
        assert_eq!(retained_other_proposals.len(), 1);
        assert_eq!(
            retained_other_proposals[0].experiment_id,
            retained_other_winners[0].id
        );

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn legacy_rows_default_to_unknown_promotion_outcome() {
        let db_path = std::env::temp_dir().join(format!(
            "maabarium-legacy-history-{}.db",
            uuid::Uuid::new_v4()
        ));

        let persistence =
            Persistence::open(db_path.to_str().expect("temp db path should be valid"))
                .expect("db should open");

        persistence
            .conn
            .execute(
                "INSERT INTO experiments (iteration, blueprint_name, proposal_summary, weighted_total, duration_ms, error, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                params![
                    1_i64,
                    "legacy",
                    "legacy row",
                    0.75_f64,
                    1_i64,
                    Utc::now().to_rfc3339()
                ],
            )
            .expect("legacy row should insert");

        let experiments = persistence
            .recent_experiments(1)
            .expect("experiments should load");
        assert_eq!(experiments[0].promotion_outcome, PromotionOutcome::Unknown);

        let _ = std::fs::remove_file(db_path);
    }
}
