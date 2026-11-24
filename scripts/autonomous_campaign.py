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
    return decode_policy(data, expected, pin_program, unique_fields)


def decode_policy(data, expected, pin_program, unique_fields):
    if len(data) > 65536 or not valid(expected, DIGEST) or digest(data) != expected:
        raise ValueError("policy must match the separately approved SHA-256 (64 KiB maximum)")
    policy = json.loads(data, object_pairs_hook=unique_fields)
    schema = policy.get("schema") if isinstance(policy, dict) else None
    fields(policy, "schema brief rounds trials lifetime_seconds work_seconds templates"
           + (" variants" if schema == 1 else ""))
    if (type(schema) is not int or schema not in (1, 2)
            or not integer(policy["rounds"], 1, 200)
            or not integer(policy["trials"], 1, 200)
            or not integer(policy["lifetime_seconds"], 1, 604800)
            or not integer(policy["work_seconds"], 4, 120600)
            or not isinstance(policy["brief"], str) or not policy["brief"].strip()
            or len(policy["brief"].encode()) > 2048):
        raise ValueError("invalid campaign schema, public brief or budget")
    templates, variants = policy["templates"], policy.get("variants", {})
    if (not isinstance(templates, dict) or not 1 <= len(templates) <= 16
            or not isinstance(variants, dict) or (schema == 1 and not 1 <= len(variants) <= 64)):
        raise ValueError("approve 1–16 templates and 1–64 variants")
    common_rules = None
    for key, template in templates.items():
        fields(template, "timeout bounds metrics development confirmation panel_sha256"
               + (" summary" if schema == 2 else ""))
        if (not valid(key, IDENTITY) or not integer(template["timeout"], 1, 300)
                or (schema == 2 and (key == "NONE" or not isinstance(template["summary"], str)
                    or not template["summary"].strip() or len(template["summary"].encode()) > 96))):
            raise ValueError("invalid template identity or timeout")
        if not valid(template["panel_sha256"], DIGEST):
            raise ValueError("invalid confirmation panel digest")
        bounds = template["bounds"]
        if (not isinstance(bounds, dict) or not (1 if schema == 2 else 0) <= len(bounds) <= 8
                or any(not valid(name, IDENTITY) or not isinstance(pair, list) or len(pair) != 2
                       or not all(integer(n, -10**9, 10**9) for n in pair) or pair[0] > pair[1]
                       for name, pair in bounds.items())):
            raise ValueError("invalid parameter bounds")
        metric_rules(template["metrics"])
        if common_rules is None:
            common_rules = template["metrics"]
        elif template["metrics"] != common_rules:
            raise ValueError("all variants must answer the same frozen campaign metric rules")
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
        if not valid_parameters(values, template):
            raise ValueError("variant exceeds approved parameter bounds")
        fingerprint = canonical([template["development"]["runner_sha256"], values])
        if fingerprint in fingerprints:
            raise ValueError("duplicate experiment under different public IDs")
        fingerprints.add(fingerprint)
    return policy


def activate_pending(db, pin_program, unique_fields):
    if not db.execute("SELECT 1 FROM sqlite_schema WHERE name='campaign_autonomy'").fetchone():
        return
    row = db.execute("""SELECT c.id,a.policy,a.policy_sha256,a.deadline
        FROM campaigns c JOIN campaign_autonomy a ON a.campaign=c.id
        WHERE c.status='policy_pending' ORDER BY c.rowid LIMIT 1""").fetchone()
    if not row:
        return
    from research_campaign import initialize
    initialize(db)
    campaign, raw, pin, deadline = row
    try:
        if deadline <= time.time():
            raise ValueError("deadline reached")
        policy = decode_policy(raw.encode(), pin, pin_program, unique_fields)
        reason = None
    except (OSError, ValueError, RecursionError):
        reason = "Could not verify the approved plan. Check its format, deadline, and local program identities."
    with db:
        db.execute("BEGIN IMMEDIATE")
        changed = db.execute("UPDATE campaigns SET status=? WHERE id=? AND status='policy_pending'",
                             ("blocked" if reason else "active", campaign)).rowcount
        if changed:
            if reason:
                db.execute("UPDATE campaign_autonomy SET phase='blocked',reason=? WHERE campaign=?", (reason, campaign))
            else:
                db.execute("UPDATE campaign_autonomy SET policy=?,phase='waiting_for_worker' WHERE campaign=?",
                           (canonical(policy), campaign))


def valid_parameters(values, template):
    bounds = template["bounds"]
    return (isinstance(values, dict) and values.keys() == bounds.keys()
            and all(integer(value, *bounds[name]) for name, value in values.items()))


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
    if policy["schema"] == 2:
        advance_generated(db, campaign, policy, policy_sha, round_no, used, budget,
                          queue, parse, providers, details)
        return
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
            prepare_trial(db, campaign, policy_sha, round_id, key, variant["template"],
                          template, variant["parameters"], jobs, len(used) + 1, key)
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


def prepare_trial(db, campaign, policy_sha, round_id, key, template_id, template, parameters, jobs, ordinal, title):
    loop = "auto-" + digest(canonical([campaign, policy_sha, key]).encode())[:48]
    spec = {**template["development"], "campaign": campaign, "timeout": template["timeout"],
            "reviewer": None, "public_brief": "", "parameters": parameters, "template_id": template_id,
            "metric_rules": template["metrics"], "contract_sha256": policy_sha,
            "confirmation_plan": {**template["confirmation"], "panel_sha256": template["panel_sha256"]},
            "proposal_round": round_id, "proposal_sha256": [digest(job[2].encode()) for job in jobs]}
    db.execute("INSERT INTO campaign_autonomy_trials VALUES (?,?,?)", (campaign, key, loop))
    db.execute("INSERT INTO campaign_members VALUES (?,?,?)", (loop, campaign, ordinal))
    db.execute("""INSERT INTO research_loops(id,target,plan,step,status,review_every)
        VALUES (?,?,'["Local evidence"]',1,'active',1)""", (loop, title))
    db.execute("INSERT INTO local_benchmarks(loop_id,spec) VALUES (?,?)", (loop, canonical(spec)))
    db.execute("INSERT INTO jobs(id,lane,detail) VALUES (?,?,?)",
               (f"loop:{loop}:1", "Local evidence", "Approved experiment prepared; waiting for worker"))
    db.execute("UPDATE campaign_autonomy SET phase='trial',reason=NULL WHERE campaign=?", (campaign,))


def advance_generated(db, campaign, policy, policy_sha, round_no, used, budget, queue, parse, providers, details):
    available = {key: template for key, template in policy["templates"].items()
                 if 4 * template["timeout"] <= budget}
    if not available:
        halt(db, campaign, "No approved experiments fit the remaining work budget")
        return
    proposer, checker = (lane for lane, _, _ in providers(db, campaign))
    round_id = f"autonomy-{round_no}"

    def lookup(lane):
        return db.execute("SELECT state,detail,result FROM jobs WHERE id=? AND lane=?",
                          (f"proposal:{campaign}:{round_id}:{lane}", lane)).fetchone()

    proposal = lookup(proposer)
    rejection = None
    if proposal:
        if proposal[0] not in ("done", "failed"):
            return
        selection = parse(proposal[2]) if proposal[:2] == ("done", details[proposer]) else None
        template_id, parameters = selection or (None, None)
        template = available.get(template_id)
        if template and valid_parameters(parameters, template):
            candidate = canonical({"id": template_id, "parameters": parameters})
            key = digest(canonical([template["development"]["runner_sha256"], parameters]).encode())
            if key not in used:
                review = lookup(checker)
                if not review:
                    queue(db, campaign, round_id, policy["brief"] + "\nProposed settings: " + candidate,
                          lane=checker,
                          instruction="Is this exact proposal a useful experiment for the question? "
                                      "Reply with only APPROVE or REJECT. Do not propose replacements.")
                    return
                if review[0] not in ("done", "failed"):
                    return
                if (review[:2] == ("done", details[checker]) and isinstance(review[2], str)
                        and review[2].strip() == "APPROVE"):
                    prepare_trial(db, campaign, policy_sha, round_id, key, template_id, template,
                                  parameters, (proposal, review), len(used) + 1, template["summary"])
                    return
                rejection = "The previous proposal did not get approval. Try different settings."
            else:
                rejection = "The previous proposal repeated an experiment that already ran."
        else:
            rejection = "The previous reply did not provide valid settings for an approved experiment."
    if round_no >= policy["rounds"]:
        halt(db, campaign, "Discovery round limit reached without another approved experiment")
        return
    history = []
    for template_id, parameters in db.execute("""SELECT json_extract(b.spec,'$.template_id'),
        json_extract(b.spec,'$.parameters') FROM campaign_autonomy_trials t
        JOIN local_benchmarks b ON b.loop_id=t.loop_id JOIN campaign_members m ON m.loop_id=t.loop_id
        WHERE t.campaign=? ORDER BY m.ordinal DESC LIMIT 10""", (campaign,)):
        history.append({"id": template_id, "parameters": json.loads(parameters)})
    public = policy["brief"] + "\nApproved experiments: " + canonical({
        key: {"summary": value["summary"], "bounds": value["bounds"]} for key, value in available.items()})
    if history:
        public += "\nRecent settings already tested and not promoted: " + canonical(history)
    if rejection:
        public += "\n" + rejection
    queue(db, campaign, f"autonomy-{round_no + 1}", public, lane=proposer,
          instruction='Choose a new experiment and reply only with JSON of the form '
                      '{"id":"approved-id","parameters":{"setting":1}}, or NONE. '
                      'Use all and only the listed settings, inside their inclusive integer bounds.')
    db.execute("UPDATE campaign_autonomy SET round=?,phase='discovery',reason=NULL WHERE campaign=?",
               (round_no + 1, campaign))
