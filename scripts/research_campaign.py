"""Transactional campaign ledger. Provider prose is never a scientific verdict."""

import sqlite3


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id TEXT PRIMARY KEY, trial_limit INTEGER NOT NULL CHECK(trial_limit BETWEEN 1 AND 200),
            status TEXT NOT NULL DEFAULT 'active');
        CREATE TABLE IF NOT EXISTS campaign_trials (
            campaign TEXT NOT NULL REFERENCES campaigns(id), identity TEXT NOT NULL,
            outcome TEXT NOT NULL CHECK(outcome IN ('pass','fail','operational_failure')),
            evidence_sha256 TEXT NOT NULL, PRIMARY KEY(campaign,identity));
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
