#!/usr/bin/env python3
"""
Resume-safe driver for multi-day evaluation runs (testing/eval_llm_chat.py).

Why this exists: the Gemini free tier grants 20 requests/day/model on the large
flash models, so one 245-call protocol takes ~13 days. Driving that by hand
means, every day and for every model, computing --start-at from how far the
model got (records % 49), computing --runs from how many passes remain, and
merging the day's file into the canonical one. Six models over thirteen days is
78 invocations of that arithmetic, and getting it wrong silently produces a file
with a duplicated or missing case — the kind of defect this campaign exists to
avoid.

Three things this does that the harness alone does not:

  * Resumes. Reads the canonical file, counts what is already there, and picks
    up at the exact next case. Nothing to compute by hand.
  * Saves after every case, not at the end. A quota exhaustion, a Ctrl-C or a
    killed process keeps everything already measured. eval_llm_chat.py writes
    once at the end, so an interrupted run loses the whole day.
  * Refuses to mix inputs. A file carries the _meta of the code that produced
    it; appending to it with a different prompt or golden set would rebuild, one
    day at a time, exactly the contamination of 2026-07-26 (answer key rewritten
    mid-campaign, nothing in the data saying so). Mismatch stops the run.

Usage:
    poetry run python testing/eval_resume.py --models gemini:gemini-2.5-flash --rpm 5
    poetry run python testing/eval_resume.py --models gemini:gemini-2.5-flash \\
        gemini:gemini-3.5-flash --runs 5 --rpm 5 --out-dir testing/out

Run it again the next day with the same arguments; it continues where it
stopped. Re-running a completed model is a no-op that says so.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

_HARNESS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_llm_chat.py")
_spec = importlib.util.spec_from_file_location("eval_llm_chat", _HARNESS)
assert _spec and _spec.loader, f"cannot load the harness from {_HARNESS}"
harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harness)


def canonical_path(out_dir: str, spec: str) -> str:
    """One stable file per spec, so a resume always finds the same target."""
    return os.path.join(out_dir, re.sub(r"[^0-9a-zA-Z.]+", "_", spec) + ".json")


def load_existing(path: str, spec: str):
    """(meta, records) already on disk, or (None, []) for a fresh start."""
    if not os.path.exists(path):
        return None, []
    with open(path) as f:
        data = json.load(f)
    return data.get("_meta"), data.get(spec, [])


def inputs_match(before, now: dict) -> bool:
    """Whether appending to this file keeps it a single measurement.

    Only the fields that change what a run measures. recorded_at and host are
    expected to differ between days and machines; the prompt, the validator and
    the answer key are not.
    """
    if not before:
        return True
    keys = ("chat_py_sha", "cases_sha256")
    return all(before.get(k) == now.get(k) for k in keys)


def save(path: str, spec: str, meta: dict, records: list) -> None:
    """Write the whole file. Called after every case, so an interruption at any
    point leaves a valid, complete-as-far-as-it-got file rather than nothing."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"_meta": meta, spec: records}, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", required=True, help="provider:model specs")
    parser.add_argument("--runs", type=int, default=5, help="target passes over the golden set (default 5)")
    parser.add_argument("--rpm", type=int, default=0, help="throttle to N requests/minute (use 5 for the RPD=20 Gemini models)")
    parser.add_argument("--out-dir", default="testing/out", help="directory holding the canonical per-spec files")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    cases = harness.load_cases()
    target = args.runs * len(cases)
    meta = harness.run_metadata()
    harness.warn_if_inputs_are_unfrozen(meta)

    for spec in args.models:
        path = canonical_path(args.out_dir, spec)
        before, records = load_existing(path, spec)

        if not inputs_match(before, meta):
            print(
                f"  !! {spec}: {os.path.basename(path)} was measured with different inputs\n"
                f"     on disk: chat.py={(before or {}).get('chat_py_sha')} golden={(before or {}).get('cases_sha256')}\n"
                f"     now:     chat.py={meta.get('chat_py_sha')} golden={meta.get('cases_sha256')}\n"
                "     Appending would mix two measurements in one file. Move the old file aside\n"
                "     and start over, or check out the commit it was measured against.",
                file=sys.stderr,
            )
            continue

        done = len(records)
        if done >= target:
            print(f"  {spec}: already complete ({done}/{target}), nothing to do")
            continue

        print(f"  {spec}: resuming at {done}/{target} (pass {done // len(cases) + 1}, case {done % len(cases)})")
        provider = harness.build_provider(spec)
        last_call_at = [None]
        added = 0
        try:
            for i in range(done, target):
                records.append(harness.run_case(provider, cases[i % len(cases)], spec, args.rpm, last_call_at))
                added += 1
                save(path, spec, meta, records)
        except harness.DailyQuotaExhausted as e:
            print(f"  {spec}: daily quota exhausted after {added} new calls — resume tomorrow ({e})", file=sys.stderr)
        except KeyboardInterrupt:
            print(f"  {spec}: interrupted after {added} new calls, {len(records)}/{target} saved", file=sys.stderr)
            return 130

        print(f"  {spec}: {len(records)}/{target} recorded -> {path}")
        if len(records) >= target:
            harness.print_report(spec, records, args.runs)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
