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
        let db_path =
            std::env::temp_dir().join(format!("maabarium-blueprint-history-{}.db", uuid::Uuid::new_v4()));

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
        assert!(workflow_experiments.iter().all(|experiment| {
            experiment.blueprint_name == "general-research-test"
        }));
        assert_eq!(
            workflow_experiments[0].error.as_deref(),
            Some("Git operation failed: could not find repository")
        );
        assert_eq!(workflow_experiments[1].promotion_outcome, PromotionOutcome::Rejected);

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
            retained_other_winners[0].promoted_target_branch_name.as_deref(),
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
