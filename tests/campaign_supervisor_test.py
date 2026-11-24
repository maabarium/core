"""End-to-end supervisor tests with stub subscription clients and real local children."""

import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/subscription_lane.py"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class SupervisorTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state = self.root / "state"
        self.provider = self.executable("provider", """
import json, pathlib, re, sys
args = sys.argv[1:]
if "login" in args:
    print("Logged in using ChatGPT")
elif args == ["models"]:
    print("gemini-4-neon-low\\tAvailable")
elif "-p" in args:
    prompt = args[args.index("-p")+1]
    assert "Public proposal: " in prompt and "vetter_sha256" not in prompt
    print(json.dumps({"status":"SUCCESS", "response":"APPROVE"}))
else:
    prompt = sys.stdin.read()
    assert "Do not repeat these previously vetted IDs: " in prompt
    prior = json.loads(prompt.split("Do not repeat these previously vetted IDs: ")[-1])
    number = 1 + max([0] + [int(p.split("-")[-1]) for p in prior])
    answer = dict(id=f"test-{number}", mechanism="Use exact teaching",
                  hypothesis="Count fewer operations", control="Exact lazy",
                  rejection_test="Compare all answers and count all work")
    pathlib.Path(args[args.index("--output-last-message")+1]).write_text(json.dumps(answer))
""")

    def executable(self, name, source):
        path = self.root / name
        path.write_text(f"#!{sys.executable}\n" + source, encoding="utf-8")
        path.chmod(0o700)
        return path

    def cli(self, *args, **kwargs):
        return subprocess.run([sys.executable, str(SCRIPT), "--state", str(self.state),
            "--codex", str(self.provider), "--antigravity", str(self.provider), *args],
            capture_output=True, text=True, timeout=20, check=kwargs.get("check", True))

    def query(self, statement):
        with sqlite3.connect(self.state / "queue.db") as db:
            return db.execute(statement).fetchall()

    def status(self):
        return json.loads(self.cli("campaign-status", "--id", "test").stdout)

    def launch(self, mode="normal", limit=4, rounds=5):
        vetter = self.executable("vetter", rf"""
import hashlib, json, pathlib, sys
proposal = json.load(sys.stdin)
number = int(proposal["id"].split("-")[-1])
mode = {mode!r}
sha = lambda data: hashlib.sha256(data).hexdigest()
if number == 1:
    print(json.dumps(dict(outcome="reject")))
    sys.exit(0)
if mode == "error":
    sys.exit(3)
panel = sha(f"development-{{2 if mode == 'reuse-panel' else number}}".encode())
sealed = sha(f"confirmation-{{number}}".encode())
stages = {{}}
for stage in ("development", "confirmation"):
    programs = {{}}
    for role in ("runner", "auditor"):
        path = pathlib.Path(f"{{stage}}-{{role}}")
        if role == "runner":
            code = f"import json; print(json.dumps([{{number}}, {{stage!r}}]))"
        else:
            wrong = int(mode == "always-fail" or (number == 2 and
                        (mode != "sealed-fail" or stage == "confirmation")))
            code = f'''
import hashlib, json, pathlib, sys
sha = lambda data: hashlib.sha256(data).hexdigest()
raw = sys.stdin.buffer.read()
assert json.loads(raw) == [{{number}}, {{stage!r}}]
spec = json.loads(pathlib.Path("spec.json").read_bytes())
report = dict(contract_sha256=spec["contract_sha256"], evidence_sha256=sha(raw),
    complete=True, parameters_sha256=sha(pathlib.Path("parameters.json").read_bytes()),
    metrics=dict(wrong={{wrong}}), panel_sha256={{(sealed if stage == "confirmation" else panel)!r}})
if {{stage == "confirmation"}}:
    prior = pathlib.Path("development.json").read_bytes()
    assert json.loads(prior) == [{{number}}, "development"]
    report["development_evidence_sha256"] = sha(prior)
print(json.dumps(report))
'''
        path.write_text(f"#!{{sys.executable}}\n" + code + "\n")
        path.chmod(0o700)
        programs[role] = path.name
        programs[role+"_sha256"] = sha(path.read_bytes())
    stages[stage] = programs
if mode == "escape":
    stages["development"]["runner"] = "../outside"
if mode == "rules":
    wrong_rule = ["le", 900]
else:
    wrong_rule = ["eq", 0]
template = dict(**stages, timeout=3, bounds={{}}, metrics={{"wrong": wrong_rule}}, panel_sha256=sealed)
print(json.dumps(dict(outcome="admit", template=template, parameters={{}}, development_panel_sha256=panel)))
""")
        raw = json.dumps(dict(schema=3, brief="Public exact teaching", rounds=rounds, trials=limit,
            lifetime_seconds=300, work_seconds=120, vet_timeout=4, vetter=str(vetter),
            vetter_sha256=digest(vetter.read_bytes()), metrics={"wrong": ["eq", 0]})).encode()
        path = self.root / "policy.json"
        path.write_bytes(raw)
        self.cli("campaign-autostart", "--id", "test", "--policy", str(path), "--policy-sha256", digest(raw))
        return vetter

    def converge(self):
        for _ in range(32):
            status = self.status()
            if status["status"] not in ("active", "confirming"):
                return status
            self.cli("tick")
        self.fail("supervisor did not converge")

    def test_reject_fail_then_sealed_success_across_worker_restarts(self):
        self.launch()
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"]), ("target_achieved", 2))
        self.assertEqual(self.query("SELECT state FROM campaign_admissions ORDER BY round"),
                         [("rejected",), ("admitted",), ("admitted",)])
        self.assertEqual(self.query("SELECT distinct lane FROM jobs ORDER BY lane"),
                         [("Local evidence",), ("antigravity",), ("codex",)])
        self.assertEqual(self.query("SELECT outcome FROM campaign_confirmations"), [("pass",)])
        before = self.query("SELECT id, state, attempts FROM jobs ORDER BY id")
        self.cli("tick")
        self.assertEqual(before, self.query("SELECT id, state, attempts FROM jobs ORDER BY id"))

    def test_cap_stops_without_another_proposal(self):
        self.launch(mode="always-fail", limit=1)
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"], status["discovery_rounds"]),
                         ("human_review", 1, 2))
        self.assertEqual(self.query("SELECT count(*) FROM campaign_confirmations"), [(0,)])

    def test_valid_sealed_failure_advances_to_a_distinct_candidate(self):
        self.launch(mode="sealed-fail")
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"]), ("target_achieved", 2))
        self.assertEqual(self.query("SELECT count(*) FROM campaign_confirmation_failures"), [(1,)])
        self.assertEqual(self.query("SELECT outcome FROM campaign_confirmations"), [("pass",)])

    def test_operational_interruption_is_not_replayed(self):
        self.launch()
        for _ in range(10):
            if self.status()["phase"] == "vetting":
                break
            self.cli("tick")
        else:
            self.fail("did not reach vetting")
        self.query("UPDATE campaign_admissions SET state='running'")
        self.cli("tick")
        status = self.status()
        self.assertEqual((status["status"], status["audited_trials"]), ("blocked", 0))
        self.assertFalse((self.state / "campaign-admissions").exists())

    def test_reused_panel_is_not_reopened(self):
        self.launch(mode="reuse-panel")
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"]), ("blocked", 1))
        self.assertEqual(status["last_admission"], {"candidate": "test-3", "state": "blocked"})
        self.assertEqual(self.query("SELECT count(*) FROM local_benchmarks"), [(1,)])

    def test_rejection_does_not_spend_an_audited_trial(self):
        self.launch(rounds=1)
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"]), ("blocked", 0))
        self.assertEqual(status["last_admission"]["state"], "rejected")

    def test_malformed_admissions_never_queue_evidence(self):
        for mode in ("error", "escape", "rules"):
            with self.subTest(mode=mode):
                self.state = self.root / mode
                self.launch(mode)
                status = self.converge()
                self.assertEqual((status["status"], status["audited_trials"]), ("blocked", 0))
                self.assertEqual(status["last_admission"]["state"], "blocked")
                self.assertEqual(self.query("SELECT count(*) FROM local_benchmarks"), [(0,)])

    def test_mutated_vetter_never_runs(self):
        vetter = self.launch()
        vetter.write_text("# changed\n")
        status = self.converge()
        self.assertEqual((status["status"], status["audited_trials"]), ("blocked", 0))
        self.assertEqual(status["last_admission"]["state"], "blocked")


if __name__ == "__main__":
    unittest.main()
