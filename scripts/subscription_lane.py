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
import time
import sys


PROMPT = (
    "Public synthetic research only. Do not use tools or read local files. "
    "For optional Boolean implication rules and labeled assignments, suggest one tiny "
    "counterexample that distinguishes exact consistency from a naive local inference. "
    "Give the example and its answer in under 150 words. No implementation."
)
MAX_ATTEMPTS = 4
CHILD_TIMEOUT = 120
# A child still running this long after its deadline lost its worker (for
# example the worker was killed) and is stopped by the next tick.
ORPHAN_GRACE = 30
MAX_REPLY_BYTES = 16384


def ensure_schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
        detail TEXT, result TEXT)""")
    for column in ("pid INTEGER", "started REAL"):
        try:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {column}")
        except sqlite3.OperationalError:
            pass


def is_lane_child(pid, codex):
    """True only if pid leads its own process group and runs our Codex CLI."""
    try:
        if os.getpgid(pid) != pid:
            return False
        command = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                                 capture_output=True, text=True, timeout=5, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return False
    # Interpreted CLIs show as "node /path/to/codex ..."; require our path.
    return codex in command.split()


def reap_orphan(db, codex, now=None):
    """Stop a child that outlived its worker. Returns True if one was killed."""
    now = time.time() if now is None else now
    row = db.execute(
        "SELECT id, pid, started FROM jobs WHERE state='running' AND pid IS NOT NULL").fetchone()
    if not row:
        return False
    job_id, pid, started = row
    if started is None or now - started < CHILD_TIMEOUT + ORPHAN_GRACE:
        return False
    if not is_lane_child(pid, codex):
        return False
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        return False
    db.execute("UPDATE jobs SET pid=NULL, detail='stopped an orphaned runner' WHERE id=?", (job_id,))
    return True


def clean_scratch(state):
    scratch_root = state / "scratch"
    if scratch_root.is_dir():
        shutil.rmtree(scratch_root, ignore_errors=True)


def worker(db, codex, lock_fd, state):
    job = db.execute(
        "SELECT id,attempts FROM jobs WHERE state IN ('queued','running') AND due<=? ORDER BY id LIMIT 1",
        (int(time.time()),),
    ).fetchone()
    if not job:
        return
    job_id, attempts = job
    if attempts >= MAX_ATTEMPTS:
        db.execute("UPDATE jobs SET state='failed', pid=NULL, detail='attempt limit' WHERE id=?", (job_id,))
        return
    # An allowlist intentionally excludes API keys, identity federation and custom endpoints.
    env = {k: os.environ[k] for k in ("HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "CODEX_HOME") if k in os.environ}
    flags = ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"']
    # Scratch lives in the private state directory, and the next tick that
    # holds the lock removes any copy a killed worker left behind.
    scratch = state / "scratch" / "current"
    scratch.mkdir(mode=0o700, parents=True, exist_ok=True)
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
    output = scratch / "answer.txt"
    cmd = [codex, *flags, "-a", "never", "exec", "--ignore-user-config", "--ephemeral",
           "--disable", "shell_tool", "--disable", "hooks", "-c", 'web_search="disabled"',
           "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", str(output), "-"]
    process = None
    try:
        process = subprocess.Popen(cmd, cwd=scratch, env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   text=True, start_new_session=True, pass_fds=(lock_fd,))
        db.execute("UPDATE jobs SET pid=?, started=? WHERE id=?", (process.pid, time.time(), job_id))
        process.communicate(PROMPT, timeout=CHILD_TIMEOUT)
        if process.returncode or not output.is_file():
            raise ValueError("no reply")
        if output.stat().st_size > MAX_REPLY_BYTES:
            # Retrying would spend quota again for the same oversized answer.
            db.execute("UPDATE jobs SET state='failed', pid=NULL, detail='reply exceeded size limit' WHERE id=?",
                       (job_id,))
            return
        result = output.read_text(encoding="utf-8").strip()
        if not result:
            raise ValueError("empty reply")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        if attempts + 1 >= MAX_ATTEMPTS:
            db.execute("UPDATE jobs SET state='failed', pid=NULL, detail='attempt limit' WHERE id=?", (job_id,))
        else:
            db.execute(
                "UPDATE jobs SET state='queued', pid=NULL, due=?,detail='runner unavailable; retry scheduled' WHERE id=?",
                (int(time.time()) + min(3600, 300 * 2 ** attempts), job_id),
            )
        return
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    db.execute("UPDATE jobs SET state='done', pid=NULL, result=?, detail='ChatGPT' WHERE id=?", (result, job_id))


def acquire_after_reap(lock, db, codex, wait=10.0):
    """Take the worker lock, stopping an orphaned child that still holds it."""
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        pass
    if not reap_orphan(db, codex):
        return False
    until = time.monotonic() + wait
    while time.monotonic() < until:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            time.sleep(0.05)
    return False


def main():
    global CHILD_TIMEOUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".maabarium" / "subscription-lane")
    parser.add_argument("--codex", default="codex", help="trusted local Codex CLI")
    parser.add_argument("action", choices=["enqueue", "tick", "status", "launchd-plist"])
    parser.add_argument("--id", default="directed-teaching-v1")
    parser.add_argument("--label", default="org.maabarium.subscription-lane")
    parser.add_argument("--child-timeout", type=int, default=CHILD_TIMEOUT, help=argparse.SUPPRESS)
    args = parser.parse_args()
    CHILD_TIMEOUT = max(1, args.child_timeout)
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
            # Without these, launchd discards errors such as a missing CLI.
            "StandardOutPath": str(state / "launchd.log"),
            "StandardErrorPath": str(state / "launchd.log"),
        }
        if "CODEX_HOME" in os.environ:
            job["EnvironmentVariables"] = {"CODEX_HOME": os.environ["CODEX_HOME"]}
        sys.stdout.buffer.write(plistlib.dumps(job))
        return
    with (state / "worker.lock").open("a") as lock:
        with sqlite3.connect(state / "queue.db", isolation_level=None) as db:
            ensure_schema(db)
            if args.action == "enqueue":
                db.execute("INSERT OR IGNORE INTO jobs(id) VALUES (?)", (args.id,))
            elif args.action == "tick":
                codex = shutil.which(args.codex)
                if not codex:
                    parser.error("Codex CLI not found")
                codex = os.path.abspath(codex)
                if not acquire_after_reap(lock, db, codex):
                    return
                clean_scratch(state)
                worker(db, codex, lock.fileno(), state)
            else:
                db.row_factory = sqlite3.Row
                print(json.dumps([dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY id")]))


if __name__ == "__main__":
    main()
