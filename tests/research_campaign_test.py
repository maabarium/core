import importlib.util
from pathlib import Path
import sqlite3
import unittest
import tempfile
import hashlib

spec = importlib.util.spec_from_file_location('campaign', Path(__file__).resolve().parents[1] / 'scripts/research_campaign.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)


class CampaignTest(unittest.TestCase):
    def test_checkpoint_blocks_new_verdicts_without_overriding_terminal_review(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        campaign.create(db, 'bounded', 2)
        db.execute("INSERT INTO campaign_review_policy VALUES ('bounded',1)")
        db.commit()
        campaign.record(db, 'bounded', 'one', 'fail', 'a' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'checkpoint')
        with self.assertRaisesRegex(ValueError, 'not active'):
            campaign.record(db, 'bounded', 'two', 'fail', 'b' * 64)
        db.execute("UPDATE campaigns SET status='active'")
        db.commit()
        campaign.record(db, 'bounded', 'two', 'fail', 'b' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'human_review')
    def test_adaptive_development_pass_cannot_claim_the_target(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        campaign.create(db, 'adaptive', 200, 'Public synthetic research')
        campaign.record(db, 'adaptive', 'dev', 'pass', 'a' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0],
                         'confirmation_required')
        with self.assertRaisesRegex(ValueError, 'not active'):
            campaign.record(db, 'adaptive', 'unexpected', 'pass', 'b' * 64)

    def test_full_budget_counts_unique_verdicts_and_rejects_trial_201(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        campaign.create(db, 'full-budget', 200)
        for index in range(200):
            digest = hashlib.sha256(str(index).encode()).hexdigest()
            campaign.record(db, 'full-budget', str(index), 'fail', digest)
            campaign.record(db, 'full-budget', str(index), 'fail', digest)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM campaign_trials').fetchone()[0], 200)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'human_review')
        with self.assertRaises(ValueError):
            campaign.record(db, 'full-budget', '201', 'pass', 'c' * 64)
    def test_audit_requires_every_scientific_condition(self):
        evidence = b'fixed evidence'
        report = dict(contract_sha256='a' * 64,
                      evidence_sha256=hashlib.sha256(evidence).hexdigest(),
                      wrong_answers=0, lost_coverage=0, candidate_coverage=12,
                      baseline_coverage=12, teaching_sha256='b' * 64,
                      baseline_teaching_sha256='b' * 64,
                      candidate_total_work=9, baseline_total_work=10,
                      strongest_comparator=True, complete=True)
        self.assertEqual(campaign.verified_verdict(report, evidence, 'a' * 64), 'pass')
        for key, value in [('wrong_answers', 1), ('lost_coverage', 1),
                           ('candidate_total_work', 10), ('candidate_coverage', 11)]:
            self.assertEqual(campaign.verified_verdict({**report, key: value}, evidence, 'a' * 64), 'fail')
        for key, value in [('strongest_comparator', False), ('complete', False),
                           ('wrong_answers', False), ('baseline_teaching_sha256', 'c' * 64),
                           ('baseline_coverage', 0), ('baseline_total_work', 0)]:
            with self.assertRaises(ValueError):
                campaign.verified_verdict({**report, key: value}, evidence, 'a' * 64)
        with self.assertRaises(ValueError):
            campaign.verified_verdict(report, evidence + b'changed', 'a' * 64)

    def test_restart_replays_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'campaign.db')
            db = sqlite3.connect(path)
            campaign.initialize(db)
            db.execute("INSERT INTO campaigns(id,trial_limit) VALUES ('c',200)")
            db.commit()
            campaign.record(db, 'c', 'one', 'fail', 'a' * 64)
            db.close()
            db = sqlite3.connect(path)
            campaign.initialize(db)
            campaign.record(db, 'c', 'one', 'fail', 'a' * 64)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM campaign_trials').fetchone()[0], 1)
            with self.assertRaises(ValueError):
                campaign.record(db, 'c', 'one', 'pass', 'b' * 64)
            self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'active')
            db.close()

    def test_operational_failure_requires_review(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        db.execute("INSERT INTO campaigns(id,trial_limit) VALUES ('c',200)")
        db.commit()
        campaign.record(db, 'c', 'one', 'operational_failure', 'a' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'human_review')
        with self.assertRaises(ValueError):
            campaign.record(db, 'c', 'two', 'fail', 'b' * 64)

    def test_limit_and_replay(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        db.execute("INSERT INTO campaigns(id,trial_limit) VALUES ('c',2)")
        db.commit()
        campaign.record(db, 'c', 'one', 'fail', 'a' * 64)
        campaign.record(db, 'c', 'one', 'fail', 'a' * 64)
        campaign.record(db, 'c', 'two', 'fail', 'b' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'human_review')
        with self.assertRaises(ValueError):
            campaign.record(db, 'c', 'three', 'pass', 'c' * 64)

    def test_success_stops(self):
        db = sqlite3.connect(':memory:')
        campaign.initialize(db)
        db.execute("INSERT INTO campaigns(id,trial_limit) VALUES ('c',200)")
        db.commit()
        campaign.record(db, 'c', 'one', 'pass', 'a' * 64)
        self.assertEqual(db.execute('SELECT status FROM campaigns').fetchone()[0], 'target_achieved')
        with self.assertRaises(ValueError):
            campaign.record(db, 'c', 'two', 'fail', 'b' * 64)
