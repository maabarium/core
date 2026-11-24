"""Transactional campaign ledger. Provider prose is never a scientific verdict."""

import sqlite3
import json
import hashlib
import re


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id TEXT PRIMARY KEY, trial_limit INTEGER NOT NULL CHECK(trial_limit BETWEEN 1 AND 200),
            status TEXT NOT NULL DEFAULT 'active');
        CREATE TABLE IF NOT EXISTS campaign_trials (
            campaign TEXT NOT NULL REFERENCES campaigns(id), identity TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK(outcome IN ('pass','fail','operational_failure')),
            evidence_sha256 TEXT NOT NULL, PRIMARY KEY(campaign,identity));
        CREATE TABLE IF NOT EXISTS campaign_members (
            loop_id TEXT PRIMARY KEY, campaign TEXT NOT NULL REFERENCES campaigns(id),
            ordinal INTEGER NOT NULL, UNIQUE(campaign,ordinal));
        CREATE TABLE IF NOT EXISTS campaign_proposals (
            job_id TEXT PRIMARY KEY, campaign TEXT NOT NULL REFERENCES campaigns(id));
        CREATE INDEX IF NOT EXISTS campaign_proposals_by_campaign ON campaign_proposals(campaign);
        CREATE TABLE IF NOT EXISTS campaign_provider_options (
            campaign TEXT NOT NULL REFERENCES campaigns(id), lane TEXT NOT NULL,
            model TEXT, effort TEXT, PRIMARY KEY(campaign,lane));
        CREATE TABLE IF NOT EXISTS campaign_review_policy (
            campaign TEXT PRIMARY KEY REFERENCES campaigns(id),
            interval INTEGER NOT NULL CHECK(interval BETWEEN 1 AND 200));
        CREATE TABLE IF NOT EXISTS campaign_local_budget (
            campaign TEXT PRIMARY KEY REFERENCES campaigns(id),
            remaining_seconds INTEGER NOT NULL CHECK(remaining_seconds BETWEEN 0 AND 120600));
        CREATE TABLE IF NOT EXISTS campaign_adaptive (
            campaign TEXT PRIMARY KEY REFERENCES campaigns(id), public_brief TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_confirmations (
            campaign TEXT PRIMARY KEY REFERENCES campaigns(id), loop_id TEXT NOT NULL UNIQUE,
            outcome TEXT, evidence_sha256 TEXT);
        CREATE TABLE IF NOT EXISTS campaign_autonomy (
            campaign TEXT PRIMARY KEY REFERENCES campaigns(id), policy TEXT NOT NULL,
            policy_sha256 TEXT NOT NULL, deadline INTEGER NOT NULL, round INTEGER NOT NULL DEFAULT 0,
            phase TEXT NOT NULL, reason TEXT);
        CREATE TABLE IF NOT EXISTS campaign_autonomy_trials (
            campaign TEXT NOT NULL REFERENCES campaigns(id), variant TEXT NOT NULL,
            loop_id TEXT NOT NULL UNIQUE, PRIMARY KEY(campaign,variant));
        CREATE TABLE IF NOT EXISTS campaign_admissions (
            campaign TEXT NOT NULL REFERENCES campaigns(id), round INTEGER NOT NULL,
            proposal_id TEXT NOT NULL, proposal TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('queued','running','admitted','rejected','blocked')),
            runner_sha256 TEXT, report_sha256 TEXT,
            development_panel TEXT, confirmation_panel TEXT,
            PRIMARY KEY(campaign,round), UNIQUE(campaign,proposal_id), UNIQUE(campaign,runner_sha256));
        CREATE TABLE IF NOT EXISTS campaign_confirmation_failures (
            campaign TEXT NOT NULL REFERENCES campaigns(id), loop_id TEXT NOT NULL UNIQUE,
            evidence_sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS campaign_admission_rejections (
            campaign TEXT NOT NULL, round INTEGER NOT NULL, reason TEXT NOT NULL,
            PRIMARY KEY(campaign,round),
            FOREIGN KEY(campaign,round) REFERENCES campaign_admissions(campaign,round));
        CREATE TABLE IF NOT EXISTS campaign_replenishments (
            campaign TEXT NOT NULL REFERENCES campaigns(id), ordinal INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('queued','running','done','blocked')),
            menu TEXT, report_sha256 TEXT,
            PRIMARY KEY(campaign,ordinal));
    """)


def record(db, campaign, identity, outcome, evidence_sha256, *, in_transaction=False):
    """Record an independent audit, optionally inside the worker's transaction."""
    if outcome not in ('pass', 'fail', 'operational_failure'):
        raise ValueError('not an audited outcome')
    if not identity or len(evidence_sha256) != 64 or any(
            c not in '0123456789abcdef' for c in evidence_sha256):
        raise ValueError('missing frozen identity or evidence digest')
    if not in_transaction:
        db.execute('BEGIN IMMEDIATE')
    try:
        previous = db.execute(
            'SELECT outcome,evidence_sha256 FROM campaign_trials WHERE campaign=? AND identity=?',
            (campaign, identity)).fetchone()
        if previous:
            if previous != (outcome, evidence_sha256):
                raise ValueError('conflicting replay')
            if not in_transaction:
                db.commit()
            return
        row = db.execute('SELECT trial_limit,status FROM campaigns WHERE id=?', (campaign,)).fetchone()
        if row is None or row[1] != 'active':
            raise ValueError('campaign is not active')
        db.execute('INSERT INTO campaign_trials VALUES (?,?,?,?)',
                   (campaign, identity, outcome, evidence_sha256))
        count = db.execute('SELECT COUNT(*) FROM campaign_trials WHERE campaign=?', (campaign,)).fetchone()[0]
        adaptive = db.execute('SELECT 1 FROM campaign_adaptive WHERE campaign=?', (campaign,)).fetchone()
        status = (('confirmation_required' if adaptive else 'target_achieved') if outcome == 'pass' else
                  'human_review' if count >= row[0] or outcome == 'operational_failure' else 'active')
        if status == 'active':
            policy = db.execute("SELECT interval FROM campaign_review_policy WHERE campaign=?", (campaign,)).fetchone()
            if policy and count % policy[0] == 0:
                status = 'checkpoint'
        db.execute('UPDATE campaigns SET status=? WHERE id=?', (status, campaign))
        if not in_transaction:
            db.commit()
    except Exception:
        if not in_transaction:
            db.rollback()
        raise


def create(db, campaign, limit, public_brief=None):
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
        raise ValueError('trial limit must be between 1 and 200')
    if not isinstance(campaign, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", campaign):
        raise ValueError('invalid campaign identity')
    if public_brief is not None and not 1 <= len(public_brief.encode()) <= 4096:
        raise ValueError('adaptive public brief must be 1–4096 bytes')
    db.execute('BEGIN IMMEDIATE')
    with db:
        db.execute('INSERT INTO campaigns(id,trial_limit) VALUES (?,?)', (campaign, limit))
        if public_brief is not None:
            db.execute('INSERT INTO campaign_adaptive VALUES (?,?)', (campaign, public_brief))


def verified_verdict(report, evidence, contract):
    """Reject summaries that do not prove every frozen scientific requirement."""
    required = {'contract_sha256', 'evidence_sha256', 'wrong_answers', 'lost_coverage',
                'candidate_coverage', 'baseline_coverage', 'teaching_sha256',
                'baseline_teaching_sha256', 'candidate_total_work',
                'baseline_total_work', 'strongest_comparator', 'complete'}
    if not isinstance(report, dict) or set(report) != required:
        raise ValueError('incomplete scientific audit')
    digest = hashlib.sha256(evidence).hexdigest()
    teaching = report['teaching_sha256']
    if (not isinstance(teaching, str) or len(teaching) != 64
            or any(c not in '0123456789abcdef' for c in teaching)
            or report['evidence_sha256'] != digest or report['contract_sha256'] != contract
            or report['complete'] is not True or report['strongest_comparator'] is not True
            or report['teaching_sha256'] != report['baseline_teaching_sha256']):
        raise ValueError('audit identity or comparison mismatch')
    fields = ('wrong_answers', 'lost_coverage', 'candidate_coverage', 'baseline_coverage',
              'candidate_total_work', 'baseline_total_work')
    if any(type(report[key]) is not int or report[key] < 0 for key in fields):
        raise ValueError('invalid scientific counters')
    if report['baseline_coverage'] == 0 or report['baseline_total_work'] == 0:
        raise ValueError('empty baseline cannot establish success')
    return ('pass' if report['wrong_answers'] == 0 and report['lost_coverage'] == 0
            and report['candidate_coverage'] >= report['baseline_coverage']
            and report['candidate_total_work'] < report['baseline_total_work'] else 'fail')
