use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub(super) const TABLE: &str = "CREATE TABLE IF NOT EXISTS research_evaluations (
    loop_id TEXT PRIMARY KEY, rule TEXT NOT NULL, candidate TEXT, verdict TEXT
)";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvaluationSetup {
    baseline: String,
    minimum_savings_percent: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Work {
    setup: u64,
    execute: u64,
    propose: u64,
    verify: u64,
    fallback: u64,
}

impl Work {
    fn total(&self) -> u128 {
        [
            self.setup,
            self.execute,
            self.propose,
            self.verify,
            self.fallback,
        ]
        .into_iter()
        .map(u128::from)
        .sum()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Evidence {
    fixture: String,
    cases: Vec<Case>,
    work: Work,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Case {
    id: String,
    answer: String,
}

#[derive(Deserialize, Serialize)]
pub(super) struct LockedRule {
    version: u8,
    baseline: Evidence,
    minimum_savings_percent: u8,
}

#[derive(Serialize)]
pub(crate) struct Verdict {
    outcome: &'static str,
    reason: String,
    baseline_work: Option<String>,
    candidate_work: Option<String>,
    mismatches: Vec<String>,
}

fn parse(raw: &str) -> Result<Evidence, String> {
    if raw.len() > 65_536 {
        return Err("Evidence must be 64 KiB or smaller.".into());
    }
    let evidence: Evidence = serde_json::from_str(raw).map_err(|e| {
        format!(
            "Check the evidence format near line {}, column {}.",
            e.line(),
            e.column()
        )
    })?;
    if evidence.fixture.trim().is_empty()
        || evidence.fixture.len() > 256
        || !(1..=500).contains(&evidence.cases.len())
        || evidence
            .cases
            .iter()
            .any(|c| c.id.trim().is_empty() || c.id.len() > 256)
    {
        return Err("Provide a fixture name and 1–500 cases with short, unique IDs.".into());
    }
    if case_map(&evidence).len() != evidence.cases.len() {
        return Err("Two or more cases have the same ID.".into());
    }
    Ok(evidence)
}

fn case_map(evidence: &Evidence) -> BTreeMap<&str, &str> {
    evidence
        .cases
        .iter()
        .map(|case| (case.id.as_str(), case.answer.as_str()))
        .collect()
}

impl LockedRule {
    pub(super) fn new(setup: EvaluationSetup) -> Result<Self, String> {
        if !(1..=100).contains(&setup.minimum_savings_percent) {
            return Err("Enter a minimum saving from 1% to 100%.".into());
        }
        let baseline = parse(&setup.baseline)?;
        if baseline.work.total() == 0 {
            return Err("The baseline must record more than zero total work.".into());
        }
        Ok(Self {
            version: 1,
            baseline,
            minimum_savings_percent: setup.minimum_savings_percent,
        })
    }
}

fn evaluate(rule: &LockedRule, raw: &str) -> Verdict {
    let inconclusive = |reason| Verdict {
        outcome: "inconclusive",
        reason,
        baseline_work: None,
        candidate_work: None,
        mismatches: vec![],
    };
    if rule.version != 1 {
        return inconclusive("This app cannot read the saved evaluation rule.".into());
    }
    let candidate = match parse(raw) {
        Ok(value) => value,
        Err(reason) => return inconclusive(reason),
    };
    let expected = case_map(&rule.baseline);
    let actual = case_map(&candidate);
    if rule.baseline.fixture != candidate.fixture || !expected.keys().eq(actual.keys()) {
        return inconclusive("The test set or case IDs do not match the saved baseline.".into());
    }
    let mismatches: Vec<_> = expected
        .iter()
        .filter(|(id, answer)| actual.get(*id) != Some(*answer))
        .map(|(id, _)| (*id).to_owned())
        .collect();
    let baseline = rule.baseline.work.total();
    let work = candidate.work.total();
    let saved_enough = work * 100 <= baseline * u128::from(100 - rule.minimum_savings_percent);
    let (outcome, reason) = if !mismatches.is_empty() {
        (
            "fail",
            format!(
                "{} of {} answers differed from the baseline.",
                mismatches.len(),
                expected.len()
            ),
        )
    } else if saved_enough {
        (
            "pass",
            format!(
                "All {} answers matched and work fell by at least {}%.",
                expected.len(),
                rule.minimum_savings_percent
            ),
        )
    } else {
        (
            "fail",
            format!(
                "All {} answers matched, but work did not fall by the required {}%.",
                expected.len(),
                rule.minimum_savings_percent
            ),
        )
    };
    Verdict {
        outcome,
        reason,
        baseline_work: Some(baseline.to_string()),
        candidate_work: Some(work.to_string()),
        mismatches,
    }
}

#[tauri::command]
pub(crate) fn research_evaluation_preview(
    setup: EvaluationSetup,
    candidate: String,
) -> Result<Verdict, String> {
    Ok(evaluate(&LockedRule::new(setup)?, &candidate))
}

#[tauri::command]
pub(crate) async fn research_evaluation_check(
    loop_id: String,
    candidate: String,
) -> Result<Verdict, String> {
    if loop_id.len() > 128 || candidate.len() > 65_536 {
        return Err("Check the experiment ID and evidence size.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = super::research_queue::connect()?;
        record(&mut db, &loop_id, &candidate)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn record(
    db: &mut Connection,
    loop_id: &str,
    candidate: &str,
) -> Result<Verdict, String> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (raw_rule, existing): (String, bool) = tx
        .query_row(
            "SELECT rule, verdict IS NOT NULL FROM research_evaluations WHERE loop_id=?",
            [loop_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "No saved evaluation rule was found for this experiment.")?;
    if existing {
        return Err("This experiment already has a saved verdict.".into());
    }
    let finished: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_loops l JOIN jobs j
          ON j.id='loop:' || l.id || ':' || l.step
          WHERE l.id=? AND l.status='active' AND l.step=json_array_length(l.plan) AND j.state='done')",
        [loop_id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if !finished {
        return Err("Wait for the final experiment step to finish before saving a verdict.".into());
    }
    let rule: LockedRule = serde_json::from_str(&raw_rule)
        .map_err(|_| "The saved evaluation rule could not be read.")?;
    let verdict = evaluate(&rule, candidate);
    if verdict.outcome != "inconclusive" {
        let json = serde_json::to_string(&verdict).map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE research_evaluations SET candidate=?,verdict=? WHERE loop_id=?",
            rusqlite::params![candidate, json, loop_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(verdict)
}

#[tauri::command]
pub(crate) async fn research_evaluation_read(
    loop_id: String,
) -> Result<Option<serde_json::Value>, String> {
    if loop_id.len() > 128 {
        return Err("Check the experiment ID.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let db = super::research_queue::connect()?;
        let raw: Option<String> = db
            .query_row(
                "SELECT verdict FROM research_evaluations WHERE loop_id=?",
                [loop_id],
                |r| r.get(0),
            )
            .map_err(|_| "No saved evaluation rule was found for this experiment.")?;
        raw.map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|_| "Could not read the saved verdict.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(answer: &str, execute: u64) -> String {
        serde_json::json!({
            "fixture": "public-v1", "cases": [{"id": "a", "answer": answer}],
            "work": {"setup": 5, "execute": execute, "propose": 1, "verify": 3, "fallback": 1}
        })
        .to_string()
    }

    fn baseline() -> LockedRule {
        LockedRule::new(EvaluationSetup {
            baseline: evidence("yes", 90),
            minimum_savings_percent: 20,
        })
        .unwrap()
    }

    #[test]
    fn exact_gate_distinguishes_pass_cost_failure_wrong_answer_and_incomplete() {
        let rule = baseline();
        let pass = evaluate(&rule, &evidence("yes", 70));
        assert_eq!(
            (pass.outcome, pass.candidate_work.as_deref()),
            ("pass", Some("80"))
        );
        assert_eq!(evaluate(&rule, &evidence("yes", 71)).outcome, "fail");
        let wrong = evaluate(&rule, &evidence("no", 0));
        assert_eq!(wrong.outcome, "fail");
        assert_eq!(wrong.mismatches, ["a"]);
        assert_eq!(
            evaluate(&rule, &evidence("yes", 0).replace("public-v1", "other")).outcome,
            "inconclusive"
        );
        assert_eq!(evaluate(&rule, "{}").outcome, "inconclusive");
    }

    #[test]
    fn final_verdict_is_once_only_and_incomplete_evidence_does_not_consume_it() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(TABLE).unwrap();
        db.execute_batch(
            "CREATE TABLE research_loops(id TEXT, step INTEGER, plan TEXT, status TEXT);
            CREATE TABLE jobs(id TEXT, state TEXT);
            INSERT INTO research_loops VALUES ('run',1,'[\"codex\"]','active');
            INSERT INTO jobs VALUES ('loop:run:1','queued');",
        )
        .unwrap();
        db.execute(
            "INSERT INTO research_evaluations(loop_id,rule) VALUES ('run',?)",
            [serde_json::to_string(&baseline()).unwrap()],
        )
        .unwrap();
        assert!(record(&mut db, "run", &evidence("yes", 70)).is_err());
        db.execute("UPDATE jobs SET state='done'", []).unwrap();
        assert_eq!(
            record(&mut db, "run", "{}").unwrap().outcome,
            "inconclusive"
        );
        assert_eq!(
            record(&mut db, "run", &evidence("yes", 71))
                .unwrap()
                .outcome,
            "fail"
        );
        assert!(record(&mut db, "run", &evidence("yes", 70)).is_err());
        let candidate: String = db
            .query_row("SELECT candidate FROM research_evaluations", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(candidate, evidence("yes", 71));
    }
}
