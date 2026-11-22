#!/usr/bin/env python3
"""Bounded local queue for a ChatGPT-backed public research lane."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
import sys


PROMPT = (
    "Public synthetic research only. Do not use tools or read local files. "
    "For optional Boolean implication rules and labeled assignments, suggest one tiny "
    "counterexample that distinguishes exact consistency from a naive local inference. "
    "Give the example and its answer in under 150 words. No implementation."
)
MAX_ATTEMPTS = 4
LANES = ("codex", "claude", "antigravity", "muse")


def worker(db, codex, lock_fd):
    job = db.execute(
        "SELECT id,attempts FROM jobs WHERE state IN ('queued','running') AND due<=? AND lane='codex' ORDER BY due,id LIMIT 1",
        (int(time.time()),),
    ).fetchone()
    if not job:
        return
    job_id, attempts = job
    if attempts >= MAX_ATTEMPTS:
        db.execute("UPDATE jobs SET state='failed', detail='attempt limit' WHERE id=?", (job_id,))
        return
    # An allowlist intentionally excludes API keys, identity federation and custom endpoints.
    env = {k: os.environ[k] for k in ("HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "CODEX_HOME") if k in os.environ}
    flags = ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"']
    with tempfile.TemporaryDirectory(prefix="maabarium-lane-") as scratch:
        try:
            auth = subprocess.run([codex, *flags, "login", "status"], cwd=scratch, env=env,
                                  capture_output=True, text=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired):
            auth = None
        if not auth or auth.returncode or not any(
            line.strip() == "Logged in using ChatGPT"
            for line in (auth.stdout + "\n" + auth.stderr).splitlines()
        ):
            db.execute("UPDATE jobs SET state='queued', due=?,detail='ChatGPT sign-in required' WHERE id=?",
                       (int(time.time()) + 900, job_id))
            return
        db.execute("UPDATE jobs SET state='running', attempts=attempts+1, detail=NULL WHERE id=?", (job_id,))
        output = Path(scratch) / "answer.txt"
        cmd = [codex, *flags, "-a", "never", "exec", "--ignore-user-config", "--ephemeral",
               "--disable", "shell_tool", "--disable", "hooks", "-c", 'web_search="disabled"',
               "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", str(output), "-"]
        process = None
        try:
            process = subprocess.Popen(cmd, cwd=scratch, env=env, stdin=subprocess.PIPE,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       text=True, start_new_session=True, pass_fds=(lock_fd,))
            process.communicate(PROMPT, timeout=120)
            if process.returncode or not output.is_file() or output.stat().st_size > 16384:
                raise ValueError("no bounded reply")
            result = output.read_text(encoding="utf-8").strip()
            if not result:
                raise ValueError("empty reply")
        except (OSError, ValueError, subprocess.TimeoutExpired):
            if process is not None and process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            if attempts + 1 >= MAX_ATTEMPTS:
                db.execute("UPDATE jobs SET state='failed', detail='attempt limit' WHERE id=?", (job_id,))
            else:
                db.execute(
                    "UPDATE jobs SET state='queued', due=?,detail='runner unavailable; retry scheduled' WHERE id=?",
                    (int(time.time()) + min(3600, 300 * 2 ** attempts), job_id),
                )
            return
        db.execute("UPDATE jobs SET state='done', result=?, detail='ChatGPT' WHERE id=?", (result, job_id))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".maabarium" / "subscription-lane")
    parser.add_argument("--codex", default="codex", help="trusted local Codex CLI")
    parser.add_argument("action", choices=["enqueue", "tick", "status", "launchd-plist", "export-task", "import-result"])
    parser.add_argument("--lane", choices=LANES, default="codex")
    parser.add_argument("--result-file", type=Path)
    parser.add_argument("--id", default="directed-teaching-v1")
    parser.add_argument("--label", default="org.maabarium.subscription-lane")
    args = parser.parse_args()
    os.umask(0o077)
    state = args.state.expanduser().resolve()
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if state.stat().st_uid != os.getuid() or state.stat().st_mode & 0o077:
        parser.error("state directory must be private and owned by the current user")
    if args.action == "launchd-plist":
        codex = shutil.which(args.codex)
        if not codex:
            parser.error("Codex CLI not found")
        job = {
            "Label": args.label,
            "ProgramArguments": [sys.executable, str(Path(__file__).resolve()),
                                 "--state", str(state), "--codex", os.path.abspath(codex), "tick"],
            "RunAtLoad": True,
            "StartInterval": 60,
        }
        if "CODEX_HOME" in os.environ:
            job["EnvironmentVariables"] = {"CODEX_HOME": os.environ["CODEX_HOME"]}
        sys.stdout.buffer.write(plistlib.dumps(job))
        return
    with (state / "worker.lock").open("a") as lock:
        if args.action == "tick":
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
        with sqlite3.connect(state / "queue.db", isolation_level=None) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
                attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
                detail TEXT, result TEXT, lane TEXT NOT NULL DEFAULT 'codex')""")
            if "lane" not in {row[1] for row in db.execute("PRAGMA table_info(jobs)")}:
                db.execute("ALTER TABLE jobs ADD COLUMN lane TEXT NOT NULL DEFAULT 'codex'")
            db.commit()
            if args.action == "enqueue":
                detail = None if args.lane == "codex" else "awaiting manual handoff"
                db.execute("INSERT OR IGNORE INTO jobs(id,lane,detail) VALUES (?,?,?)",
                           (args.id, args.lane, detail))
                if db.execute("SELECT lane FROM jobs WHERE id=?", (args.id,)).fetchone()[0] != args.lane:
                    parser.error("job ID already belongs to another lane")
            elif args.action in ("export-task", "import-result"):
                row = db.execute("SELECT lane,state FROM jobs WHERE id=?", (args.id,)).fetchone()
                if not row or row[0] == "codex" or row[1] != "queued":
                    parser.error("expected a queued external-lane job")
                if args.action == "export-task":
                    print(json.dumps({"id": args.id, "lane": row[0], "prompt": PROMPT}))
                else:
                    if not args.result_file or not args.result_file.is_file():
                        parser.error("a regular --result-file is required")
                    try:
                        with args.result_file.open("rb") as result_file:
                            data = result_file.read(16385)
                        answer = data.decode("utf-8").strip() if len(data) <= 16384 else ""
                    except (OSError, UnicodeError):
                        answer = ""
                    if not answer:
                        parser.error("expected a non-empty UTF-8 result up to 16 KiB")
                    written = db.execute(
                        "UPDATE jobs SET state='done', result=?, detail='manual result; billing unverified' "
                        "WHERE id=? AND lane=? AND state='queued'", (answer, args.id, row[0]),
                    ).rowcount
                    if written != 1:
                        parser.error("job already completed")
            elif args.action == "tick":
                codex = shutil.which(args.codex)
                if not codex:
                    parser.error("Codex CLI not found")
                worker(db, os.path.abspath(codex), lock.fileno())
            else:
                db.row_factory = sqlite3.Row
                print(json.dumps([dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY id")]))


if __name__ == "__main__":
    main()
