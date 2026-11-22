#!/usr/bin/env python3
"""Bounded local queue for a ChatGPT-backed public research lane."""

import argparse
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import plistlib
import re
import select
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
OPT_IN_LANES = ("claude", "antigravity", "muse")
GUARD = """import os, signal, subprocess, sys
try:
    child = subprocess.Popen(sys.argv[2:])
    sys.exit(child.wait(timeout=int(sys.argv[1])))
except subprocess.TimeoutExpired:
    os.killpg(os.getpgrp(), signal.SIGKILL)
"""


def queue_loop_step(db, loop_id, step, lanes, target):
    lane = lanes[step - 1]
    db.execute(
        "INSERT INTO jobs(id,lane,detail,prompt) VALUES (?,?,?,?)",
        (f"loop:{loop_id}:{step}", lane, None if lane == "codex" else "awaiting manual handoff",
         f"Public synthetic experiment, step {step} of {len(lanes)}. "
         "Do not use tools or read local files. Work on this public target and report a bounded result: "
         + target),
    )


def muse_account_ready(binary, scratch, env):
    """Ask the vendor host how it will authenticate, without starting a model."""
    with subprocess.Popen(
        [binary, "serve", "--provider", "meta", "--no-session-log", "--disable-shell", "--disable-write"],
        cwd=scratch, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, start_new_session=True,
    ) as host:
        deadline = time.monotonic() + 8
        buffer = b""
        remaining = 65536

        def send(method, **fields):
            host.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, **fields}).encode() + b"\n")
            host.stdin.flush()

        def receive(request_id):
            nonlocal buffer, remaining
            while time.monotonic() < deadline:
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    frame = json.loads(line)
                    if frame.get("jsonrpc") == "2.0" and frame.get("id") == request_id:
                        return frame.get("result") or {}
                if remaining <= 0 or not select.select([host.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                    break
                chunk = os.read(host.stdout.fileno(), min(4096, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                buffer += chunk
            return {}

        try:
            send("initialize", id=1, params={
                "clientInfo": {"name": "maabarium_account", "version": "0.1.0"},
                "capabilities": {"experimentalApi": True},
            })
            reply = receive(1)
            if reply.get("experimentalApi") is not True or not isinstance(reply.get("schema", {}).get("fingerprint"), str):
                return False
            send("initialized")
            send("account/read", id=2, params={})
            return receive(2).get("state") == "accountLogin"
        except (OSError, ValueError, AttributeError):
            return False
        finally:
            if host.poll() is None:
                try:
                    os.killpg(host.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def muse_result(raw):
    terminals = []
    for line in raw.splitlines():
        frame = json.loads(line)
        if not isinstance(frame, dict):
            raise ValueError("invalid Muse record")
        if frame.get("payload_type", "").startswith("run.terminal."):
            terminals.append(frame)
    if len(terminals) != 1 or terminals[0]["payload_type"] != "run.terminal.completed":
        return None
    payload = terminals[0].get("payload")
    return payload.get("text") if isinstance(payload, dict) and payload.get("terminal") == "completed" else None


def muse_quota_reset(raw):
    for line in raw.splitlines():
        frame = json.loads(line)
        if not isinstance(frame, dict) or frame.get("payload_type") != "run.terminal.failed":
            continue
        payload = frame.get("payload")
        reason = payload.get("reason") if isinstance(payload, dict) else None
        if isinstance(reason, str):
            match = re.search(r"Subscription quota exhausted\. Your usage window resets at "
                              r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\.", reason)
            if match:
                return int(datetime.fromisoformat(match[1].replace("Z", "+00:00")).timestamp())
    return None


def worker(db, runners, lock_fd):
    slots = ",".join("?" for _ in runners)
    job = db.execute(
        f"SELECT id,attempts,prompt,lane FROM jobs WHERE state IN ('queued','running') AND due<=? AND lane IN ({slots}) ORDER BY due,id LIMIT 1",
        (int(time.time()), *runners),
    ).fetchone()
    if not job:
        return
    job_id, attempts, prompt, lane = job
    binary = runners[lane]
    if attempts >= MAX_ATTEMPTS:
        db.execute("UPDATE jobs SET state='failed', detail='attempt limit' WHERE id=?", (job_id,))
        return
    # An allowlist intentionally excludes API keys, identity federation and custom endpoints.
    env = {k: os.environ[k] for k in ("HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "CODEX_HOME") if k in os.environ}
    if lane == "muse":
        env["MUSE_NO_AUTO_UPDATE"] = "1"
    flags = ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"']
    with tempfile.TemporaryDirectory(prefix="maabarium-lane-") as scratch:
        check = ([binary, *flags, "login", "status"] if lane == "codex" else
                 [binary, "auth", "status"] if lane == "claude" else [binary, "models"])
        try:
            auth = None if lane == "muse" else subprocess.run(check, cwd=scratch, env=env,
                                  capture_output=True, text=True, timeout=10, check=False)
            if lane == "muse":
                ready = muse_account_ready(binary, scratch, env)
            elif lane == "claude":
                status = json.loads(auth.stdout)
                ready = (isinstance(status, dict) and status.get("loggedIn") is True and
                         status.get("authMethod") == "claude.ai" and status.get("apiProvider") == "firstParty" and
                         status.get("subscriptionType") in ("pro", "max", "ultra"))
            elif lane == "antigravity":
                ready = any(line.startswith("gemini-4-neon-low\t") for line in auth.stdout.splitlines())
            else:
                ready = any(line.strip() == "Logged in using ChatGPT"
                            for line in (auth.stdout + "\n" + auth.stderr).splitlines())
            ready = ready and (auth is None or auth.returncode == 0)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            ready = False
        if not ready:
            detail = "ChatGPT sign-in required" if lane == "codex" else "subscription CLI preflight failed"
            db.execute("UPDATE jobs SET state='queued', due=?,detail=? WHERE id=? AND state IN ('queued','running')",
                       (int(time.time()) + 900, detail, job_id))
            return
        claimed = db.execute(
            "UPDATE jobs SET state='running', attempts=attempts+1, detail=NULL WHERE id=? AND state IN ('queued','running')",
            (job_id,),
        ).rowcount
        if claimed != 1:
            return
        output = Path(scratch) / "answer.txt"
        cmd = [binary, *flags, "-a", "never", "exec", "--ignore-user-config", "--ephemeral",
               "--disable", "shell_tool", "--disable", "hooks", "-c", 'web_search="disabled"',
               "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", str(output), "-"]
        if lane == "claude":
            cmd = [binary, "-p", "--tools", "", "--setting-sources", "", "--strict-mcp-config",
                   "--settings", '{"disableAllHooks":true}', "--no-session-persistence",
                   "--output-format", "json", "--max-turns", "1"]
        elif lane == "antigravity":
            cmd = [binary, "--sandbox", "--settings", '{"useG1Credits":false}',
                   "--print-timeout", "90s", "--disable-slash-commands", "--model", "gemini-4-neon-low",
                   "--output-format", "json", "-p", prompt or PROMPT]
        elif lane == "muse":
            cmd = [binary, "exec", "--provider", "meta", "--preset", "empty", "--json",
                   "--contributor-mode", "off", "--no-session-log", "--no-foreign-personal-context",
                   "--disable-web-tools", "--disable-reminders", "--disable-request-user-input",
                   "--disable-shell", "--disable-write", "--max-model-steps", "2",
                   "--approval-mode", "never", "--", prompt or PROMPT]
        process = None
        try:
            # The guardian, not the vendor process, holds the lock and enforces
            # the deadline even if the queue worker is killed.
            with (output.open("wb") if lane != "codex" else open(os.devnull, "wb")) as stdout:
                process = subprocess.Popen([sys.executable, "-I", "-c", GUARD, "120", *cmd],
                                           cwd=scratch, env=env, stdin=subprocess.PIPE,
                                           stdout=stdout, stderr=subprocess.DEVNULL,
                                           text=True, start_new_session=True, pass_fds=(lock_fd,))
                process.communicate("" if lane in ("antigravity", "muse") else prompt or PROMPT, timeout=125)
            if not output.is_file() or output.stat().st_size > 65536:
                raise ValueError("no bounded reply")
            result = output.read_text(encoding="utf-8").strip()
            if process.returncode:
                reset = muse_quota_reset(result) if lane == "muse" else None
                if reset is not None and attempts + 1 < MAX_ATTEMPTS:
                    db.execute(
                        "UPDATE jobs SET state='queued',due=?,detail='Muse subscription quota exhausted; waiting for reset' WHERE id=?",
                        (max(int(time.time()) + 60, reset + 60), job_id),
                    )
                    return
                raise ValueError("provider did not complete")
            if lane == "muse":
                result = muse_result(result)
            elif lane != "codex":
                data = json.loads(result)
                if not isinstance(data, dict):
                    raise ValueError("invalid response")
                if lane == "claude":
                    result = data.get("result") if data.get("subtype") == "success" and data.get("is_error") is False else None
                else:
                    result = data.get("response") if data.get("status") == "SUCCESS" else None
            if not isinstance(result, str) or not result.strip() or len(result.encode()) > 16384:
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
        detail = {"codex": "ChatGPT", "claude": "Claude account; API credentials excluded",
                  "antigravity": "Antigravity account; AI credits disabled for run",
                  "muse": "Muse browser account; API-key overrides excluded"}[lane]
        db.execute("UPDATE jobs SET state='done', result=?, detail=? WHERE id=?", (result, detail, job_id))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".maabarium" / "subscription-lane")
    parser.add_argument("--codex", default="codex", help="trusted local Codex CLI")
    parser.add_argument("--claude", help="trusted Claude CLI; opt in only after confirming account Usage credits are off")
    parser.add_argument("--antigravity", help="trusted agy CLI; opt in only after confirming account credit overages are off")
    parser.add_argument("--muse", help="trusted Muse CLI; opt in only after confirming the browser account has a subscription")
    parser.add_argument("action", choices=["enqueue", "tick", "status", "launchd-plist", "export-task", "import-result", "loop-start", "loop-review", "loop-status"])
    parser.add_argument("--lane", choices=LANES, default="codex")
    parser.add_argument("--result-file", type=Path)
    parser.add_argument("--public-target", help="Public synthetic target; sent to the selected providers")
    parser.add_argument("--plan", nargs="+", choices=LANES, help="Ordered provider lanes (1–20)")
    parser.add_argument("--step", type=int, help="Exact completed step being reviewed")
    parser.add_argument("--decision", choices=("accept", "stop"))
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
        for lane in OPT_IN_LANES:
            path = getattr(args, lane)
            if path:
                binary = shutil.which(path)
                if not binary:
                    parser.error(f"{lane} CLI not found")
                job["ProgramArguments"].extend([f"--{lane}", os.path.abspath(binary)])
        if "CODEX_HOME" in os.environ:
            job["EnvironmentVariables"] = {"CODEX_HOME": os.environ["CODEX_HOME"]}
        sys.stdout.buffer.write(plistlib.dumps(job))
        return
    with (state / "worker.lock").open("a") as lock:
        if args.action in ("tick", "loop-review"):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                if args.action == "loop-review":
                    parser.error("the worker is active; try reviewing again after this attempt")
                return
        with sqlite3.connect(state / "queue.db", isolation_level=None) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'queued',
                attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0,
                detail TEXT, result TEXT, lane TEXT NOT NULL DEFAULT 'codex')""")
            columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
            if "lane" not in columns:
                db.execute("ALTER TABLE jobs ADD COLUMN lane TEXT NOT NULL DEFAULT 'codex'")
            if "prompt" not in columns:
                db.execute("ALTER TABLE jobs ADD COLUMN prompt TEXT")
            db.execute("""CREATE TABLE IF NOT EXISTS research_loops (
                id TEXT PRIMARY KEY, target TEXT NOT NULL, plan TEXT NOT NULL,
                step INTEGER NOT NULL, status TEXT NOT NULL)""")
            db.commit()
            if args.action == "enqueue":
                if args.id.startswith("loop:"):
                    parser.error("job IDs starting with loop: are reserved")
                detail = None if args.lane == "codex" else "awaiting manual handoff"
                db.execute("INSERT OR IGNORE INTO jobs(id,lane,detail) VALUES (?,?,?)",
                           (args.id, args.lane, detail))
                if db.execute("SELECT lane FROM jobs WHERE id=?", (args.id,)).fetchone()[0] != args.lane:
                    parser.error("job ID already belongs to another lane")
            elif args.action in ("export-task", "import-result"):
                row = db.execute("SELECT lane,state,prompt FROM jobs WHERE id=?", (args.id,)).fetchone()
                if not row or row[0] == "codex" or row[1] != "queued":
                    parser.error("expected a queued external-lane job")
                if args.action == "export-task":
                    print(json.dumps({"id": args.id, "lane": row[0], "prompt": row[2] or PROMPT}))
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
            elif args.action == "loop-start":
                target = (args.public_target or "").strip()
                if not target or len(target.encode()) > 4096 or not args.plan or len(args.plan) > 20:
                    parser.error("provide a public target up to 4096 bytes and 1–20 provider steps")
                db.execute("BEGIN IMMEDIATE")
                try:
                    db.execute("INSERT INTO research_loops VALUES (?,?,?,1,'active')",
                               (args.id, target, json.dumps(args.plan)))
                    queue_loop_step(db, args.id, 1, args.plan, target)
                except sqlite3.IntegrityError:
                    parser.error("loop ID already exists")
                db.commit()
            elif args.action == "loop-review":
                if not args.step or not args.decision:
                    parser.error("provide --step and --decision")
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT target,plan,step,status FROM research_loops WHERE id=?",
                                 (args.id,)).fetchone()
                if not row or row[2:] != (args.step, "active"):
                    parser.error("no active loop at that step; refresh status")
                target, plan, step, _ = row
                lanes = json.loads(plan)
                if args.decision == "accept":
                    done = db.execute("SELECT state FROM jobs WHERE id=?",
                                      (f"loop:{args.id}:{step}",)).fetchone()
                    if done != ("done",):
                        parser.error("only a completed step can be accepted")
                if args.decision == "stop" or step == len(lanes):
                    db.execute("UPDATE research_loops SET status=? WHERE id=?",
                               ("stopped" if args.decision == "stop" else "done", args.id))
                    if args.decision == "stop":
                        db.execute("UPDATE jobs SET state='failed',detail='loop stopped' WHERE id=? AND state IN ('queued','running')",
                                   (f"loop:{args.id}:{step}",))
                else:
                    queue_loop_step(db, args.id, step + 1, lanes, target)
                    db.execute("UPDATE research_loops SET step=step+1 WHERE id=?", (args.id,))
                db.commit()
            elif args.action == "tick":
                codex = shutil.which(args.codex)
                if not codex:
                    parser.error("Codex CLI not found")
                runners = {"codex": os.path.abspath(codex)}
                for lane in OPT_IN_LANES:
                    path = getattr(args, lane)
                    if path:
                        binary = shutil.which(path)
                        if not binary:
                            parser.error(f"{lane} CLI not found")
                        runners[lane] = os.path.abspath(binary)
                worker(db, runners, lock.fileno())
            elif args.action == "loop-status":
                db.row_factory = sqlite3.Row
                row = db.execute("SELECT * FROM research_loops WHERE id=?", (args.id,)).fetchone()
                if not row:
                    parser.error("loop not found")
                print(json.dumps(dict(row)))
            else:
                db.row_factory = sqlite3.Row
                print(json.dumps([dict(row) for row in db.execute("SELECT * FROM jobs ORDER BY id")]))


if __name__ == "__main__":
    main()
