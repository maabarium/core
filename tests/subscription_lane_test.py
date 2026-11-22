import json
import fcntl
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
