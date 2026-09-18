"""Turn recognition-bench result files into the table a thesis can cite.

    poetry run python testing/recognition_report.py testing/out/recognition_*.json
    poetry run python testing/recognition_report.py testing/out/manual_*.csv
    poetry run python testing/recognition_report.py --csv out.csv testing/out/*.json

Reads the shared `recognition-bench/1` schema written by both benches — the
gesture one (testing/measure_gesture_accuracy.py) and the voice one (the
/measure/voice page in the app) — and also the hand-filled score sheets from
testing/recognition_plan.py, so a session counted by eye goes through exactly
the same statistics as an automated one. Reports per class:

  * recognized: the window produced at least one observation equal to the
    expected class. This is the operator-relevant definition: a step resolves
    the moment the right thing is seen once, not on a majority of frames.
  * confused: the window produced observations, none of them the expected one.
  * missed: the window produced nothing at all.
  * a 95% Wilson interval on the recognition rate.
  * median onset latency, over the windows that were recognized.

and, separately, the FALSE POSITIVE rate over the silence/rest class, which is
the number that decides whether a channel is safe to leave armed during a run.

Two conventions worth knowing before quoting anything from here:

* Wilson, not the naive proportion, and not a normal approximation. At these
  sample sizes (tens of trials) the normal interval is wrong at the edges in
  the direction that flatters the result: 10/10 gives a symmetric interval of
  [1.0, 1.0], which claims certainty from ten trials. Wilson gives
  [0.72, 1.0], which is what ten trials actually support.
* The two channels are NOT directly comparable as engineering artifacts. The
  gesture engine is local MediaPipe; the voice recognizer is a remote Google
  service whose behaviour on a later date is not guaranteed. Report them side
  by side, but do not attribute a difference between them to the design of
  this system.

Standard library only, same constraint as studio-utenti/analisi.py.
"""

import os
import sys
import csv
import json
import math
import glob
import argparse
import statistics
from collections import Counter, defaultdict


def wilson(successes: int, total: int, z: float = 1.959963985) -> tuple:
    """95% Wilson score interval for a binomial proportion.

    Degenerate cases are the point: with total=0 there is nothing to say, and
    with successes==total the upper bound is 1.0 while the lower bound still
    reflects how few trials there were.
    """
    if total == 0:
        return (0.0, 1.0)
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def rule_of_three(total: int) -> float:
    """Upper 95% bound on the error rate when zero errors were observed.

    The one-line sanity check on sample size: 3/n. Ten clean trials bound the
    error rate at 30%, thirty at 10%. Printed next to a perfect score so a
    perfect score cannot be read as a strong one.

    Clamped at 1.0. Below three trials the raw ratio exceeds one and printing
    it as a percentage produced "bounds the error rate at 150%", which reads
    like a number while meaning "this bounds nothing". Callers check for 1.0
    and say that in words instead.
    """
    if not total:
        return 1.0
    return min(1.0, 3.0 / total)


def load_manual_csv(path: str) -> list:
    """Turn a hand-filled score sheet into the same shape the benches emit.

    One row per trial, `observed` holding what the observer saw — a class name,
    or NONE / blank for "nothing appeared". An observer cannot record onset
    latency by eye, so those fields stay None and the report simply prints no
    latency for these runs rather than inventing one.

    Rows are grouped by (channel, operator): one sheet is one run, but a file
    that ended up holding two people's trials still reports them apart instead
    of silently pooling two hands into one number.
    """
    with open(path, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("expected") or "").strip()]
    if not rows:
        return []

    grouped = defaultdict(list)
    for r in rows:
        grouped[(r.get("channel", "").strip(), r.get("operator", "").strip())].append(r)

    runs = []
    for (channel, operator), group in grouped.items():
        silence = "REST" if channel == "gesture" else "SILENCE"
        windows = []
        for r in group:
            observed = (r.get("observed") or "").strip().upper()
            # Blank is NOT "nothing observed": it is a trial the observer did
            # not score, and counting it as a miss would invent data. Skipped
            # loudly below so a half-filled sheet cannot quietly deflate a rate.
            if not observed:
                continue
            windows.append({
                "expected": r["expected"].strip().upper(),
                "observations": [] if observed in ("NONE", "-", "NULL") else [observed],
                "onset_any_s": None,
                "onset_correct_s": None,
            })
        unscored = len(group) - len(windows)
        if unscored:
            print(f"  {os.path.basename(path)}: {unscored} unscored row(s) skipped "
                  f"({operator or 'unnamed'}, {channel}) — blank means 'not run', "
                  "not 'nothing seen'.")
        classes = sorted({w["expected"] for w in windows} | {silence})
        runs.append({
            "schema": "recognition-bench/1",
            "channel": channel or "unknown",
            "operator": operator,
            "trials_per_class": None,
            "hold_s": None,
            "seed": group[0].get("seed", ""),
            "classes": [c for c in classes if c != silence] + [silence],
            "silence_class": silence,
            "meta": {
                "method": "hand-counted from the app's Test recognition panel",
                # Said plainly because it is the one thing a reader of the
                # table cannot tell from the numbers: these rows measure the
                # whole delivered chain, the automated ones stop at the
                # recognizer, and neither carries latency here.
                "note": "Observer-scored. Covers HTTP and rendering as well as the "
                        "recognizer; no onset latency (not measurable by eye).",
            },
            "windows": windows,
            "_path": path,
        })
    return runs


def load(paths: list) -> list:
    runs = []
    for path in paths:
        if path.lower().endswith(".csv"):
            runs.extend(load_manual_csv(path))
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("schema") != "recognition-bench/1":
            print(f"  skipping {os.path.basename(path)}: not a recognition-bench file")
            continue
        data["_path"] = path
        runs.append(data)
    return runs


def summarize(run: dict) -> dict:
    """Per-class counts, latencies, and the confusion pairs, for one file."""
    silence = run.get("silence_class")
    per_class = defaultdict(lambda: {
        "recognized": 0, "confused": 0, "missed": 0,
        "onsets": [], "observed": Counter(),
    })

    for w in run.get("windows", []):
        expected = w["expected"]
        obs = w.get("observations") or []
        bucket = per_class[expected]
        for o in obs:
            bucket["observed"][o] += 1
        if expected == silence:
            # A silence/rest window has no "correct" observation — any
            # observation at all is the failure. Counted separately below.
            if obs:
                bucket["confused"] += 1
            else:
                bucket["recognized"] += 1
            continue
        if expected in obs:
            bucket["recognized"] += 1
            if w.get("onset_correct_s") is not None:
                bucket["onsets"].append(w["onset_correct_s"])
        elif obs:
            bucket["confused"] += 1
        else:
            bucket["missed"] += 1

    return per_class


def print_run(run: dict) -> list:
    silence = run.get("silence_class")
    per_class = summarize(run)
    rows = []

    print(f"\n{'=' * 78}")
    print(f"{run['channel'].upper()}  ·  operator {run.get('operator') or '(unnamed)'}"
          f"  ·  {os.path.basename(run['_path'])}")
    meta = run.get("meta", {})
    detail = ", ".join(f"{k}={v}" for k, v in meta.items() if k != "note")
    print(f"  {detail}")
    if meta.get("note"):
        print(f"  NOTE: {meta['note']}")
    if run.get("trials_per_class") is not None:
        print(f"  trials/class={run.get('trials_per_class')} window={run.get('hold_s')}s "
              f"seed={run.get('seed')}")
    else:
        print(f"  seed={run.get('seed')}")
    print(f"{'=' * 78}")

    header = f"{'class':<14}{'n':>4}{'ok':>5}{'conf':>6}{'miss':>6}{'rate':>8}{'95% CI':>16}{'onset':>8}"
    print(header)
    print("-" * 78)

    for cls in run.get("classes", sorted(per_class)):
        b = per_class.get(cls)
        if not b:
            continue
        n = b["recognized"] + b["confused"] + b["missed"]
        lo, hi = wilson(b["recognized"], n)
        onset = statistics.median(b["onsets"]) if b["onsets"] else None
        rate = b["recognized"] / n if n else 0.0
        tag = "  (silence)" if cls == silence else ""
        print(f"{cls:<14}{n:>4}{b['recognized']:>5}{b['confused']:>6}{b['missed']:>6}"
              f"{rate:>7.1%}{f'[{lo:.2f}, {hi:.2f}]':>16}"
              f"{f'{onset:.2f}s' if onset is not None else '—':>8}{tag}")
        rows.append({
            "channel": run["channel"], "operator": run.get("operator", ""),
            "class": cls, "n": n, "recognized": b["recognized"],
            "confused": b["confused"], "missed": b["missed"],
            "rate": round(rate, 4), "ci_low": round(lo, 4), "ci_high": round(hi, 4),
            "onset_median_s": round(onset, 3) if onset is not None else "",
        })
        if n and b["recognized"] == n:
            bound = rule_of_three(n)
            if bound >= 1.0:
                print(f"{'':<14}perfect on {n} trials — too few to bound the error "
                      "rate at all.")
            else:
                print(f"{'':<14}perfect on {n} trials — that bounds the error rate at "
                      f"{bound:.0%}, no lower.")

    # The number that decides whether the channel can be left armed.
    if silence and silence in per_class:
        b = per_class[silence]
        n = b["recognized"] + b["confused"]
        fp = b["confused"]
        lo, hi = wilson(fp, n)
        print("-" * 78)
        print(f"FALSE POSITIVES on {silence}: {fp}/{n} windows = {fp / n if n else 0:.1%} "
              f"(95% CI [{lo:.2f}, {hi:.2f}])")
        if fp:
            print(f"  emitted while the operator was idle: {dict(b['observed'])}")
            print("  Each of these would have resolved a waiting step on its own.")

    # Confusions, only where they happened — an all-zero matrix is noise.
    pairs = [(cls, dict(b["observed"])) for cls, b in per_class.items()
             if cls != silence and any(k != cls for k in b["observed"])]
    if pairs:
        print("-" * 78)
        print("confusions (expected -> what was actually observed):")
        for cls, observed in pairs:
            wrong = {k: v for k, v in observed.items() if k != cls}
            if wrong:
                print(f"  {cls:<14} {wrong}")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("paths", nargs="+",
                        help="bench JSON or hand-filled CSV score sheets (globs ok)")
    parser.add_argument("--csv", default=None, help="also write the table as CSV")
    args = parser.parse_args()

    expanded = []
    for p in args.paths:
        expanded.extend(sorted(glob.glob(p)) or [p])
    runs = load(expanded)
    if not runs:
        sys.exit("No recognition-bench files to report on.")

    rows = []
    for run in runs:
        rows.extend(print_run(run))

    # Pooling across operators is the point of running more than one person:
    # a single operator's hand or accent is not the population the system will
    # meet, and per-operator tables alone invite reading one person's number as
    # the system's number.
    by_channel = defaultdict(lambda: {"ok": 0, "n": 0})
    operators = defaultdict(set)
    for run in runs:
        operators[run["channel"]].add(run.get("operator") or "(unnamed)")
        silence = run.get("silence_class")
        for cls, b in summarize(run).items():
            if cls == silence:
                continue
            agg = by_channel[run["channel"]]
            agg["ok"] += b["recognized"]
            agg["n"] += b["recognized"] + b["confused"] + b["missed"]

    print(f"\n{'=' * 78}\nPOOLED (silence class excluded)\n{'=' * 78}")
    for channel, agg in by_channel.items():
        lo, hi = wilson(agg["ok"], agg["n"])
        who = ", ".join(sorted(operators[channel]))
        print(f"{channel:<10} {agg['ok']}/{agg['n']} = {agg['ok'] / agg['n']:.1%} "
              f"(95% CI [{lo:.2f}, {hi:.2f}])  ·  operators: {who}")
    if len(by_channel) > 1:
        print("\nDo not read a gap between these two as a property of this system's "
              "design:\nthe gesture engine is local, the voice recognizer is a remote "
              "Google service.")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {args.csv}")


if __name__ == "__main__":
    main()
