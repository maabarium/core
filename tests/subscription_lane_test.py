import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "subscription_lane.py"


class SubscriptionLaneTest(unittest.TestCase):
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
