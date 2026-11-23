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


def bounded_json(path, limit):
    with path.open("rb") as handle:
        raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise ValueError(f"{path.name} exceeds {limit} bytes")
    return json.loads(raw)


def validate_fixture(fixture):
    if not isinstance(fixture, dict) or set(fixture) != {"rows", "queries"}:
        raise ValueError("provide rows and queries")
    rows, queries = fixture["rows"], fixture["queries"]
    if any(not isinstance(values, list) or not 1 <= len(values) <= limit
           or any(type(value) is not int or not 0 <= value < 8 for value in values)
           for values, limit in ((rows, 64), (queries, 512))):
        raise ValueError("use 1–64 rows and 1–512 queries, each an integer from 0 to 7")
    return rows, queries


def executable_bytes(mode, rows, queries, code):
    return (f"#!{sys.executable}\nmode = {mode!r}\nrows = {rows!r}\n"
            f"queries = {queries!r}\n" + code).encode()


def review_package(directory):
    manifest = bounded_json(directory / "review.json", 8192)
    if not isinstance(manifest, dict) or set(manifest) != {"schema", "fixture", "pins"} or manifest["schema"] != 1:
        raise ValueError("unrecognized benchmark package")
    rows, queries = validate_fixture(manifest["fixture"])
    expected_pins = {}
    for role, code in (("runner", RUNNER), ("auditor", AUDITOR)):
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
    return {"review": "verified without executing either program", "rows": len(rows),
            "queries": len(queries), "pins": expected_pins}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fixture", type=Path, help="prepare a new public fixture from bounded rows and queries")
    mode.add_argument("--review", action="store_true", help="verify prepared files without executing them")
    args = parser.parse_args()
    fixtures = FIXTURES
    if args.review or args.fixture:
        try:
            if args.review:
                print(json.dumps(review_package(args.out), sort_keys=True))
                return
            fixture = bounded_json(args.fixture, 8192)
            rows, queries = validate_fixture(fixture)
            fixtures = {"custom": (rows, queries)}
        except (ValueError, OSError, RecursionError) as error:
            parser.error(str(error))
    args.out.mkdir(mode=0o700)
    packages = {}
    for mode, (rows, queries) in fixtures.items():
        info = {"title": f"Adaptive app pilot · {mode} fixture"}
        for role, code in (("runner", RUNNER), ("auditor", AUDITOR)):
            path = args.out.resolve() / f"{mode}-{role}"
            contents = executable_bytes(mode, rows, queries, code)
            path.write_bytes(contents)
            path.chmod(0o500)
            info[role] = str(path)
            info[role + "_sha256"] = hashlib.sha256(contents).hexdigest()
        packages[mode] = info
    if args.fixture:
        (args.out / "review.json").write_text(json.dumps({
            "schema": 1, "fixture": fixture,
            "pins": {role: packages["custom"][role + "_sha256"] for role in ("runner", "auditor")},
        }, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(packages["custom"]))
    else:
        (args.out / "branches.json").write_text(json.dumps({k: packages[k] for k in ("pass", "fail")}))
        print(json.dumps(packages["initial"]))


if __name__ == "__main__":
    main()
