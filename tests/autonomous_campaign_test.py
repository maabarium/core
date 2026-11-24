"""Real queue/worker lifecycle with local fake subscription clients."""

import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/subscription_lane.py"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class AutonomousTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state = self.root / "state"
        self.provider = self.executable("provider", """
import json, pathlib, sys
args = sys.argv[1:]
if "login" in args:
    print("Logged in using ChatGPT")
elif args == ["models"]:
    print("gemini-4-neon-low\tAvailable")
else:
    antigravity = "-p" in args
    prompt = args[args.index("-p") + 1] if antigravity else sys.stdin.read()
    ids, _ = json.JSONDecoder().raw_decode(prompt.split("Approved IDs: ", 1)[1])
    pick = ids[0] if not antigravity or "Disagree" not in prompt else "NONE"
    if antigravity:
        print(json.dumps({"status": "SUCCESS", "response": pick}))
    else:
        pathlib.Path(args[args.index("--output-last-message") + 1]).write_text(pick)
""")

    def executable(self, name, source):
        path = self.root / name
        path.write_text(f"#!{sys.executable}\n" + source)
        path.chmod(0o700)
        return path

    def run_cli(self, *args, check=True):
        return subprocess.run([sys.executable, str(SCRIPT), "--state", str(self.state),
            "--codex", str(self.provider), "--antigravity", str(self.provider), *args],
            capture_output=True, text=True, check=check, timeout=15)

    def status(self):
        return json.loads(self.run_cli("campaign-status", "--id", "test").stdout)

    def policy(self, study, brief="Public synthetic experiment", rounds=4, variants=2, seconds=120):
        stages = {}
        for stage in ("development", "confirmation"):
            sealed = stage == "confirmation"
            run = self.executable(stage + "-runner", f"""
import json
from pathlib import Path
variant = json.loads(Path("parameters.json").read_bytes())["choice"]
if {sealed!r}:
    assert json.loads(Path("development.json").read_bytes())["stage"] == "development"
if {study!r} == "learner":
    facts = [2, 4] if not {sealed!r} else [3, 6]
    queries = [1, 2, 4] if not {sealed!r} else [2, 3, 6]
    learned = set(facts[1:] if variant == 1 else facts)
    answers = [query in learned for query in queries]
else:
    # Each panel uses distinct source IDs and claims. The first method
    # picks one citation by position, the second matches exact evidence.
    sources = {{"r1": "Rain fell", "r2": "The soil dried"}} if not {sealed!r} else {{
        "s1": "The tide rose", "s2": "Snow fell"}}
    claims = list(sources.values())
    answers = [next(iter(sources)) if variant == 1 else
               next(k for k, text in sources.items() if text == claim) for claim in claims]
print(json.dumps(dict(stage={stage!r}, variant=variant, study={study!r}, answers=answers)))
""")
            audit = self.executable(stage + "-auditor", f"""
import hashlib, json, sys
from pathlib import Path
sha = lambda data: hashlib.sha256(data).hexdigest()
raw = sys.stdin.buffer.read()
result = json.loads(raw)
spec = json.loads(Path("spec.json").read_bytes())
params = Path("parameters.json").read_bytes()
assert result["stage"] == {stage!r} and result["study"] == {study!r}
assert result["variant"] == json.loads(params)["choice"]
if {study!r} == "learner":
    expected = [False, True, True]
    assert len(result["answers"]) == len(expected) and all(type(a) is bool for a in result["answers"])
    metrics = {{"wrong_answers": sum(a != b for a, b in zip(result["answers"], expected))}}
else:
    expected = ["s1", "s2"] if {sealed!r} else ["r1", "r2"]
    assert len(result["answers"]) == len(expected)
    metrics = {{"unsupported_citations": sum(a != b for a, b in zip(result["answers"], expected))}}
report = dict(contract_sha256=spec["contract_sha256"], evidence_sha256=sha(raw),
              complete=True, metrics=metrics, parameters_sha256=sha(params))
if {sealed!r}:
    report.update(panel_sha256="a"*64, development_evidence_sha256=sha(Path("development.json").read_bytes()))
print(json.dumps(report))
""")
            stages[stage] = dict(runner=str(run), runner_sha256=sha(run), auditor=str(audit), auditor_sha256=sha(audit))
        policy = self.root / "policy.json"
        policy.write_text(json.dumps(dict(schema=1, brief=brief, rounds=rounds, trials=5,
            lifetime_seconds=seconds, work_seconds=36,
            templates={study: dict(**stages, timeout=3, bounds={"choice": [1, 2]},
                metrics={("wrong_answers" if study == "learner" else "unsupported_citations"): ["eq", 0]},
                panel_sha256="a" * 64)},
            variants={f"choice-{i}": dict(template=study, parameters={"choice": i}, summary=f"Method {i}")
                      for i in range(1, variants + 1)})))
        return policy

    def start(self, policy, pin=None, check=True):
        return self.run_cli("campaign-autostart", "--id", "test", "--policy", str(policy),
                            "--policy-sha256", pin or sha(policy), check=check)

    def converge(self):
        for _ in range(12):
            if self.status()["status"] not in ("active", "confirming"):
                return self.status()
            self.run_cli("tick")
        self.fail("campaign failed to converge")

    def test_restart_between_every_step_in_two_research_domains(self):
        for study in ("learner", "citation"):
            with self.subTest(study=study):
                self.state = self.root / study
                policy = self.policy(study)
                self.assertNotEqual(self.start(policy, "b" * 64, check=False).returncode, 0)
                self.start(policy)
                self.assertEqual(self.status()["phase"], "waiting_for_worker")
                self.assertNotEqual(self.start(policy, check=False).returncode, 0)
                result = self.converge()
                self.assertEqual((result["status"], result["audited_trials"], result["discovery_rounds"]),
                                 ("target_achieved", 2, 2))
                self.run_cli("tick")
                with sqlite3.connect(self.state / "queue.db") as db:
                    self.assertEqual(db.execute("SELECT outcome FROM campaign_trials ORDER BY rowid").fetchall(),
                                     [("fail",), ("pass",)])
                    self.assertEqual(db.execute("SELECT outcome FROM campaign_confirmations").fetchall(), [("pass",)])
                    self.assertEqual(db.execute("SELECT attempts FROM jobs ORDER BY rowid").fetchall(), [(1,)] * 7)

    def test_disagreement_is_bounded_and_never_runs_a_trial(self):
        self.start(self.policy("learner", brief="Disagree", rounds=2))
        result = self.converge()
        self.assertEqual((result["status"], result["audited_trials"], result["discovery_rounds"]),
                         ("blocked", 0, 2))
        self.assertIn("round limit", result["reason"])
        self.assertFalse((self.state / "local-evidence").exists())

    def test_catalog_exhaustion_blocks_instead_of_discovering_forever(self):
        self.start(self.policy("citation", variants=1))
        result = self.converge()
        self.assertEqual((result["status"], result["audited_trials"], result["discovery_rounds"]),
                         ("blocked", 1, 1))
        self.assertIn("needs benchmark preparation", result["reason"])

    def test_changed_executable_fails_closed(self):
        self.start(self.policy("learner"))
        path = self.root / "development-runner"
        path.write_bytes(path.read_bytes() + b"\n# tampered")
        result = self.converge()
        self.assertEqual((result["status"], result["audited_trials"]), ("human_review", 0))
        self.assertIn("identity", result["reason"])

    def test_expired_campaign_cancels_pending_provider_jobs(self):
        self.start(self.policy("learner"))
        self.run_cli("tick")
        with sqlite3.connect(self.state / "queue.db") as db:
            db.execute("UPDATE campaign_autonomy SET deadline=0")
        result = self.converge()
        self.assertEqual((result["status"], result["audited_trials"]), ("blocked", 0))
        self.assertIn("deadline", result["reason"])
        self.assertFalse((self.state / "local-evidence").exists())

    def test_interrupted_trial_is_not_automatically_rerun(self):
        self.start(self.policy("learner"))
        self.run_cli("tick")
        self.run_cli("tick")
        with sqlite3.connect(self.state / "queue.db") as db:
            self.assertEqual(db.execute("UPDATE jobs SET state='running',attempts=1 WHERE lane='Local evidence'").rowcount, 1)
        result = self.converge()
        self.assertEqual((result["status"], result["audited_trials"]), ("human_review", 0))
        self.assertIn("interrupted", result["reason"])
        self.assertFalse((self.state / "local-evidence").exists())


if __name__ == "__main__":
    unittest.main()
