"""Bounded, opt-in campaign controller. Provider responses are data, never code."""

import hashlib
import json
from pathlib import Path
import re
import time


IDENTITY = r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}"
DIGEST = r"[a-f0-9]{64}"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def valid(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def fields(value, expected):
    if not isinstance(value, dict) or value.keys() != set(expected.split()):
        raise ValueError(f"expected fields: {expected}")


def read_policy(path, expected, pin_program, unique_fields):
    with path.open("rb") as handle:
        data = handle.read(65537)
    if len(data) > 65536 or not valid(expected, DIGEST) or digest(data) != expected:
        raise ValueError("policy must match the separately approved SHA-256 (64 KiB maximum)")
    policy = json.loads(data, object_pairs_hook=unique_fields)
    fields(policy, "schema brief rounds trials lifetime_seconds work_seconds templates variants")
    if (type(policy["schema"]) is not int or policy["schema"] != 1
            or not integer(policy["rounds"], 1, 200)
            or not integer(policy["trials"], 1, 200)
            or not integer(policy["lifetime_seconds"], 1, 604800)
            or not integer(policy["work_seconds"], 4, 120600)
            or not isinstance(policy["brief"], str) or not policy["brief"].strip()
            or len(policy["brief"].encode()) > 2048):
        raise ValueError("invalid campaign schema, public brief or budget")
    templates, variants = policy["templates"], policy["variants"]
    if (not isinstance(templates, dict) or not 1 <= len(templates) <= 16
            or not isinstance(variants, dict) or not 1 <= len(variants) <= 64):
        raise ValueError("approve 1–16 templates and 1–64 variants")
    for key, template in templates.items():
        fields(template, "timeout bounds metrics development confirmation panel_sha256")
        if not valid(key, IDENTITY) or not integer(template["timeout"], 1, 300):
            raise ValueError("invalid template identity or timeout")
        if not valid(template["panel_sha256"], DIGEST):
            raise ValueError("invalid confirmation panel digest")
        bounds = template["bounds"]
        if (not isinstance(bounds, dict) or len(bounds) > 8
                or any(not valid(name, IDENTITY) or not isinstance(pair, list) or len(pair) != 2
                       or not all(integer(n, -10**9, 10**9) for n in pair) or pair[0] > pair[1]
                       for name, pair in bounds.items())):
            raise ValueError("invalid parameter bounds")
        metric_rules(template["metrics"])
        pins = set()
        for stage in ("development", "confirmation"):
            program = template[stage]
            fields(program, "runner runner_sha256 auditor auditor_sha256")
            for role in ("runner", "auditor"):
                pin = program[role + "_sha256"]
                if not valid(pin, DIGEST) or not isinstance(program[role], str):
                    raise ValueError("invalid approved executable identity")
                path = Path(program[role])
                if not path.is_absolute():
                    raise ValueError("approved executable paths must be absolute")
                program[role] = pin_program(path, pin)
                pins.add(pin)
        if len(pins) != 4:
            raise ValueError("development and confirmation require distinct runners and auditors")
    fingerprints = set()
    for key, variant in variants.items():
        fields(variant, "template parameters summary")
        if (not valid(key, IDENTITY) or key == "NONE"
                or not valid(variant["template"], IDENTITY) or variant["template"] not in templates
                or not isinstance(variant["summary"], str) or not variant["summary"].strip()
                or len(variant["summary"].encode()) > 96):
            raise ValueError("invalid public variant description")
        template = templates[variant["template"]]
        values = variant["parameters"]
        if (not isinstance(values, dict) or values.keys() != template["bounds"].keys()
                or any(not integer(value, *template["bounds"][name]) for name, value in values.items())):
            raise ValueError("variant exceeds approved parameter bounds")
        fingerprint = canonical([template["development"]["runner_sha256"], values])
        if fingerprint in fingerprints:
            raise ValueError("duplicate experiment under different public IDs")
        fingerprints.add(fingerprint)
    return policy


def metric_rules(rules):
    if not isinstance(rules, dict) or not 1 <= len(rules) <= 16:
        raise ValueError("approve 1–16 integer metric rules")
    for name, rule in rules.items():
        if (not valid(name, IDENTITY) or not isinstance(rule, list) or len(rule) != 2
                or rule[0] not in ("eq", "le", "ge") or not integer(rule[1], -10**15, 10**15)):
            raise ValueError("invalid metric rule")


def verdict(report, evidence, contract, rules):
    fields(report, "contract_sha256 evidence_sha256 complete metrics")
    if (report["contract_sha256"] != contract or report["evidence_sha256"] != digest(evidence)
            or report["complete"] is not True or not isinstance(report["metrics"], dict)
            or report["metrics"].keys() != rules.keys()
            or not all(integer(n, -10**15, 10**15) for n in report["metrics"].values())):
        raise ValueError("incomplete or mismatched evidence")
    metric_rules(rules)
    return "pass" if all(
        {"eq": value == limit, "le": value <= limit, "ge": value >= limit}[op]
        for name, (op, limit) in rules.items() for value in (report["metrics"][name],)
    ) else "fail"


def create(db, campaign, policy, policy_sha):
    if not valid(campaign, IDENTITY):
        raise ValueError("use a 1–48 character campaign ID")
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("INSERT INTO campaigns(id,trial_limit) VALUES (?,?)", (campaign, policy["trials"]))
        db.execute("INSERT INTO campaign_adaptive VALUES (?,?)", (campaign, policy["brief"]))
        db.execute("INSERT INTO campaign_local_budget VALUES (?,?)", (campaign, policy["work_seconds"]))
        db.execute("""INSERT INTO campaign_autonomy
            (campaign, policy, policy_sha256, deadline, phase) VALUES (?,?,?,?,?)""",
            (campaign, canonical(policy), policy_sha, int(time.time()) + policy["lifetime_seconds"], "waiting_for_worker"))
        db.commit()
    except Exception:
        db.rollback()
        raise


def halt(db, campaign, reason):
    db.execute("UPDATE campaigns SET status='blocked' WHERE id=?", (campaign,))
    db.execute("UPDATE campaign_autonomy SET phase='blocked',reason=? WHERE campaign=?", (reason, campaign))
    db.execute("""UPDATE jobs SET state='failed',detail=?,finished_at=unixepoch()
        WHERE state IN ('queued','running') AND id IN (
        SELECT job_id FROM campaign_proposals WHERE campaign=?
        UNION SELECT 'loop:' || loop_id || ':1' FROM campaign_members WHERE campaign=?
        UNION SELECT 'loop:' || loop_id || ':1' FROM campaign_confirmations WHERE campaign=?)""",
        (reason, campaign, campaign, campaign))
    db.execute("""UPDATE research_loops SET status='stopped' WHERE status='active' AND id IN (
        SELECT loop_id FROM campaign_members WHERE campaign=?
        UNION SELECT loop_id FROM campaign_confirmations WHERE campaign=?) AND EXISTS (
        SELECT 1 FROM jobs WHERE id='loop:' || research_loops.id || ':1' AND state='failed')""",
        (campaign, campaign))


def advance(db, queue_proposals, parse_choice, providers, details, enabled_lanes):
    rows = db.execute("""SELECT a.campaign,a.policy,a.policy_sha256,a.deadline,a.round,c.status
        FROM campaign_autonomy a JOIN campaigns c ON c.id=a.campaign
        WHERE c.status IN ('active','confirming')
        OR (c.status='human_review' AND a.phase!='needs_review')""").fetchall()
    for campaign, raw, policy_sha, deadline, round_no, status in rows:
        if status == "human_review":
            db.execute("""UPDATE campaign_autonomy SET phase='needs_review',
                reason=COALESCE(reason,'Trial limit, failed confirmation or operational check; inspect the ledger')
                WHERE campaign=?""", (campaign,))
        elif deadline <= time.time():
            halt(db, campaign, "Campaign deadline reached")
        elif status == "active":
            missing = set(lane for lane, _, _ in providers(db, campaign)) - enabled_lanes
            if missing:
                db.execute("""UPDATE campaign_autonomy SET phase='waiting_for_worker',reason=?
                    WHERE campaign=?""", ("Worker needs configured providers: " + ", ".join(sorted(missing)), campaign))
                continue
            db.execute("""UPDATE campaign_autonomy SET phase='discovery',reason=NULL
                WHERE campaign=? AND phase='waiting_for_worker'""", (campaign,))
            advance_active(db, campaign, json.loads(raw), policy_sha, round_no,
                           queue_proposals, parse_choice, providers, details)


def advance_active(db, campaign, policy, policy_sha, round_no, queue, parse, providers, details):
    if db.execute("""SELECT 1 FROM campaign_members m JOIN jobs j ON j.id='loop:' || m.loop_id || ':1'
        WHERE m.campaign=? AND j.state IN ('queued','running')""", (campaign,)).fetchone():
        db.execute("UPDATE campaign_autonomy SET phase='trial',reason=NULL WHERE campaign=? AND phase!='trial'",
                   (campaign,))
        return
    used = {key for (key,) in db.execute(
        "SELECT variant FROM campaign_autonomy_trials WHERE campaign=?", (campaign,))}
    budget, = db.execute("SELECT remaining_seconds FROM campaign_local_budget WHERE campaign=?", (campaign,)).fetchone()
    variants, templates = policy["variants"], policy["templates"]
    # Reserve headroom for both development and sealed confirmation before proposing.
    available = {k: v for k, v in variants.items()
                 if k not in used and 4 * templates[v["template"]]["timeout"] <= budget}
    if not available:
        halt(db, campaign, "No unused approved variants fit the remaining budget" if set(variants) - used
             else "Approved experiments exhausted; needs benchmark preparation")
        return
    round_id = f"autonomy-{round_no}"
    jobs = [db.execute("SELECT state,detail,result FROM jobs WHERE id=?",
        (f"proposal:{campaign}:{round_id}:{lane}",)).fetchone() for lane, _, _ in providers(db, campaign)]
    if any(job and job[0] not in ("done", "failed") for job in jobs):
        return
    if all(jobs):
        selections = [parse(j[2]) if j[0] == "done" and j[1] == details[lane] else None
                      for j, (lane, _, _) in zip(jobs, providers(db, campaign))]
        chosen = selections[0]
        if chosen and chosen == selections[1] and chosen[0] in available and chosen[1] is None:
            key = chosen[0]
            variant = available[key]
            template = templates[variant["template"]]
            loop = "auto-" + digest(canonical([campaign, policy_sha, key]).encode())[:48]
            spec = {**template["development"], "campaign": campaign, "timeout": template["timeout"],
                    "reviewer": None, "public_brief": "", "parameters": variant["parameters"],
                    "metric_rules": template["metrics"], "contract_sha256": policy_sha,
                    "confirmation_plan": {**template["confirmation"], "panel_sha256": template["panel_sha256"]},
                    "proposal_round": round_id, "proposal_sha256": [digest(j[2].encode()) for j in jobs]}
            db.execute("INSERT INTO campaign_autonomy_trials VALUES (?,?,?)", (campaign, key, loop))
            db.execute("INSERT INTO campaign_members VALUES (?,?,?)", (loop, campaign, len(used) + 1))
            db.execute("""INSERT INTO research_loops(id,target,plan,step,status,review_every)
                VALUES (?,?,'["Local evidence"]',1,'active',1)""", (loop, key))
            db.execute("INSERT INTO local_benchmarks(loop_id,spec) VALUES (?,?)", (loop, canonical(spec)))
            db.execute("INSERT INTO jobs(id,lane,detail) VALUES (?,?,?)",
                       (f"loop:{loop}:1", "Local evidence", "Approved variant prepared; waiting for worker"))
            db.execute("UPDATE campaign_autonomy SET phase='trial',reason=NULL WHERE campaign=?", (campaign,))
            return
    if round_no >= policy["rounds"]:
        halt(db, campaign, "Discovery round limit reached without another approved experiment")
        return
    next_round = round_no + 1
    history = "\nPreviously tried public IDs (excluded): " + canonical(sorted(used)) if used else ""
    brief = policy["brief"] + history + "\nChoose one unused approved variant, or NONE. Variant summaries: " + canonical(
        {k: v["summary"] for k, v in available.items()})
    queue(db, campaign, f"autonomy-{next_round}", brief, approved_ids=list(available))
    db.execute("UPDATE campaign_autonomy SET round=?,phase='discovery',reason=NULL WHERE campaign=?",
               (next_round, campaign))
