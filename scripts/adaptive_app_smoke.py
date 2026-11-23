#!/usr/bin/env python3
"""Package public, fixed fixtures for the adaptive app pilot (not CODA evidence)."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

FIXTURES = {
    "initial": ([1, 3, 4, 7], [0, 2, 5]),
    "pass": ([2, 4, 6, 7], [0, 1, 3, 5, 6, 7] * 8),
    "fail": ([1, 3, 4, 7], [0, 2, 5] * 16),
}

RUNNER = """
import json
def scan(queries):
    answers, probes = [], 0
    for query in queries:
        found = False
        for row in rows:
            probes += 1
            if row & query == row:
                found = True
                break
        answers.append(found)
    return answers, probes
baseline, direct = scan(queries)
index, setup = scan(range(8))
print(json.dumps(dict(mode=mode, baseline=baseline, indexed=[index[q] for q in queries],
                      scan_work=direct, index_work=setup + 8 + len(queries))))
"""

AUDITOR = """
import hashlib, json, sys
raw = sys.stdin.buffer.read(8193)
assert len(raw) <= 8192
report = json.loads(raw)
def probes(q):
    return next((i for i, row in enumerate(rows, 1) if row | q == q), len(rows))
expected = [any(row | q == q for row in rows) for q in queries]
scan = sum(map(probes, queries))
index = sum(map(probes, range(8))) + 8 + len(queries)
assert report == dict(mode=mode, baseline=expected, indexed=expected,
                      scan_work=scan, index_work=index)
print(json.dumps(dict(evidence_sha256=hashlib.sha256(raw).hexdigest(),
    outcome="pass" if index < scan else "fail",
    report=f"Public app fixture {mode}: {len(queries)} exact answers; indexed work {index}, direct scan work {scan}.")))
"""

MEMBERSHIP_RUNNER = """
import json
index = set(rows)
baseline, scan = [], 0
for query in queries:
    for row in rows:
        scan += 1
        if row == query:
            baseline.append(True)
            break
    else:
        baseline.append(False)
print(json.dumps(dict(mode=mode, baseline=baseline, indexed=[q in index for q in queries],
                      scan_work=scan, index_work=len(rows) + len(queries))))
"""

MEMBERSHIP_AUDITOR = """
import bisect, hashlib, json, sys
raw = sys.stdin.buffer.read(8193)
if len(raw) > 8192:
    raise ValueError("oversized evidence")
ordered = sorted(rows)
positions = {}
for i, row in enumerate(rows, 1):
    positions.setdefault(row, i)
def contains(query):
    i = bisect.bisect_left(ordered, query)
    return i < len(ordered) and ordered[i] == query
expected = list(map(contains, queries))
scan = sum(positions.get(query, len(rows)) for query in queries)
indexed = len(rows) + len(queries)
if json.loads(raw) != dict(mode=mode, baseline=expected, indexed=expected,
                          scan_work=scan, index_work=indexed):
    raise ValueError("membership answers or work counts differ")
print(json.dumps(dict(evidence_sha256=hashlib.sha256(raw).hexdigest(),
    outcome="pass" if indexed < scan else "fail",
    report=f"Public membership fixture: {len(queries)} exact answers; indexed work {indexed}, scan work {scan}.")))
"""

CAMPAIGN_CONTRACT = (
    b"maabarium synthetic membership v1: identical integer rows and queries; full exact coverage; "
    b"candidate insertion attempts plus lookups; exact scan baselines forward and reverse, "
    b"count every equality probe; strongest is the cheaper of the two frozen scans; no CODA claim"
)
CAMPAIGN_CONTRACT_SHA256 = hashlib.sha256(CAMPAIGN_CONTRACT).hexdigest()

CAMPAIGN_RUNNER = """
import json
def scan(records):
    answers, work = [], 0
    for query in queries:
        for value in records:
            work += 1
            if value == query:
                answers.append(True)
                break
        else:
            answers.append(False)
    return answers, work
index = set(rows)
forward, forward_work = scan(rows)
reverse, reverse_work = scan(rows[::-1])
print(json.dumps(dict(candidate=[q in index for q in queries], forward=forward, reverse=reverse,
    candidate_work=len(rows)+len(queries), forward_work=forward_work, reverse_work=reverse_work)))
"""

CAMPAIGN_AUDITOR = f"contract_sha256 = {CAMPAIGN_CONTRACT_SHA256!r}\n" + """
import bisect, hashlib, json, sys
raw = sys.stdin.buffer.read(16385)
if len(raw) > 16384:
    raise ValueError("oversized evidence")
ordered = sorted(rows)
first, last = {}, {}
for position, row in enumerate(rows):
    first.setdefault(row, position)
    last[row] = position
def contains(query):
    i = bisect.bisect_left(ordered, query)
    return i < len(ordered) and ordered[i] == query
expected = list(map(contains, queries))
forward_work = sum(first.get(q, len(rows)-1)+1 for q in queries)
reverse_work = sum(len(rows)-last.get(q, 0) for q in queries)
candidate_work = len(rows)+len(queries)
if json.loads(raw) != dict(candidate=expected, forward=expected, reverse=expected,
    candidate_work=candidate_work, forward_work=forward_work, reverse_work=reverse_work):
    raise ValueError("answers or frozen work counts differ")
teaching = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()
print(json.dumps(dict(contract_sha256=contract_sha256, evidence_sha256=hashlib.sha256(raw).hexdigest(),
    wrong_answers=0, lost_coverage=0, candidate_coverage=len(queries), baseline_coverage=len(queries),
    teaching_sha256=teaching, baseline_teaching_sha256=teaching, candidate_total_work=candidate_work,
    baseline_total_work=min(forward_work, reverse_work), strongest_comparator=True, complete=True)))
"""

FAMILIES = {
    "subset": (7, RUNNER, AUDITOR),
    "membership": (65535, MEMBERSHIP_RUNNER, MEMBERSHIP_AUDITOR),
    "membership-campaign": (65535, CAMPAIGN_RUNNER, CAMPAIGN_AUDITOR),
}


def bounded_bytes(path, limit):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{path.name} must be a regular file")
    with path.open("rb") as handle:
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise ValueError(f"{path.name} exceeds {limit} bytes")
    return raw


def bounded_json(path, limit):
    return json.loads(bounded_bytes(path, limit))


def validate_fixture(fixture):
    if not isinstance(fixture, dict) or set(fixture) not in ({"rows", "queries"}, {"family", "rows", "queries"}):
        raise ValueError("provide rows and queries with an optional family")
    family = fixture.get("family", "subset")
    if not isinstance(family, str) or family not in FAMILIES:
        raise ValueError("choose subset, membership, or membership-campaign")
    maximum, _, _ = FAMILIES[family]
    rows, queries = fixture["rows"], fixture["queries"]
    if any(not isinstance(values, list) or not 1 <= len(values) <= limit
           or any(type(value) is not int or not 0 <= value <= maximum for value in values)
           for values, limit in ((rows, 64), (queries, 512))):
        raise ValueError(f"use 1–64 rows and 1–512 queries, each an integer from 0 to {maximum}")
    return family, rows, queries


def templates(family):
    _, runner, auditor = FAMILIES[family]
    return (("runner", runner), ("auditor", auditor))


def executable_bytes(mode, rows, queries, code):
    return (f"#!{sys.executable}\nmode = {mode!r}\nrows = {rows!r}\n"
            f"queries = {queries!r}\n" + code).encode()


def review_package(directory, expected_digest=None):
    manifest_bytes = bounded_bytes(directory / "review.json", 8192)
    manifest_digest = hashlib.sha256(manifest_bytes).hexdigest()
    if expected_digest is not None and expected_digest != manifest_digest:
        raise ValueError("review manifest differs from the separately saved pin")
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "fixture", "pins"} or manifest["schema"] != 1:
        raise ValueError("unrecognized benchmark package")
    family, rows, queries = validate_fixture(manifest["fixture"])
    expected_pins = {}
    for role, code in templates(family):
        expected = executable_bytes("custom", rows, queries, code)
        path = directory / f"custom-{role}"
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"{role} must be a regular package file")
        with path.open("rb") as handle:
            if handle.read(len(expected) + 1) != expected:
                raise ValueError(f"{role} differs from the trusted template")
        expected_pins[role] = hashlib.sha256(expected).hexdigest()
    if manifest["pins"] != expected_pins:
        raise ValueError("recorded pins do not match the trusted files")
    return {"review": "verified without executing either program", "family": family, "rows": len(rows),
            "queries": len(queries), "pins": expected_pins, "review_sha256": manifest_digest,
            **({"contract_sha256": CAMPAIGN_CONTRACT_SHA256} if family == "membership-campaign" else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fixture", type=Path, help="prepare a new public fixture from bounded rows and queries")
    mode.add_argument("--review", action="store_true", help="verify prepared files without executing them")
    parser.add_argument("--expected-review-sha256", help="check a separately saved review manifest digest")
    args = parser.parse_args()
    if args.expected_review_sha256 is not None and not args.review:
        parser.error("--expected-review-sha256 requires --review")
    fixtures = FIXTURES
    family = "subset"
    if args.review or args.fixture:
        try:
            if args.review:
                print(json.dumps(review_package(args.out, args.expected_review_sha256), sort_keys=True))
                return
            fixture = bounded_json(args.fixture, 8192)
            family, rows, queries = validate_fixture(fixture)
            fixtures = {"custom": (rows, queries)}
        except (ValueError, OSError, RecursionError) as error:
            parser.error(str(error))
    args.out.mkdir(mode=0o700)
    packages = {}
    for mode, (rows, queries) in fixtures.items():
        info = {"title": f"Adaptive app pilot · {mode} fixture"}
        for role, code in templates(family):
            path = args.out.resolve() / f"{mode}-{role}"
            contents = executable_bytes(mode, rows, queries, code)
            path.write_bytes(contents)
            path.chmod(0o500)
            info[role] = str(path)
            info[role + "_sha256"] = hashlib.sha256(contents).hexdigest()
        packages[mode] = info
    if args.fixture:
        manifest_bytes = (json.dumps({
            "schema": 1, "fixture": fixture,
            "pins": {role: packages["custom"][role + "_sha256"] for role in ("runner", "auditor")},
        }, sort_keys=True) + "\n").encode("utf-8")
        (args.out / "review.json").write_bytes(manifest_bytes)
        packages["custom"]["review_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
        if family == "membership-campaign":
            packages["custom"]["contract_sha256"] = CAMPAIGN_CONTRACT_SHA256
        print(json.dumps(packages["custom"]))
    else:
        (args.out / "branches.json").write_text(json.dumps({k: packages[k] for k in ("pass", "fail")}))
        print(json.dumps(packages["initial"]))


if __name__ == "__main__":
    main()
