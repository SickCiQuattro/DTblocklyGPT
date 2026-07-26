#!/usr/bin/env python3
"""
Analysis/report generator for testing/eval_llm_chat.py --json output.

Reads one or more JSON result files (each shaped {"provider:model": [per-case-
per-run result dict, ...]}), merges them, and prints the tables + generates
the charts needed for the thesis chapter comparing LLMs on the chat pipeline:
accuracy per model/category, IT vs EN gap, latency distribution, cost per 100
requests, local-model tokens/sec, and a model-size vs accuracy curve for the
Ollama scale (3B -> 14B).

Run with:
    poetry run python testing/eval_llm_report.py out/run1.json out/run2.json --out-dir out/charts
"""
import argparse
import json
import re
import statistics
from collections import defaultdict

# Matplotlib is only needed for the two chart outputs; keep console tables
# working even if it's missing (e.g. before `poetry install` on a fresh Mac).
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    plt = None

# Rough parameter count (in billions) parsed from an Ollama tag, used only
# for the model-size vs accuracy curve. Not meaningful for cloud models.
# Matches both the "b" (billions, e.g. qwen2.5:3b) and "m" (millions, e.g.
# granite4:350m) suffixes Ollama tags use for sub-1B models.
_SIZE_RE = re.compile(r":(\d+(?:\.\d+)?)([bm])(?:-|$)")


def load_results(paths):
    """Merge {spec: [result, ...]} dicts from multiple JSON files."""
    merged = defaultdict(list)
    for path in paths:
        with open(path) as f:
            data = json.load(f)
        for spec, results in data.items():
            merged[spec].extend(results)
    return merged


def _pass_rate(results):
    return sum(1 for r in results if r.get("pass")) / len(results) * 100 if results else 0.0


def report_accuracy(all_results):
    print("\n" + "=" * 70)
    print("ACCURACY PER MODEL (mean ± stdev of per-case pass rate across runs)")
    print("=" * 70)
    for spec, results in all_results.items():
        by_name = defaultdict(list)
        for r in results:
            by_name[r["name"]].append(1.0 if r.get("pass") else 0.0)
        per_case_rates = [statistics.mean(v) * 100 for v in by_name.values()]
        mean = statistics.mean(per_case_rates)
        std = statistics.stdev(per_case_rates) if len(per_case_rates) > 1 else 0.0
        print(f"  {spec}: {mean:.1f}% ± {std:.1f}  (overall pass rate {_pass_rate(results):.1f}%, n={len(results)} calls)")

        by_category = defaultdict(list)
        for r in results:
            by_category[r.get("category") or "uncategorized"].append(r)
        for cat, rs in sorted(by_category.items()):
            print(f"      {cat}: {_pass_rate(rs):.1f}% (n={len(rs)})")


def report_multilingual(all_results):
    print("\n" + "=" * 70)
    print("MULTILINGUAL ROBUSTNESS: EN vs IT pass rate")
    print("=" * 70)
    for spec, results in all_results.items():
        en = [r for r in results if r.get("lang") == "en"]
        it = [r for r in results if r.get("lang") == "it"]
        mixed = [r for r in results if r.get("lang") == "mixed"]
        if not en and not it:
            continue
        en_rate, it_rate = _pass_rate(en), _pass_rate(it)
        gap = en_rate - it_rate
        line = f"  {spec}: EN {en_rate:.1f}% (n={len(en)})  |  IT {it_rate:.1f}% (n={len(it)})  |  gap {gap:+.1f}pp"
        if mixed:
            line += f"  |  code-switch {_pass_rate(mixed):.1f}% (n={len(mixed)})"
        print(line)


def report_latency(all_results, out_dir):
    print("\n" + "=" * 70)
    print("LATENCY")
    print("=" * 70)
    labels, series = [], []
    for spec, results in all_results.items():
        latencies = [r["latency_ms"] for r in results if "latency_ms" in r]
        if not latencies:
            continue
        mean = statistics.mean(latencies)
        median = statistics.median(latencies)
        std = statistics.stdev(latencies) if len(latencies) > 1 else 0.0
        print(f"  {spec}: mean {mean:.0f}ms | median {median:.0f}ms | stdev {std:.0f}ms")
        labels.append(spec)
        series.append(latencies)

    if plt is None or not series:
        if plt is None:
            print("  (matplotlib not installed, skipping latency boxplot)")
        return
    fig, ax = plt.subplots(figsize=(max(6, len(labels) * 1.2), 5))
    ax.boxplot(series, tick_labels=labels)
    ax.set_ylabel("latency (ms)")
    title = "Latency distribution per model"

    # A handful of retry-exhausted timeouts on one model (100s+) can dwarf
    # every other model's sub-10s box on a linear axis. Switch to log scale
    # once the spread is wide enough that it would otherwise flatten
    # everything but the outliers into an unreadable line.
    all_values = [v for s in series for v in s if v > 0]
    if all_values and max(all_values) / statistics.median(all_values) > 20:
        ax.set_yscale("log")
        title += " (log scale, outlier timeouts compress the linear axis)"
    ax.set_title(title)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout()
    path = f"{out_dir}/latency_boxplot.png"
    fig.savefig(path)
    plt.close(fig)
    print(f"  boxplot saved to {path}")


def report_cost(all_results):
    print("\n" + "=" * 70)
    print("COST PER 100 REQUESTS")
    print("=" * 70)
    for spec, results in all_results.items():
        priced = [r["cost_usd"] for r in results if r.get("cost_usd") is not None]
        if not results:
            continue
        if spec.startswith("ollama:"):
            print(f"  {spec}: $0.00 (local, no API cost)")
        elif priced:
            avg = statistics.mean(priced)
            print(f"  {spec}: ${avg * 100:.4f}")
        else:
            print(f"  {spec}: $0.00 or unpriced (no cost data, check free-tier / COST_PER_MTOK)")


def report_tokens_per_sec(all_results):
    print("\n" + "=" * 70)
    print("LOCAL MODEL THROUGHPUT (tokens/sec, completion tokens only)")
    print("=" * 70)
    for spec, results in all_results.items():
        if not spec.startswith("ollama:"):
            continue
        rates = []
        for r in results:
            tokens = r.get("completion_tokens")
            latency_s = r.get("latency_ms", 0) / 1000
            if tokens and latency_s > 0:
                rates.append(tokens / latency_s)
        if rates:
            print(f"  {spec}: {statistics.mean(rates):.1f} tok/s (mean over {len(rates)} calls)")


def report_size_vs_accuracy(all_results, out_dir):
    print("\n" + "=" * 70)
    print("MODEL SIZE vs ACCURACY (Ollama scale)")
    print("=" * 70)
    points = []  # (size_b, accuracy, label)
    for spec, results in all_results.items():
        if not spec.startswith("ollama:"):
            continue
        m = _SIZE_RE.search(spec)
        if not m:
            continue
        size_b = float(m.group(1))
        if m.group(2) == "m":
            size_b /= 1000
        acc = _pass_rate(results)
        points.append((size_b, acc, spec))
        print(f"  {spec}: {size_b:g}B -> {acc:.1f}% pass rate")

    if plt is None or len(points) < 2:
        if plt is None:
            print("  (matplotlib not installed, skipping curve)")
        return
    points.sort(key=lambda p: p[0])
    sizes = [p[0] for p in points]
    accs = [p[1] for p in points]
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.plot(sizes, accs, marker="o")
    for size_b, acc, label in points:
        ax.annotate(label.split(":", 1)[1], (size_b, acc), textcoords="offset points", xytext=(5, 5), fontsize=8)
    ax.set_xlabel("model size (B parameters)")
    ax.set_ylabel("pass rate (%)")
    ax.set_title("Local model scale vs task accuracy")
    plt.tight_layout()
    path = f"{out_dir}/size_vs_accuracy.png"
    fig.savefig(path)
    plt.close(fig)
    print(f"  curve saved to {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("json_files", nargs="+", help="one or more JSON files produced by eval_llm_chat.py --json")
    parser.add_argument("--out-dir", default="testing/out", help="directory for chart PNGs (default: testing/out)")
    args = parser.parse_args()

    import os
    os.makedirs(args.out_dir, exist_ok=True)

    all_results = load_results(args.json_files)
    if not all_results:
        print("No results found in the given JSON file(s).")
        return 1

    report_accuracy(all_results)
    report_multilingual(all_results)
    report_latency(all_results, args.out_dir)
    report_cost(all_results)
    report_tokens_per_sec(all_results)
    report_size_vs_accuracy(all_results, args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
