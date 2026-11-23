import json
import fcntl
import hashlib
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import runpy
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "subscription_lane.py"


class SubscriptionLaneTest(unittest.TestCase):
    def test_prepared_campaign_package_runs_through_worker_and_audit(self):
        preparer = SCRIPT.with_name("adaptive_app_smoke.py")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            fixture.write_text(json.dumps({"family": "membership-campaign",
                                           "rows": [9, 2, 9, 7], "queries": [42, 9, 7, 42, 42]}))
            package_command = [sys.executable, str(preparer), str(root / "package")]
            prepared = json.loads(subprocess.check_output([*package_command, "--fixture", str(fixture)], timeout=5))
            reviewed = json.loads(subprocess.check_output([*package_command, "--review", "--expected-review-sha256",
                                                           prepared["review_sha256"]], timeout=5))
            state = root / "state"
            command = [sys.executable, str(SCRIPT), "--state", str(state), "--codex", sys.executable]
            def run(*args):
                return subprocess.check_output([*command, *args], timeout=10)
            run("campaign-create", "--id", "prepared", "--public-target", "Public synthetic membership test")
            run("local-benchmark-enqueue", "--id", "membership", "--campaign", "prepared",
                "--contract-sha256", reviewed["contract_sha256"], "--local-title", "Synthetic membership",
                "--public-target", "Public synthetic membership test", "--reviewer", "codex",
                "--runner", prepared["runner"], "--runner-sha256", reviewed["pins"]["runner"],
                "--auditor", prepared["auditor"], "--auditor-sha256", reviewed["pins"]["auditor"])
            run("tick")
            status = json.loads(run("campaign-status", "--id", "prepared"))
            self.assertEqual((status["audited_trials"], status["status"]), (1, "confirmation_required"))
            audit = json.loads((state / "local-evidence" / "membership" / "auditor.json").read_bytes())
            self.assertEqual((audit["candidate_total_work"], audit["baseline_total_work"]), (9, 15))
            self.assertEqual(audit["wrong_answers"], 0)

    def test_campaign_budget_blocks_launch_before_creating_evidence(self):
        process = runpy.run_path(str(SCRIPT))["process_local_benchmark"]
        with tempfile.TemporaryDirectory() as root, sqlite3.connect(":memory:", isolation_level=None) as db:
            db.executescript("""CREATE TABLE campaigns(id,status);
                CREATE TABLE campaign_local_budget(campaign,remaining_seconds);
                CREATE TABLE local_benchmarks(loop_id,spec);
                CREATE TABLE research_loops(id,status);
                CREATE TABLE jobs(id,lane,state,attempts,detail,finished_at);
                INSERT INTO campaigns VALUES ('demo','active');
                INSERT INTO campaign_local_budget VALUES ('demo',19);
                INSERT INTO local_benchmarks VALUES ('test','{"campaign":"demo","timeout":10,"reviewer":null}');
                INSERT INTO research_loops VALUES ('test','active');
                INSERT INTO jobs VALUES ('loop:test:1','Local evidence','queued',0,NULL,NULL);""")
            self.assertTrue(process(db, -1, Path(root)))
            self.assertFalse((Path(root) / "local-evidence").exists())
            self.assertEqual(db.execute("SELECT status FROM campaigns").fetchone()[0], "human_review")
            self.assertEqual(db.execute("SELECT state,attempts FROM jobs").fetchone(), ("failed", 0))
            self.assertEqual(db.execute("SELECT remaining_seconds FROM campaign_local_budget").fetchone()[0], 19)

    def test_prepares_new_data_only_benchmark_with_pinned_executables(self):
        preparer = SCRIPT.with_name("adaptive_app_smoke.py")
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            fixture = base / "fixture.json"
            fixture.write_text(json.dumps({"rows": [0, 7], "queries": [6, 1, 4]}))
            result = subprocess.check_output([sys.executable, str(preparer), str(base / "out"),
                                              "--fixture", str(fixture)])
            package = json.loads(result)
            review = [sys.executable, str(preparer), str(base / "out"), "--review"]
            reviewed = json.loads(subprocess.check_output(review))
            self.assertEqual((reviewed["rows"], reviewed["queries"]), (2, 3))
            for role in ("runner", "auditor"):
                self.assertEqual(hashlib.sha256(Path(package[role]).read_bytes()).hexdigest(),
                                 package[role + "_sha256"])
            evidence = subprocess.check_output([package["runner"]])
            verdict = json.loads(subprocess.check_output([package["auditor"]], input=evidence))
            self.assertEqual(verdict["evidence_sha256"], hashlib.sha256(evidence).hexdigest())
            runner = Path(package["runner"])
            runner.chmod(0o700)
            runner.write_bytes(runner.read_bytes() + b"\n# changed\n")
            manifest = base / "out" / "review.json"
            values = json.loads(manifest.read_bytes())
            values["pins"]["runner"] = hashlib.sha256(runner.read_bytes()).hexdigest()
            manifest.write_text(json.dumps(values))
            self.assertIn(b"differs from the trusted template",
                          subprocess.run(review, capture_output=True).stderr)
            fixture.write_text('{"rows":[true],"queries":[0]}')
            bad = subprocess.run([sys.executable, str(preparer), str(base / "bad"),
                                  "--fixture", str(fixture)], capture_output=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertFalse((base / "bad").exists())

    def test_prepares_and_audits_exact_membership_fixture(self):
        preparer = SCRIPT.with_name("adaptive_app_smoke.py")
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            fixture = base / "member.json"
            fixture.write_text(json.dumps({"family": "membership", "rows": [1024, 1024, 7],
                                           "queries": [1024, 42, 7, 42]}))
            cmd = [sys.executable, str(preparer), str(base / "package")]
            package = json.loads(subprocess.check_output([*cmd, "--fixture", str(fixture)]))
            review = json.loads(subprocess.check_output([*cmd, "--review"]))
            self.assertEqual(review["family"], "membership")
            self.assertEqual(review["review_sha256"], package["review_sha256"])
            subprocess.check_call([*cmd, "--review", "--expected-review-sha256", package["review_sha256"]],
                                  stdout=subprocess.DEVNULL)
            changed = base / "different-package"
            fixture.write_text(json.dumps({"family": "membership", "rows": [1], "queries": [1]}))
            subprocess.check_call([sys.executable, str(preparer), str(changed), "--fixture", str(fixture)],
                                  stdout=subprocess.DEVNULL)
            rejected = subprocess.run([sys.executable, str(preparer), str(changed), "--review",
                                       "--expected-review-sha256", package["review_sha256"]], capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn(b"differs from the separately saved pin", rejected.stderr)
            evidence = subprocess.check_output([package["runner"]])
            self.assertEqual(json.loads(evidence), {
                "mode": "custom", "baseline": [True, False, True, False],
                "indexed": [True, False, True, False], "scan_work": 10, "index_work": 7,
            })
            verdict = json.loads(subprocess.check_output([package["auditor"]], input=evidence))
            self.assertEqual(verdict["outcome"], "pass")
            corrupt = subprocess.run([package["auditor"]], input=evidence.replace(b'"scan_work": 10', b'"scan_work": 9'),
                                     capture_output=True)
            self.assertNotEqual(corrupt.returncode, 0)
    def test_completed_non_codex_followup_round_is_not_enqueued_again(self):
        advance = runpy.run_path(str(SCRIPT))["advance_campaigns"]
        with sqlite3.connect(":memory:", isolation_level=None) as db:
            db.executescript("""CREATE TABLE campaigns(id,status);
                CREATE TABLE campaign_adaptive(campaign,public_brief);
                CREATE TABLE campaign_members(loop_id,campaign,ordinal);
                CREATE TABLE research_loops(id,status);
                CREATE TABLE campaign_trials(campaign,identity,outcome);
                CREATE TABLE local_benchmarks(loop_id,spec);
                CREATE TABLE campaign_proposals(job_id PRIMARY KEY,campaign);
                CREATE TABLE campaign_provider_options(campaign,lane,model,effort);
                CREATE TABLE jobs(id PRIMARY KEY,lane,detail,prompt,model,effort,state DEFAULT 'queued',finished_at);
                INSERT INTO campaigns VALUES ('demo','checkpoint');
                INSERT INTO campaign_adaptive VALUES ('demo','Synthetic brief');
                INSERT INTO campaign_members VALUES ('first','demo',1);
                INSERT INTO research_loops VALUES ('first','done');
                INSERT INTO campaign_trials VALUES ('demo','first','fail');
                INSERT INTO local_benchmarks VALUES ('first','{}');
                INSERT INTO campaign_provider_options VALUES
                    ('demo','claude',NULL,NULL),('demo','deepseek',NULL,NULL);""")
            advance(db)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)
            db.execute("UPDATE campaigns SET status='active'")
            advance(db)
            db.execute("UPDATE jobs SET state='done'")
            advance(db)
            self.assertEqual(db.execute("SELECT id FROM jobs ORDER BY id").fetchall(),
                             [("proposal:demo:auto-after-1:claude",),
                              ("proposal:demo:auto-after-1:deepseek",)])

    def test_followup_proposals_copy_saved_provider_settings(self):
        queue = runpy.run_path(str(SCRIPT))["queue_campaign_proposals"]
        with sqlite3.connect(":memory:") as db:
            db.executescript("""CREATE TABLE campaign_members(loop_id,campaign,ordinal);
                CREATE TABLE research_loops(id,status);
                CREATE TABLE local_benchmarks(loop_id,spec);
                CREATE TABLE campaign_proposals(job_id,campaign);
                CREATE TABLE campaign_provider_options(campaign,lane,model,effort);
                CREATE TABLE jobs(id,lane,detail,prompt,model,effort);
                INSERT INTO campaign_provider_options VALUES ('demo','claude','chosen','high'),
                    ('demo','muse',NULL,'ultra'),
                    ('other','antigravity','unrelated','low');""")
            queue(db, "demo", "after-1", "Public synthetic task")
            self.assertEqual(db.execute("SELECT lane,model,effort FROM jobs ORDER BY lane").fetchall(),
                             [("claude", "chosen", "high"), ("muse", None, "ultra")])

    @unittest.skipUnless(os.getenv("MAABARIUM_LIVE_ADAPTIVE_PILOT") == "1",
                         "uses live Codex and Antigravity subscriptions")
    def test_live_adaptive_catalog_and_sealed_confirmation(self):
        self.managed_benchmark(live=True, campaign=True, decision="catalog-flow")
    def test_preapproved_confirmation_runs_after_restart(self):
        self.managed_benchmark(campaign=True, decision="confirm-auto")

    def test_preapproved_confirmation_rejects_changed_development_evidence(self):
        self.managed_benchmark(campaign=True, decision="confirm-auto-tamper")
    def test_full_adaptive_catalog_with_subscriptions_and_confirmation(self):
        self.managed_benchmark(campaign=True, decision="catalog-flow")
    def test_adaptive_catalog_waits_for_deferred_subscription_across_worker_restarts(self):
        self.managed_benchmark(campaign=True, decision="catalog-flow", defer=True)
    def test_catalog_trial_runs_after_agreement_in_restarted_worker(self):
        self.managed_benchmark(campaign=True, decision="catalog")
    def test_catalog_selection_is_closed_to_unapproved_or_disagreeing_ids(self):
        advance = runpy.run_path(str(SCRIPT))["advance_campaigns"]
        valid = '{"id":"pick","parameters":{"width":4}}'
        invalid = '{"id":"pick","parameters":{"width":40}}'
        duplicate_ids = '{"id":"other","id":"pick","parameters":{"width":4}}'
        duplicate_parameters = '{"id":"pick","parameters":{"width":40,"width":4}}'
        cases = [
                (("pick", "pick"), None, "active"), (("pick", "other"), None, "stopped"),
                (("unknown", "unknown"), None, "stopped"), ((valid, valid), [1, 8], "active"),
                ((invalid, invalid), [1, 8], "stopped"), (("pick", "pick"), [1, 8], "stopped"),
                ((duplicate_ids, valid), [1, 8], "stopped"),
                ((duplicate_parameters, valid), [1, 8], "stopped")]
        lanes = [("codex", "antigravity"), ("claude", "muse"), ("deepseek", "codex")]
        details = runpy.run_path(str(SCRIPT))["PROPOSAL_DETAILS"]
        for pair, (answers, bounds, expected) in ((pair, case) for pair in lanes for case in cases):
            with self.subTest(pair=pair, answers=answers):
                db = sqlite3.connect(":memory:", isolation_level=None)
                db.executescript("""CREATE TABLE campaigns(id TEXT,status TEXT);
                    CREATE TABLE campaign_members(loop_id TEXT,campaign TEXT,ordinal INTEGER);
                    CREATE TABLE research_loops(id TEXT,status TEXT);
                    CREATE TABLE campaign_trials(campaign TEXT,identity TEXT,outcome TEXT);
                    CREATE TABLE campaign_proposals(job_id TEXT,campaign TEXT);
                    CREATE TABLE jobs(id TEXT,lane TEXT,state TEXT,detail TEXT,result TEXT,finished_at INTEGER);
                    CREATE TABLE local_benchmarks(loop_id TEXT,spec TEXT);
                    INSERT INTO campaigns VALUES ('demo','active');
                    INSERT INTO campaign_members VALUES ('pick','demo',1);
                    INSERT INTO research_loops VALUES ('pick','catalog');
                    INSERT INTO local_benchmarks VALUES ('pick','{}');
                    INSERT INTO jobs(id,state) VALUES ('loop:pick:1','queued');""")
                if bounds:
                    db.execute("UPDATE local_benchmarks SET spec=?",
                               (json.dumps({"parameter_bounds": {"width": bounds}}),))
                if pair != lanes[0]:
                    db.execute("CREATE TABLE campaign_provider_options(campaign,lane,model,effort)")
                    db.executemany("INSERT INTO campaign_provider_options VALUES ('demo',?,NULL,NULL)",
                                   [(lane,) for lane in pair])
                for lane, answer in zip(pair, answers):
                    detail = details[lane]
                    job = f"proposal:demo:initial:{lane}"
                    db.execute("INSERT INTO campaign_proposals VALUES (?,'demo')", (job,))
                    db.execute("INSERT INTO jobs(id,lane,state,detail,result) VALUES (?,?,'done',?,?)",
                               (job, lane, detail, answer))
                for _ in range(2):
                    advance(db)
                self.assertEqual(db.execute("SELECT status FROM research_loops").fetchone()[0], expected)
                if expected == "active":
                    expected_spec = {"selected_round": "initial"}
                    if bounds:
                        expected_spec.update(parameter_bounds={"width": bounds}, parameters={"width": 4})
                    self.assertEqual(json.loads(db.execute("SELECT spec FROM local_benchmarks").fetchone()[0]),
                                     expected_spec)
                else:
                    self.assertEqual(db.execute("SELECT status FROM campaigns").fetchone()[0], "human_review")
                db.close()

    def test_adaptive_success_requires_separate_confirmation(self):
        self.managed_benchmark(campaign=True, decision="confirm")

    def test_adaptive_confirmation_rejects_mismatched_panel(self):
        self.managed_benchmark(campaign=True, decision="confirm-tamper")
    def test_adaptive_start_is_explicit_and_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = [sys.executable, str(SCRIPT), "--state", tmp]
            def run(*args):
                return subprocess.check_output([*base, *args], text=True, timeout=10)
            run("campaign-create", "--id", "demo", "--public-target", "Public synthetic comparison")
            self.assertEqual(json.loads(run("status")), [])
            run("campaign-start", "--id", "demo")
            run("campaign-start", "--id", "demo")
            jobs = json.loads(run("status"))
            self.assertEqual({job["id"] for job in jobs}, {
                "proposal:demo:initial:codex", "proposal:demo:initial:antigravity",
            })
            self.assertEqual(json.loads(run("campaign-status", "--id", "demo"))["audited_trials"], 0)

    def test_audited_failure_queues_one_adaptive_proposal_pair(self):
        self.managed_benchmark(campaign=True, decision="adaptive")
    def test_staged_campaign_stops_after_first_win(self):
        self.managed_benchmark(campaign=True, decision="stage")

    def test_staged_campaign_advances_after_audited_failure(self):
        self.managed_benchmark(campaign=True, decision="stage-next")
    def test_campaign_proposals_complete_in_separate_worker_processes(self):
        with tempfile.TemporaryDirectory() as tmp:
            cli = Path(tmp) / "fake-provider"
            cli.write_text(f"""#!{sys.executable}
import json, os, pathlib, sys
args = sys.argv
assert 'OPENAI_API_KEY' not in os.environ and 'GEMINI_API_KEY' not in os.environ
if 'login' in args:
    print('Logged in using ChatGPT')
elif 'models' in args:
    print('gemini-4-neon-low\\tNeon')
elif '--output-last-message' in args:
    assert 'PUBLIC-SYNTHETIC-TARGET' in sys.stdin.read()
    assert args[args.index('--sandbox')+1] == 'read-only'
    pathlib.Path(args[args.index('--output-last-message')+1]).write_text('Codex proposal')
else:
    assert 'PUBLIC-SYNTHETIC-TARGET' in args[args.index('-p')+1]
    assert json.loads(args[args.index('--settings')+1])['useG1Credits'] is False
    print(json.dumps(dict(status='SUCCESS', response='Antigravity proposal')))
""")
            cli.chmod(0o700)
            base = [sys.executable, str(SCRIPT), "--state", str(Path(tmp) / "state"),
                    "--codex", str(cli), "--antigravity", str(cli)]
            def run(*args):
                return subprocess.check_output([*base, *args], text=True, timeout=10,
                    env={**os.environ, "OPENAI_API_KEY": "excluded", "GEMINI_API_KEY": "excluded"})
            run("campaign-create", "--id", "demo")
            run("campaign-propose", "--id", "round-1", "--campaign", "demo",
                "--public-target", "PUBLIC-SYNTHETIC-TARGET")
            for _ in range(3):
                run("tick")
            jobs = json.loads(run("status"))
            self.assertEqual({(j["lane"], j["state"], j["attempts"], j["result"]) for j in jobs},
                             {("codex", "done", 1, "Codex proposal"),
                              ("antigravity", "done", 1, "Antigravity proposal")})
            self.assertEqual(json.loads(run("campaign-status", "--id", "demo"))["audited_trials"], 0)
            runner = Path(tmp) / "runner"
            auditor = Path(tmp) / "auditor"
            for path in (runner, auditor):
                path.write_text("#!/bin/sh\nexit 1\n# " + path.name)
                path.chmod(0o700)
            enqueue = ("local-benchmark-enqueue", "--campaign", "demo", "--id", "trial-1",
                       "--local-title", "Local trial", "--public-target", "Public synthetic check",
                       "--reviewer", "antigravity", "--contract-sha256", "a" * 64,
                       "--runner", str(runner), "--runner-sha256", hashlib.sha256(runner.read_bytes()).hexdigest(),
                       "--auditor", str(auditor), "--auditor-sha256", hashlib.sha256(auditor.read_bytes()).hexdigest())
            with self.assertRaises(subprocess.CalledProcessError):
                run(*enqueue, "--proposal-round", "missing")
            run(*enqueue, "--proposal-round", "round-1")
            with sqlite3.connect(Path(tmp) / "state" / "queue.db") as db:
                raw, = db.execute("SELECT spec FROM local_benchmarks WHERE loop_id='trial-1'").fetchone()
            self.assertEqual(json.loads(raw)["proposal_sha256"], {
                "codex": hashlib.sha256(b"Codex proposal").hexdigest(),
                "antigravity": hashlib.sha256(b"Antigravity proposal").hexdigest(),
            })

    def test_campaign_proposals_are_separate_from_trials_and_stop_with_campaign(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = [sys.executable, str(SCRIPT), "--state", tmp]
            def run(*args):
                return subprocess.run([*base, *args], capture_output=True, text=True, timeout=10)
            self.assertEqual(run("campaign-create", "--id", "demo").returncode, 0)
            proposal = ("campaign-propose", "--id", "round-1", "--campaign", "demo",
                        "--public-target", "Compare two exact synthetic solvers.")
            self.assertEqual(run(*proposal).returncode, 0)
            self.assertNotEqual(run(*proposal).returncode, 0)
            jobs = json.loads(run("status").stdout)
            self.assertEqual({job["lane"] for job in jobs}, {"codex", "antigravity"})
            self.assertEqual(json.loads(run("campaign-status", "--id", "demo").stdout)["audited_trials"], 0)
            self.assertEqual(run("campaign-stop", "--id", "demo").returncode, 0)
            self.assertTrue(all(job["detail"] == "loop stopped" and job["attempts"] == 0
                                for job in json.loads(run("status").stdout)))
            self.assertNotEqual(run(*proposal).returncode, 0)

    def test_campaign_stop_cannot_race_the_worker_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = [sys.executable, str(SCRIPT), "--state", tmp]
            subprocess.run([*base, "campaign-create", "--id", "locked"],
                           check=True, capture_output=True, timeout=10)
            with (root / "worker.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = subprocess.run([*base, "campaign-stop", "--id", "locked"],
                                        capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("worker is active", result.stderr)
            state = subprocess.check_output([*base, "campaign-status", "--id", "locked"],
                                            text=True, timeout=10)
            self.assertEqual(json.loads(state)["status"], "active")

    def test_campaign_real_worker_and_restart(self):
        self.managed_benchmark(campaign=True)

    def test_campaign_bad_audit_is_not_counted(self):
        self.managed_benchmark(campaign=True, damage="bad-audit")

    def test_stopped_campaign_never_launches_pending_trial(self):
        self.managed_benchmark(campaign=True, decision="stop")

    def test_campaign_limit_counts_a_valid_scientific_failure(self):
        self.managed_benchmark(campaign=True, decision="limit")

    def managed_benchmark(self, live=False, damage=None, local_only=False, adaptive=None, decision="accept", campaign=False, defer=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture = root / "runner"
            fixture.write_text(f"""#!{sys.executable}
import json
values = tuple(range(4, 28, 3))
queries = [4, 8, 19, 21, 25, 29]
indexed = set(values)
print(json.dumps(dict(
    baseline=[any(q == v for v in values) for q in queries],
    candidate=[q in indexed for q in queries],
    scan_work=sum(next((i for i, v in enumerate(values, 1) if q == v), len(values)) for q in queries),
    index_work=len(indexed)+len(queries),
)))
""")
            auditor = root / "auditor"
            auditor.write_text(f"""#!{sys.executable}
import hashlib, json, sys
raw = sys.stdin.buffer.read()
report = json.loads(raw)
expected = [True, False, True, False, True, False]
assert report["baseline"] == report["candidate"] == expected
assert report["scan_work"] == 39 and report["index_work"] == 14
print(json.dumps(dict(evidence_sha256=hashlib.sha256(raw).hexdigest(),
    outcome="pass", report="PRIVATE-LOCAL-REPORT. Six matches; 14 versus 39 work units.")))
""")
            expected_gate = adaptive or ("fail" if decision == "limit" else "pass")
            if campaign:
                auditor.write_text(auditor.read_text().split("print(json.dumps")[0] + """
print(json.dumps(dict(contract_sha256="a"*64,
    evidence_sha256=hashlib.sha256(raw).hexdigest(), wrong_answers=0, lost_coverage=0,
    candidate_coverage=6, baseline_coverage=6, teaching_sha256="b"*64,
    baseline_teaching_sha256="b"*64, candidate_total_work=report["index_work"],
    baseline_total_work=report["scan_work"], strongest_comparator=True, complete=True)))
""")
                if decision in ("limit", "adaptive"):
                    auditor.write_text(auditor.read_text().replace('wrong_answers=0', 'wrong_answers=1'))
                if decision in ("stage-next", "catalog-flow"):
                    auditor.write_text(auditor.read_text().replace(
                        'wrong_answers=0', 'wrong_answers=0 if report.get("successor") else 1'))
                if decision == "catalog-flow":
                    auditor.write_text(auditor.read_text().replace(
                        "print(json.dumps(dict(", "from pathlib import Path\n"
                        "parameters = Path('parameters.json')\n"
                        "pins = dict(parameters_sha256=hashlib.sha256(parameters.read_bytes()).hexdigest()) if parameters.exists() else {}\n"
                        "print(json.dumps(dict(**pins, " ))
            if expected_gate == "fail":
                auditor.write_text(auditor.read_text().replace('outcome="pass"', 'outcome="fail"'))
            fake = root / "codex"
            fake.write_text(f"""#!{sys.executable}
import pathlib, sys
if "login" in sys.argv:
    print("Logged in using ChatGPT")
    sys.exit()
prompt = sys.stdin.read()
assert "PRIVATE-LOCAL-REPORT" not in prompt and "PRIVATE-TITLE" not in prompt and '"local_gate": "{expected_gate}"' in prompt
pathlib.Path(sys.argv[sys.argv.index("--output-last-message") + 1]).write_text("Review complete; a handoff needs a human.")
""")
            if decision == "catalog-flow":
                fake.write_text(f"""#!{sys.executable}
import json, pathlib, sys
args = sys.argv
if 'login' in args:
    print('Logged in using ChatGPT')
elif 'models' in args:
    print('gemini-4-neon-low\\tNeon')
else:
    antigravity = '-p' in args
    if not antigravity and pathlib.Path({str(root / "defer-codex")!r}).exists():
        sys.exit(1)
    prompt = args[args.index('-p')+1] if antigravity else sys.stdin.read()
    assert 'PRIVATE-TITLE' not in prompt and 'Matched-learner audit' not in prompt
    choices = json.JSONDecoder().raw_decode(prompt.split('Approved IDs: ', 1)[1])[0] if 'Approved IDs: ' in prompt else []
    answer = ('fresh-public-check' if 'fresh-public-check' in choices else
              json.dumps(dict(id='second',parameters=dict(width=4)))) if choices else 'Review complete'
    if antigravity:
        assert json.loads(args[args.index('--settings')+1])['useG1Credits'] is False
        print(json.dumps(dict(status='SUCCESS', response=answer)))
    else:
        pathlib.Path(args[args.index('--output-last-message')+1]).write_text(answer)
""")
            if damage == "bad-audit":
                text = auditor.read_text().replace("hashlib.sha256(raw).hexdigest()", "'0' * 64")
                auditor.write_text(text)
            for path in (fixture, auditor, fake):
                path.chmod(0o700)
            state = root / "state"
            base = [sys.executable, str(SCRIPT), "--state", str(state),
                    "--codex", "codex" if live else str(fake)]
            if decision == "catalog-flow":
                base += ["--antigravity", os.getenv("MAABARIUM_AGY", "agy") if live else str(fake)]
            def run(*args):
                return subprocess.run([*base, *args], capture_output=True, text=True,
                                      timeout=135 if live else 10)
            def successful(*args):
                result = run(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout
            adaptive_args = ()
            limit = 1 if decision == "limit" else 2
            if campaign:
                create_args = ("--public-target", "Public adaptive brief") if decision in ("adaptive", "confirm", "confirm-tamper", "confirm-auto", "confirm-auto-tamper", "catalog", "catalog-flow") else ()
                if live and decision == "catalog-flow":
                    create_args = ("--public-target",
                        "Public synthetic release test. Prefer the smallest first: when fresh-public-check "
                        "is an available ID, select it. Otherwise select second with width exactly 4. "
                        "Use the stated reply format and do not use tools.")
                successful("campaign-create", "--id", "demo", "--trial-limit", str(limit), *create_args)
                adaptive_args = ("--campaign", "demo", "--contract-sha256", "a" * 64)
                if decision in ("stage", "stage-next"):
                    adaptive_args += ("--stage",)
                if decision in ("catalog", "catalog-flow"):
                    adaptive_args += ("--stage", "--select-by-proposal")
                if decision.startswith("confirm-auto"):
                    sealed = root / "sealed"
                    sealed.write_text(fixture.read_text().replace("baseline=[", "sealed_fixture=True,\n    baseline=["))
                    sealed_auditor = root / "sealed-auditor"
                    sealed_auditor.write_text(auditor.read_text().replace("complete=True",
                        "complete=True, panel_sha256='c'*64, development_evidence_sha256="
                        "hashlib.sha256(open('development.json','rb').read()).hexdigest()"))
                    for executable in (sealed, sealed_auditor):
                        executable.chmod(0o700)
                    plan = root / "sealed-plan.json"
                    plan.write_text(json.dumps(dict(runner=str(sealed), auditor=str(sealed_auditor),
                        runner_sha256=hashlib.sha256(sealed.read_bytes()).hexdigest(),
                        auditor_sha256=hashlib.sha256(sealed_auditor.read_bytes()).hexdigest(), panel_sha256="c"*64)))
                    adaptive_args += ("--confirmation-plan", str(plan))
            if adaptive:
                branches = {}
                for outcome in ("pass", "fail"):
                    successor = root / ("successor-" + outcome)
                    successor.write_text(fixture.read_text() + f"\n# {outcome} branch\n")
                    successor.chmod(0o700)
                    branches[outcome] = dict(title=outcome, runner=str(successor),
                        runner_sha256=hashlib.sha256(successor.read_bytes()).hexdigest(),
                        auditor=str(auditor), auditor_sha256=hashlib.sha256(auditor.read_bytes()).hexdigest())
                manifest = root / "branches.json"
                manifest.write_text(json.dumps(branches))
                adaptive_args = ("--adaptive-branches", str(manifest))
            successful("local-benchmark-enqueue", "--id", "fresh-public-check",
                       "--local-title", "PRIVATE-TITLE",
                       "--public-target", "Public test of exact integer membership: linear scan versus a prebuilt set on six fixed queries, charging set setup and probes.",
                       "--reviewer", "codex", "--runner", str(fixture),
                       "--runner-sha256", hashlib.sha256(fixture.read_bytes()).hexdigest(),
                       "--auditor", str(auditor),
                       "--auditor-sha256", hashlib.sha256(auditor.read_bytes()).hexdigest(), *adaptive_args)
            if campaign:
                if decision == "catalog":
                    successful("campaign-start", "--id", "demo")
                    successful("campaign-start", "--id", "demo")
                    with sqlite3.connect(state / "queue.db") as db:
                        self.assertEqual(db.execute("SELECT status FROM research_loops").fetchone()[0], "catalog")
                        for lane, detail in (("codex", "ChatGPT"),
                            ("antigravity", "Antigravity account; AI credits disabled for run")):
                            prompt, = db.execute("SELECT prompt FROM jobs WHERE id=?",
                                                 (f"proposal:demo:initial:{lane}",)).fetchone()
                            self.assertIn('Approved IDs: ["fresh-public-check"]', prompt)
                            self.assertNotIn(str(fixture), prompt)
                            db.execute("UPDATE jobs SET state='done',detail=?,result='fresh-public-check' WHERE id=?",
                                       (detail, f"proposal:demo:initial:{lane}"))
                    successful("tick")
                    self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")),
                                     {"status": "confirmation_required", "limit": 2, "audited_trials": 1})
                    return
                if decision in ("stage", "stage-next", "catalog-flow"):
                    second = root / "runner-two"
                    source = fixture.read_text().replace("baseline=[", "successor=True,\n    baseline=[")
                    second_args = adaptive_args
                    if decision == "catalog-flow":
                        source = source.replace("import json", "import json\nassert json.load(open('parameters.json')) == {'width': 4}")
                        second_args += ("--parameter-bounds", '{"width":[1,8]}')
                    second.write_text(source)
                    second.chmod(0o700)
                    successful("local-benchmark-enqueue", "--id", "second",
                               "--local-title", "Second", "--public-target", "Public synthetic benchmark",
                               "--reviewer", "codex", "--runner", str(second),
                               "--runner-sha256", hashlib.sha256(second.read_bytes()).hexdigest(),
                               "--auditor", str(auditor),
                               "--auditor-sha256", hashlib.sha256(auditor.read_bytes()).hexdigest(), *second_args)
                if decision == "catalog-flow":
                    successful("campaign-start", "--id", "demo")
                    status = lambda: json.loads(successful("campaign-status", "--id", "demo"))
                    if defer:
                        marker = root / "defer-codex"
                        marker.touch()
                        successful("tick")
                        successful("tick")
                        successful("tick")
                        self.assertEqual(status()["audited_trials"], 0)
                        with sqlite3.connect(state / "queue.db") as db:
                            jobs = db.execute("""SELECT lane,state,attempts,due FROM jobs
                                WHERE id LIKE 'proposal:demo:initial:%' ORDER BY lane""").fetchall()
                            self.assertEqual([row[:3] for row in jobs],
                                             [("antigravity", "done", 1), ("codex", "queued", 1)])
                            self.assertGreater(jobs[1][3], time.time())
                            self.assertFalse((state / "local-evidence").exists())
                            marker.unlink()
                            db.execute("UPDATE jobs SET due=0 WHERE id='proposal:demo:initial:codex'")
                    for _ in range(12):
                        if status()["status"] == "confirmation_required":
                            break
                        successful("tick")
                    self.assertEqual(status(), {"status": "confirmation_required", "limit": 2, "audited_trials": 2})
                    with sqlite3.connect(state / "queue.db") as db:
                        if defer:
                            self.assertEqual(db.execute("""SELECT state,attempts FROM jobs
                                WHERE id='proposal:demo:initial:codex'""").fetchone(), ("done", 2))
                            self.assertEqual(db.execute("SELECT COUNT(*) FROM jobs WHERE lane='deepseek'").fetchone(), (0,))
                        self.assertEqual(db.execute("SELECT identity,outcome FROM campaign_trials ORDER BY rowid").fetchall(),
                                         [("fresh-public-check", "fail"), ("second", "pass")])
                        digest, = db.execute("SELECT evidence_sha256 FROM campaign_trials WHERE outcome='pass'").fetchone()
                        prompt, = db.execute("SELECT prompt FROM jobs WHERE id='proposal:demo:auto-after-1:codex'").fetchone()
                        self.assertIn('Previously rejected public candidate IDs: ["fresh-public-check"]', prompt)
                        self.assertNotIn("PRIVATE-TITLE", prompt)
                    sealed = root / "confirmation"
                    sealed.write_text(second.read_text().replace("successor=True", "successor=True, sealed_fixture=True"))
                    sealed.chmod(0o700)
                    auditor.write_text(auditor.read_text().replace(
                        "complete=True", f"complete=True, panel_sha256={'c' * 64!r}, development_evidence_sha256={digest!r}"))
                    successful("local-benchmark-enqueue", "--id", "confirm",
                               "--campaign", "demo", "--contract-sha256", "a" * 64,
                               "--confirm-panel-sha256", "c" * 64, "--local-title", "Sealed",
                               "--public-target", "Public synthetic check", "--reviewer", "codex",
                               "--runner", str(sealed), "--runner-sha256", hashlib.sha256(sealed.read_bytes()).hexdigest(),
                               "--auditor", str(auditor), "--auditor-sha256", hashlib.sha256(auditor.read_bytes()).hexdigest())
                    successful("tick")
                    self.assertEqual(status(), {"status": "target_achieved", "limit": 2, "audited_trials": 2})
                    return
                if decision == "stop":
                    successful("campaign-stop", "--id", "demo")
                    successful("tick")
                    job, = json.loads(successful("status"))
                    self.assertEqual((job["attempts"], job["detail"]), (0, "loop stopped"))
                    self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")),
                                     {"status": "stopped", "limit": 2, "audited_trials": 0})
                    return
                successful("tick")
                if decision.startswith("confirm-auto"):
                    status = lambda: json.loads(successful("campaign-status", "--id", "demo"))
                    self.assertEqual(status(), {"status": "confirming", "limit": 2, "audited_trials": 1})
                    tampered = decision == "confirm-auto-tamper"
                    if tampered:
                        (state / "local-evidence" / "fresh-public-check" / "runner.json").write_text("{}")
                    successful("tick")
                    self.assertEqual(status(), {"status": "human_review" if tampered else "target_achieved",
                                                "limit": 2, "audited_trials": 1})
                    successful("tick")
                    with sqlite3.connect(state / "queue.db") as db:
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM campaign_confirmations").fetchone()[0], 1)
                    return
                if decision in ("confirm", "confirm-tamper"):
                    status = lambda: json.loads(successful("campaign-status", "--id", "demo"))
                    self.assertEqual(status()["status"], "confirmation_required")
                    with sqlite3.connect(state / "queue.db") as db:
                        digest, = db.execute("SELECT evidence_sha256 FROM campaign_trials").fetchone()
                    fixture.write_text(fixture.read_text().replace(
                        "baseline=[", "sealed_fixture=True,\n    baseline=["))
                    reported_panel = ("d" if decision == "confirm-tamper" else "c") * 64
                    auditor.write_text(auditor.read_text().replace(
                        "complete=True", f"complete=True, panel_sha256={reported_panel!r}, development_evidence_sha256={digest!r}"))
                    successful("local-benchmark-enqueue", "--id", "confirmation",
                               "--local-title", "Sealed confirmation", "--public-target", "Public synthetic check",
                               "--reviewer", "codex", "--runner", str(fixture),
                               "--runner-sha256", hashlib.sha256(fixture.read_bytes()).hexdigest(),
                               "--auditor", str(auditor), "--auditor-sha256", hashlib.sha256(auditor.read_bytes()).hexdigest(),
                               "--confirm-panel-sha256", "c" * 64, *adaptive_args)
                    self.assertEqual(status()["status"], "confirming")
                    successful("tick")
                    self.assertEqual(status(), {"status": "human_review" if decision == "confirm-tamper" else "target_achieved",
                                                "limit": 2, "audited_trials": 1})
                    return
                if decision == "adaptive":
                    db = sqlite3.connect(state / "queue.db")
                    pairs = db.execute("SELECT lane,prompt FROM jobs WHERE id LIKE 'proposal:demo:auto-after-1:%'").fetchall()
                    self.assertEqual({lane for lane, _ in pairs}, {"codex", "antigravity"})
                    for _, prompt in pairs:
                        self.assertIn("Public adaptive brief", prompt)
                        self.assertNotIn("PRIVATE-TITLE", prompt)
                        self.assertNotIn("Matched-learner audit", prompt)
                    self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")),
                                     {"status": "active", "limit": 2, "audited_trials": 1})
                    db.close()
                    return
                if decision == "stage-next":
                    self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")),
                                     {"status": "active", "limit": 2, "audited_trials": 1})
                    successful("tick")
                    self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")),
                                     {"status": "target_achieved", "limit": 2, "audited_trials": 2})
                    return
                expected = {"status": "human_review" if damage or decision == "limit" else "target_achieved",
                            "limit": limit, "audited_trials": 0 if damage else 1}
                self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")), expected)
                successful("tick")
                self.assertEqual(json.loads(successful("campaign-status", "--id", "demo")), expected)
                if decision == "stage":
                    second_job = next(j for j in json.loads(successful("status")) if j["id"] == "loop:second:1")
                    self.assertEqual((second_job["state"], second_job["attempts"]), ("failed", 0))
                return
            if adaptive:
                successful("tick")
                next_args = ("loop-status", "--id", "fresh-public-check-next")
                next_loop = json.loads(successful(*next_args))
                # The successor is selected but held until a human decides.
                self.assertEqual((next_loop["target"], next_loop["phase"]), (adaptive, "held"))
                parent = json.loads(successful("loop-status", "--id", "fresh-public-check"))
                self.assertEqual(parent["phase"], "awaiting_review")
                successful("tick")
                self.assertEqual(json.loads(successful(*next_args))["phase"], "held")
                self.assertEqual(len(json.loads(successful("status"))), 2)
                successful("loop-review", "--id", "fresh-public-check", "--step", "1", "--decision", decision)
                if decision == "stop":
                    self.assertEqual(json.loads(successful(*next_args))["phase"], "stopped")
                    successful("tick")
                    held = [job for job in json.loads(successful("status")) if job["id"].endswith("-next:1")]
                    self.assertEqual((held[0]["state"], held[0]["attempts"]), ("failed", 0))
                    return
                self.assertEqual(json.loads(successful(*next_args))["phase"], "awaiting_job")
                successful("tick")
                self.assertEqual(json.loads(successful(*next_args))["phase"], "awaiting_independent_review")
                successful("tick")
                successful("tick")
                self.assertEqual(json.loads(successful(*next_args))["phase"], "awaiting_review")
                jobs = json.loads(successful("status"))
                self.assertEqual(len(jobs), 3)
                return
            if local_only:
                # Exercise the same persisted spec that desktop setup writes.
                with sqlite3.connect(state / "queue.db") as db:
                    db.execute("UPDATE local_benchmarks SET spec=json_set(spec, '$.reviewer', NULL, '$.public_brief', '')")
                successful("tick")
                successful("tick")
                status = json.loads(successful("loop-status", "--id", "fresh-public-check"))
                self.assertEqual(status["phase"], "awaiting_review")
                self.assertEqual([(job["lane"], job["state"]) for job in json.loads(successful("status"))],
                                 [("Local evidence", "done")])
                return
            if damage is not None:
                if damage == "identity":
                    fixture.write_text("Changed after enqueue")
                if damage == "interrupted":
                    with sqlite3.connect(state / "queue.db") as db:
                        db.execute("UPDATE jobs SET state='running', attempts=1")
                successful("tick")
                self.assertEqual(json.loads(successful("loop-status", "--id", "fresh-public-check"))["phase"], "blocked")
                self.assertEqual(len(json.loads(successful("status"))), 1)
                return
            successful("tick")
            status_args = ("loop-status", "--id", "fresh-public-check")
            self.assertEqual(json.loads(successful(*status_args))["phase"], "awaiting_independent_review")
            jobs = json.loads(successful("status"))
            self.assertIn("14 versus 39", jobs[0]["result"])
            self.assertNotIn("PRIVATE-LOCAL-REPORT", jobs[1]["prompt"])
            self.assertTrue((state / "local-evidence/fresh-public-check/hashes.json").is_file())
            self.assertNotEqual(run("loop-review", "--id", "fresh-public-check", "--step", "1",
                                    "--decision", "accept").returncode, 0)
            successful("tick")  # A new worker process must resume the queued review.
            self.assertEqual(json.loads(successful(*status_args))["phase"], "awaiting_review")
            jobs = json.loads(successful("status"))
            self.assertEqual([(job["lane"], job["state"], job["attempts"]) for job in jobs],
                             [("Local evidence", "done", 1), ("codex", "done", 1)])

    def test_managed_local_benchmark_reaches_human_checkpoint(self):
        self.managed_benchmark()

    def test_adaptive_benchmark_runs_only_the_selected_successor(self):
        for outcome in ("pass", "fail"):
            with self.subTest(outcome=outcome):
                self.managed_benchmark(adaptive=outcome)

    def test_adaptive_successor_never_runs_when_the_parent_is_stopped(self):
        self.managed_benchmark(adaptive="pass", decision="stop")

    def test_managed_local_only_benchmark_never_queues_ai_review(self):
        self.managed_benchmark(local_only=True)

    def test_managed_local_benchmark_rejects_changed_identity(self):
        self.managed_benchmark(damage="identity")

    def test_managed_local_benchmark_rejects_unbound_audit(self):
        self.managed_benchmark(damage="bad-audit")

    def test_managed_local_benchmark_does_not_retry_an_interrupted_run(self):
        self.managed_benchmark(damage="interrupted")

    @unittest.skipUnless(os.getenv("MAABARIUM_LIVE_BENCHMARK_REVIEW") == "1", "uses a live subscription")
    def test_live_managed_benchmark_review(self):
        self.managed_benchmark(live=True)

    def test_local_checkpoint_is_visible_and_never_routes_to_a_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "must-not-run"
            cli.write_text("#!/bin/sh\ntouch \"$0.called\"\nexit 1\n")
            cli.chmod(0o700)
            base = [sys.executable, str(SCRIPT), "--state", tmp, "--codex", str(cli)]
            def run(*args):
                return subprocess.run([*base, *args], capture_output=True, text=True, timeout=5)
            report = root / "audit.txt"
            report.write_text("Independent local audit: both baselines evaluated.")
            start = ("local-checkpoint-start", "--id", "local-pilot", "--local-title", "Local pilot")
            finish = ("local-checkpoint-finish", "--id", "local-pilot", "--result-file", str(report))
            self.assertEqual(run(*start).returncode, 0)
            self.assertNotEqual(run(*start).returncode, 0)
            self.assertEqual(run("tick").returncode, 0)
            self.assertFalse(Path(f"{cli}.called").exists())
            self.assertNotEqual(run("export-task", "--id", "loop:local-pilot:1").returncode, 0)
            self.assertEqual(run(*finish).returncode, 0)
            self.assertNotEqual(run(*finish).returncode, 0)
            status = json.loads(run("loop-status", "--id", "local-pilot").stdout)
            self.assertEqual((status["phase"], status["lane"]), ("awaiting_review", "Local evidence"))
            jobs = json.loads(run("status").stdout)
            self.assertEqual((len(jobs), jobs[0]["attempts"], jobs[0]["result"]), (1, 0, report.read_text()))

    def test_paid_deepseek_is_bounded_and_never_retries_an_interrupted_charge(self):
        script = runpy.run_path(str(SCRIPT))
        request = script["deepseek_request"]
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": "Independent review"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 15},
        }).encode()
        with patch.dict(request.__globals__, {"build_opener": lambda *_: opener}):
            result, usage = request("fake-test-key", "public prompt", "deepseek-v4-pro", "high")
        self.assertEqual(result, "Independent review")
        self.assertEqual(json.loads(usage), {"input": 10, "output": 15})
        sent = opener.open.call_args.args[0]
        self.assertEqual(sent.full_url, "https://api.deepseek.com/chat/completions")
        self.assertEqual(json.loads(sent.data)["max_tokens"], 2048)
        self.assertEqual(json.loads(sent.data)["reasoning_effort"], "high")
        for effort in (None, "none"):
            with patch.dict(request.__globals__, {"build_opener": lambda *_: opener}):
                request("fake-test-key", "public prompt", "deepseek-flash", effort)
            body = json.loads(opener.open.call_args.args[0].data)
            self.assertEqual(body["model"], "deepseek-flash")
            self.assertEqual(body["thinking"], {"type": "disabled"})
            self.assertEqual(body.get("reasoning_effort"), effort)
        self.assertTrue(script["valid_selection"]("deepseek", "deepseek-flash", "none"))
        run = script["run_deepseek"]
        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE jobs(id,state,finished_at,detail)")
            db.execute("INSERT INTO jobs VALUES ('paid','running',NULL,NULL)")
            with patch.dict(run.__globals__, {"deepseek_request": MagicMock(side_effect=AssertionError)}):
                run(db, "paid", 1, "public prompt", None, None)
            state, detail = db.execute("SELECT state,detail FROM jobs").fetchone()
        self.assertEqual(state, "failed")
        self.assertIn("not retried", detail)

    def test_model_selection_preserves_provider_specific_arguments(self):
        script = runpy.run_path(str(SCRIPT))
        valid, apply = script["valid_selection"], script["apply_selection"]
        self.assertFalse(valid("codex", "--override", "high"))
        self.assertFalse(valid("antigravity", "gemini-pro-orchestrator-neon", "high"))
        self.assertFalse(valid("claude", "opus", "ultra"))
        self.assertTrue(valid("claude", "opus", "high"))
        self.assertEqual(apply(["codex", "exec", "-"], "codex", "example-model", "high"),
                         ["codex", "exec", "--model", "example-model", "-c", 'model_reasoning_effort="high"', "-"])
        self.assertEqual(apply(["muse", "exec", "--", "prompt"], "muse", "wonder", "high"),
                         ["muse", "exec", "--model", "wonder", "--reasoning-effort", "high", "--", "prompt"])
        self.assertEqual(apply(["claude", "-p"], "claude", "opus", "medium"),
                         ["claude", "--model", "opus", "--effort", "medium", "-p"])
        self.assertEqual(apply(["agy", "--model", "neon", "-p", "prompt"], "antigravity", "neon", "high"),
                         ["agy", "--effort", "high", "--model", "neon", "-p", "prompt"])

    def test_usage_counters_distinguish_zero_from_not_reported(self):
        parse = runpy.run_path(str(SCRIPT))["reported_usage"]
        self.assertIsNone(parse("claude", {"usage": {"input_tokens": True, "output_tokens": -1}}))
        self.assertEqual(json.loads(parse("claude", {"usage": {
            "input_tokens": 42, "output_tokens": 0, "cache_read_input_tokens": 17,
            "unrecognized": 99,
        }})), {"input": 42, "output": 0, "cached": 17})
        self.assertEqual(json.loads(parse("antigravity", {"usage": {"thinking_tokens": 10}})), {"reasoning": 10})
        stream = runpy.run_path(str(SCRIPT))["stream_usage"]
        event = json.dumps({"type": "turn.completed", "usage": {"input_tokens": 20}})
        self.assertEqual(json.loads(stream("codex", event)), {"input": 20})
        self.assertIsNone(stream("codex", event + "\n" + event))
        self.assertEqual(json.loads(stream("muse", json.dumps({
            "payload_type": "run.usage", "payload": {"models": [
                {"input_tokens": 5, "output_tokens": 2}, {"input_tokens": 3},
            ]},
        }))), {"input": 8})

    def test_autonomous_checkpoint_pauses_and_final_step_needs_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "unused-codex"
            cli.write_text("#!/bin/sh\nexit 1\n")
            cli.chmod(0o700)
            cmd = [sys.executable, str(SCRIPT), "--state", tmp, "--codex", str(cli)]
            def run(*args):
                return subprocess.check_output([*cmd, *args], timeout=5)
            run("loop-start", "--id", "batch", "--public-target", "Public test",
                "--plan", "muse", "muse", "muse", "--review-every", "2")
            answer = root / "answer"
            answer.write_text("Synthetic result")
            for step, expected_count in ((1, 2), (2, 2), (3, 3)):
                run("import-result", "--id", f"loop:batch:{step}", "--result-file", str(answer))
                if step == 1:
                    run("tick")
                    self.assertEqual(len(json.loads(run("status"))), 1)
                    self.assertEqual(json.loads(run("loop-status", "--id", "batch"))["phase"], "awaiting_review")
                    # Simulate a verified completion in this disposable queue.
                    with sqlite3.connect(root / "queue.db") as db:
                        db.execute("UPDATE jobs SET attempts=1,detail=? WHERE id='loop:batch:1'",
                                   ("Muse browser account; API-key overrides excluded",))
                run("tick")
                run("tick")
                self.assertEqual(len(json.loads(run("status"))), expected_count)
                if step >= 2:
                    self.assertEqual(json.loads(run("loop-status", "--id", "batch"))["phase"], "awaiting_review")
                    run("loop-review", "--id", "batch", "--step", str(step), "--decision", "accept")
            self.assertEqual(json.loads(run("loop-status", "--id", "batch"))["status"], "done")

    def test_muse_only_honours_subscription_quota_reset_records(self):
        reset = runpy.run_path(str(SCRIPT))["muse_quota_reset"]
        reason = "API error 429: Subscription quota exhausted. Your usage window resets at 2026-11-23T00:00:00Z. (rate_limit_error)"
        self.assertEqual(reset(json.dumps({"payload_type": "run.terminal.failed", "payload": {"reason": reason}})),
                         1795392000)
        self.assertIsNone(reset(json.dumps({"payload_type": "run.terminal.completed", "payload": {"text": reason}})))

    def test_both_modes_wait_for_local_verdict_then_run_one_separate_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "fake-claude"
            cli.write_text(f"""#!{sys.executable}
import json, os, sys
assert 'ANTHROPIC_API_KEY' not in os.environ
if 'auth' in sys.argv:
    print(json.dumps(dict(loggedIn=True, authMethod='claude.ai', apiProvider='firstParty', subscriptionType='pro')))
else:
    assert sys.argv[1:5] == ['--model', 'opus', '--effort', 'high']
    prompt = sys.stdin.read()
    assert 'Synthetic result' in prompt and 'private candidate' not in prompt
    assert '"outcome": "fail"' in prompt
    print(json.dumps(dict(subtype='success', is_error=False, result='Try a separate control.')))
""")
            cli.chmod(0o700)
            cmd = [sys.executable, str(SCRIPT), "--state", tmp, "--codex", str(cli)]
            def run(*args):
                return subprocess.run([*cmd, *args], timeout=5, capture_output=True, text=True)
            self.assertEqual(run("loop-start", "--id", "both", "--public-target", "Public target",
                                 "--plan", "muse").returncode, 0)
            with sqlite3.connect(root / "queue.db") as db:
                db.execute("INSERT INTO research_reviewers VALUES (?,?)",
                           ("both", json.dumps(dict(lane="claude", model="opus", effort="high"))))
                db.execute("INSERT INTO research_evaluations(loop_id,rule,candidate) VALUES (?,?,?)",
                           ("both", "{}", "private candidate"))
            answer = root / "answer"
            answer.write_text("Synthetic result")
            self.assertEqual(run("import-result", "--id", "loop:both:1", "--result-file", str(answer)).returncode, 0)
            accept = ("loop-review", "--id", "both", "--step", "1", "--decision", "accept")
            self.assertEqual(run("tick").returncode, 0)
            self.assertEqual(len(json.loads(run("status").stdout)), 1)
            self.assertIn("check the evidence", run(*accept).stderr)
            verdict = json.dumps(dict(outcome="fail", baseline_work="100", candidate_work="110"))
            with sqlite3.connect(root / "queue.db") as db:
                db.execute("UPDATE research_evaluations SET verdict=?", (verdict,))
            self.assertEqual(run("tick").returncode, 0)
            self.assertIn("wait for the AI review", run(*accept).stderr)
            review = run("--claude", str(cli), "tick")
            self.assertEqual(review.returncode, 0, review.stderr)
            self.assertEqual(run("tick").returncode, 0)
            with sqlite3.connect(root / "queue.db") as db:
                self.assertEqual(db.execute("SELECT state,result FROM jobs WHERE id='loop:both:review'").fetchone(),
                                 ("done", "Try a separate control."))
                self.assertEqual(db.execute("SELECT verdict FROM research_evaluations").fetchone(), (verdict,))
                self.assertEqual(db.execute("SELECT count(*) FROM jobs").fetchone(), (2,))
            self.assertEqual(run(*accept).returncode, 0)

    def test_opt_in_account_lanes_recover_abandoned_claim_without_fallback(self):
        for lane in ("claude", "antigravity", "muse"):
            with self.subTest(lane=lane), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                cli = root / "fake"
                marker = root / "first"
                cli.write_text(f"""#!{sys.executable}
import json, os, pathlib, sys, time
assert 'ANTHROPIC_API_KEY' not in os.environ and 'GEMINI_API_KEY' not in os.environ
assert 'META_API_KEY' not in os.environ and 'MUSE_AUTH_PATH' not in os.environ
lane = {lane!r}
if 'serve' in sys.argv:
    for line in sys.stdin:
        request = json.loads(line)
        if 'id' not in request:
            continue
        result = (dict(experimentalApi=True, schema=dict(fingerprint='fake'))
                  if request['method'] == 'initialize' else dict(state='accountLogin'))
        print(json.dumps(dict(jsonrpc='2.0', id=request['id'], result=result)), flush=True)
elif 'auth' in sys.argv:
    print(json.dumps(dict(loggedIn=True, authMethod='claude.ai', apiProvider='firstParty', subscriptionType='pro')))
elif 'models' in sys.argv:
    print('gemini-4-neon-low\\tNeon')
else:
    if lane == 'antigravity':
        assert json.loads(sys.argv[sys.argv.index('--settings') + 1])['useG1Credits'] is False
        assert '--sandbox' in sys.argv
    elif lane == 'claude':
        assert sys.argv[sys.argv.index('--tools') + 1] == ''
    else:
        assert sys.argv[sys.argv.index('--provider') + 1] == 'meta'
        assert sys.argv[sys.argv.index('--contributor-mode') + 1] == 'off'
    marker = pathlib.Path({str(marker)!r})
    if not marker.exists():
        marker.touch()
        time.sleep(1)
    if lane == 'muse':
        print(json.dumps(dict(payload_type='run.terminal.completed', payload=dict(terminal='completed', text='Recovered'))))
    else:
        print(json.dumps(dict(status='SUCCESS', response='Recovered', subtype='success', is_error=False, result='Recovered')))
""")
                cli.chmod(0o700)
                command = [sys.executable, str(SCRIPT), "--state", str(root / "state"), "--codex", str(cli)]
                env = {**os.environ, "ANTHROPIC_API_KEY": "excluded", "GEMINI_API_KEY": "excluded",
                       "META_API_KEY": "excluded", "MUSE_AUTH_PATH": "/excluded"}
                subprocess.run([*command, "enqueue", "--id", "job", "--lane", lane], check=True)
                subprocess.run([*command, "tick"], check=True)
                self.assertFalse(marker.exists())
                tick = [*command, "tick", f"--{lane}", str(cli)]
                first = subprocess.Popen(tick, env=env)
                try:
                    until = time.monotonic() + 4
                    while not marker.exists() and time.monotonic() < until:
                        time.sleep(0.01)
                    self.assertTrue(marker.exists())
                finally:
                    if first.poll() is None:
                        first.kill()
                    first.wait(timeout=5)
                def status():
                    return json.loads(subprocess.check_output([*command, "status"], timeout=5))[0]
                self.assertEqual(status()["state"], "running")
                until = time.monotonic() + 5
                while status()["state"] != "done" and time.monotonic() < until:
                    subprocess.run(tick, env=env, check=True, timeout=5)
                    time.sleep(0.05)
                row = status()
                self.assertEqual((row["state"], row["attempts"], row["result"]), ("done", 2, "Recovered"))

    def test_guardian_releases_lock_when_provider_hangs(self):
        guard = runpy.run_path(str(SCRIPT))["GUARD"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "worker.lock"
            with path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                guardian = subprocess.Popen(
                    [sys.executable, "-I", "-c", guard, "1", sys.executable, "-c", "import time; time.sleep(30)"],
                    pass_fds=(lock.fileno(),), start_new_session=True,
                )
            with guardian, path.open("a") as next_worker:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(next_worker, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(guardian.wait(timeout=4), -signal.SIGKILL)
                fcntl.flock(next_worker, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_loop_review_is_durable_and_cannot_skip_a_step(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = [sys.executable, str(SCRIPT), "--state", tmp]

            def run(*args, check=True):
                return subprocess.run([*command, *args], check=check, capture_output=True, text=True, timeout=5)

            run("loop-start", "--id", "sample", "--public-target", "Compare two public rules",
                "--plan", "muse", "antigravity", "claude", "codex")
            self.assertNotEqual(run("loop-review", "--id", "sample", "--step", "1",
                                    "--decision", "accept", check=False).returncode, 0)
            answer = Path(tmp) / "answer"
            answer.write_text("Synthetic answer")
            for step, lane in enumerate(("muse", "antigravity", "claude"), 1):
                task = f"loop:sample:{step}"
                payload = json.loads(run("export-task", "--id", task).stdout)
                self.assertEqual(payload["lane"], lane)
                self.assertIn("Compare two public rules", payload["prompt"])
                run("import-result", "--id", task, "--result-file", str(answer))
                run("loop-review", "--id", "sample", "--step", str(step), "--decision", "accept")
                self.assertNotEqual(run("loop-review", "--id", "sample", "--step", str(step),
                                        "--decision", "accept", check=False).returncode, 0)
            run("loop-review", "--id", "sample", "--step", "4", "--decision", "stop")
            self.assertEqual(json.loads(run("loop-status", "--id", "sample").stdout)["status"], "stopped")
            jobs = json.loads(run("status").stdout)
            self.assertEqual([(job["lane"], job["state"]) for job in jobs],
                             [("muse", "done"), ("antigravity", "done"), ("claude", "done"), ("codex", "failed")])

    def test_migrates_and_keeps_external_jobs_out_of_the_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with sqlite3.connect(root / "queue.db") as db:
                db.execute("""CREATE TABLE jobs (
                    id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
                    attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
                    detail TEXT, result TEXT)""")
                db.execute("INSERT INTO jobs(id,state) VALUES ('old','done')")
            cli = root / "fake-codex"
            marker = root / "called"
            cli.write_text(f"#!{sys.executable}\nimport pathlib\npathlib.Path({str(marker)!r}).touch()\n")
            cli.chmod(0o700)
            command = [sys.executable, str(SCRIPT), "--state", tmp, "--codex", str(cli)]
            answer = root / "answer"
            answer.write_text("Synthetic answer")
            for lane in ("claude", "antigravity", "muse"):
                subprocess.check_call([*command, "enqueue", "--id", lane, "--lane", lane])
                task = json.loads(subprocess.check_output([*command, "export-task", "--id", lane]))
                self.assertEqual((task["id"], task["lane"]), (lane, lane))
            subprocess.check_call([*command, "tick"])
            self.assertFalse(marker.exists())
            for lane in ("claude", "antigravity", "muse"):
                subprocess.check_call([*command, "import-result", "--id", lane, "--result-file", str(answer)])
            rows = {row["id"]: row for row in json.loads(subprocess.check_output([*command, "status"]))}
            self.assertEqual(rows["old"]["lane"], "codex")
            for lane in ("claude", "antigravity", "muse"):
                self.assertEqual((rows[lane]["state"], rows[lane]["attempts"], rows[lane]["result"]),
                                 ("done", 0, "Synthetic answer"))

    def test_subscription_failure_retries_same_job_and_api_login_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            cli = root / "fake-codex"
            mode = root / "mode"
            mode.write_text("api")
            cli.write_text(f"""#!{sys.executable}
import pathlib, sys
mode = pathlib.Path({str(mode)!r}).read_text()
if "login" in sys.argv:
    print("Logged in using API key" if mode == "api" else "Logged in using ChatGPT")
    sys.exit()
if mode == "quota":
    sys.exit(1)
assert mode == "ready", "non-subscription job executed"
pathlib.Path(sys.argv[sys.argv.index("--output-last-message") + 1]).write_text("Recovered")
""")
            cli.chmod(0o700)
            command = [sys.executable, str(SCRIPT), "--state", str(state), "--codex", str(cli)]

            def run(action):
                return subprocess.check_output([*command, action], timeout=5)

            def ready_now():
                with sqlite3.connect(state / "queue.db") as db:
                    db.execute("UPDATE jobs SET due=0")

            run("enqueue")
            run("tick")
            self.assertEqual(json.loads(run("status"))[0]["attempts"], 0)
            mode.write_text("quota")
            ready_now()
            run("tick")
            deferred = json.loads(run("status"))[0]
            self.assertEqual((deferred["state"], deferred["attempts"]), ("queued", 1))
            self.assertGreater(deferred["due"], time.time())
            run("tick")
            self.assertEqual(json.loads(run("status"))[0], deferred)
            mode.write_text("ready")
            ready_now()
            run("tick")
            rows = json.loads(run("status"))
            self.assertEqual(len(rows), 1)
            self.assertEqual((rows[0]["state"], rows[0]["attempts"], rows[0]["result"]),
                             ("done", 2, "Recovered"))

            mode.write_text("quota")
            subprocess.check_output([*command, "enqueue", "--id", "exhausted"], timeout=5)
            for _ in range(5):
                ready_now()
                run("tick")
            exhausted = next(row for row in json.loads(run("status")) if row["id"] == "exhausted")
            self.assertEqual((exhausted["state"], exhausted["attempts"]), ("failed", 4))

    def test_interrupted_worker_resumes_without_api_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "fake-codex"
            marker = root / "first"
            cli.write_text(f"""#!{sys.executable}
import os, pathlib, sys, time
assert "OPENAI_API_KEY" not in os.environ
assert 'forced_login_method="chatgpt"' in sys.argv
if "login" in sys.argv:
    print("Logged in using ChatGPT")
    sys.exit()
marker = pathlib.Path({str(marker)!r})
if not marker.exists():
    marker.touch()
    time.sleep(1)
out = pathlib.Path(sys.argv[sys.argv.index("--output-last-message") + 1])
out.write_text("Synthetic counterexample")
""")
            cli.chmod(0o700)
            command = [sys.executable, str(SCRIPT), "--state", str(root / "state"), "--codex", str(cli)]
            env = {**os.environ, "OPENAI_API_KEY": "should-not-reach-child"}
            subprocess.run([*command, "enqueue"], check=True)
            first = subprocess.Popen([*command, "tick"], env=env)
            try:
                until = time.monotonic() + 5
                while not marker.exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue(marker.exists())
                first.send_signal(signal.SIGKILL)
                first.wait(timeout=5)
            finally:
                if first.poll() is None:
                    first.kill()
                    first.wait(timeout=5)
            status = lambda: json.loads(subprocess.check_output([*command, "status"]))[0]
            self.assertEqual(status()["state"], "running")
            until = time.monotonic() + 5
            while status()["state"] != "done" and time.monotonic() < until:
                subprocess.run([*command, "tick"], env=env, check=True, timeout=5)
                time.sleep(0.05)
            subprocess.run([*command, "enqueue"], check=True)
            self.assertEqual(status()["attempts"], 2)
            self.assertEqual(status()["result"], "Synthetic counterexample")

    def test_hung_orphan_is_stopped_and_job_recovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "state"
            cli = root / "fake-codex"
            marker = root / "first"
            cli.write_text(f"""#!{sys.executable}
import pathlib, sys, time
if "login" in sys.argv:
    print("Logged in using ChatGPT")
    sys.exit()
marker = pathlib.Path({str(marker)!r})
if not marker.exists():
    marker.touch()
    time.sleep(600)  # hangs far past its deadline
pathlib.Path(sys.argv[sys.argv.index("--output-last-message") + 1]).write_text("Recovered")
""")
            cli.chmod(0o700)
            command = [sys.executable, str(SCRIPT), "--state", str(state), "--codex", str(cli),
                       "--child-timeout", "1"]
            status = lambda: json.loads(subprocess.check_output([*command, "status"]))[0]
            subprocess.run([*command, "enqueue"], check=True)
            first = subprocess.Popen([*command, "tick"])
            try:
                until = time.monotonic() + 5
                while not marker.exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue(marker.exists())
                first.send_signal(signal.SIGKILL)
                first.wait(timeout=5)
            finally:
                if first.poll() is None:
                    first.kill()
                    first.wait(timeout=5)
            self.assertTrue((state / "scratch").exists())
            until = time.monotonic() + 10
            while status()["state"] != "done" and time.monotonic() < until:
                subprocess.run([*command, "tick"], check=True, timeout=10)
                time.sleep(0.05)
            row = status()
            self.assertEqual((row["state"], row["result"]), ("done", "Recovered"))
            self.assertFalse(any((state / "scratch").glob("**/answer.txt")))

    def test_unrelated_process_is_never_killed(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state"
            command = [sys.executable, str(SCRIPT), "--state", str(state), "--codex", sys.executable]
            subprocess.run([*command, "enqueue"], check=True)
            bystander = subprocess.Popen(["sleep", "30"], start_new_session=True)
            try:
                lock = (state / "worker.lock").open("a")
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                subprocess.run([*command, "tick"], check=True, timeout=15)
                self.assertIsNone(bystander.poll())
                lock.close()
            finally:
                bystander.kill()
                bystander.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
