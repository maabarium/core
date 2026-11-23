import importlib.util
from pathlib import Path
import sqlite3
import unittest
import tempfile

spec = importlib.util.spec_from_file_location('campaign', Path(__file__).resolve().parents[1] / 'scripts/research_campaign.py')
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)


class CampaignTest(unittest.TestCase):
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
