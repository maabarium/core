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


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "subscription_lane.py"


class SubscriptionLaneTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
