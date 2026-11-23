"""Transactional campaign ledger. Provider prose is never a scientific verdict."""

import sqlite3
import json
import hashlib


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
    """)


def record(db, campaign, identity, outcome, evidence_sha256):
    """Called only after independent audit, in a separate connection/transaction."""
    if outcome not in ('pass', 'fail', 'operational_failure'):
        raise ValueError('not an audited outcome')
    if not identity or len(evidence_sha256) != 64 or any(
            c not in '0123456789abcdef' for c in evidence_sha256):
        raise ValueError('missing frozen identity or evidence digest')
    db.execute('BEGIN IMMEDIATE')
    try:
        previous = db.execute(
            'SELECT outcome,evidence_sha256 FROM campaign_trials WHERE campaign=? AND identity=?',
            (campaign, identity)).fetchone()
        if previous:
            if previous != (outcome, evidence_sha256):
                raise ValueError('conflicting replay')
            db.commit()
            return
        row = db.execute('SELECT trial_limit,status FROM campaigns WHERE id=?', (campaign,)).fetchone()
        if row is None or row[1] != 'active':
            raise ValueError('campaign is not active')
        db.execute('INSERT INTO campaign_trials VALUES (?,?,?,?)',
                   (campaign, identity, outcome, evidence_sha256))
        count = db.execute('SELECT COUNT(*) FROM campaign_trials WHERE campaign=?', (campaign,)).fetchone()[0]
        status = ('target_achieved' if outcome == 'pass' else
                  'human_review' if count >= row[0] or outcome == 'operational_failure' else 'active')
        db.execute('UPDATE campaigns SET status=? WHERE id=?', (status, campaign))
        db.commit()
    except Exception:
        db.rollback()
        raise


def create(db, campaign, limit):
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
        raise ValueError('trial limit must be between 1 and 200')
    if not isinstance(campaign, str) or not campaign or len(campaign) > 64:
        raise ValueError('invalid campaign identity')
    with db:
        db.execute('INSERT INTO campaigns(id,trial_limit) VALUES (?,?)', (campaign, limit))


def verified_verdict(report, evidence, contract):
    """Reject summaries that do not prove every frozen scientific requirement."""
    required = {'contract_sha256', 'evidence_sha256', 'wrong_answers', 'lost_coverage',
                'candidate_coverage', 'baseline_coverage', 'teaching_sha256',
                'baseline_teaching_sha256', 'candidate_total_work',
                'baseline_total_work', 'strongest_comparator', 'complete'}
    if not isinstance(report, dict) or set(report) != required:
        raise ValueError('incomplete scientific audit')
    digest = hashlib.sha256(evidence).hexdigest()
    if (report['evidence_sha256'] != digest or report['contract_sha256'] != contract
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
