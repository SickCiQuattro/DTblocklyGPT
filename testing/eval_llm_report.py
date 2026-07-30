#!/usr/bin/env python3
"""
Analysis/report generator for testing/eval_llm_chat.py --json output.

Reads one or more JSON result files (each shaped {"provider:model": [per-case-
per-run result dict, ...]}), merges them, and prints the tables + generates
the charts needed for the thesis chapter comparing LLMs on the chat pipeline:
accuracy per model/category, IT vs EN gap, latency distribution, cost vs
accuracy, local-model tokens/sec, thinking-vs-nothink toggle, model-size vs
accuracy curve, and a documented bug-fix before/after.

Every chart shares one thesis-ready style: a CVD-safe categorical palette
(validated with the dataviz skill's contrast/CVD checker), 300 DPI PNG +
vector PDF output (for LaTeX \\includegraphics), direct data labels so a
black-and-white printout stays legible, and consistent typography/spacing
across the whole figure set.

Run with:
    poetry run python testing/eval_llm_report.py out/run1.json out/run2.json --out-dir out/charts
"""
import argparse
import json
import os
import re
import statistics
from collections import defaultdict

# Matplotlib is only needed for chart output; keep console tables working
# even if it's missing (e.g. before `poetry install` on a fresh Mac).
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    import numpy as np
except ImportError:
    plt = None

# Rough parameter count (in billions) parsed from an Ollama tag, used only
# for the model-size vs accuracy curve. Not meaningful for cloud models.
# Matches both the "b" (billions, e.g. qwen2.5:3b) and "m" (millions, e.g.
# granite4:350m) suffixes Ollama tags use for sub-1B models.
_SIZE_RE = re.compile(r":(\d+(?:\.\d+)?)([bm])(?:-|$)")

# Gemini paid-tier list price (source: ai.google.dev/gemini-api/docs/pricing,
# fetched 2026-07-30), $ per million tokens (input, output). All Gemini
# testing in this study ran on the FREE tier (real cost $0) -- this table is
# used only to *estimate* what the same measured token counts would have
# cost on the paid tier, never to overwrite the real $0 the harness recorded.
# Gemma (gemma-4-26b-a4b-it, gemma-4-31b-it) has no published paid tier via
# this API as of the same fetch, so it's excluded from the estimate, not
# assigned a $0/guessed price.
GEMINI_COST_PER_MTOK = {
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3-flash-preview": (0.50, 3.00),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-3.5-flash-lite": (0.30, 2.50),
}


def _estimate_gemini_cost(spec, results):
    """Total estimated paid-tier cost for a Gemini spec, computed from the
    prompt/completion token counts already recorded during the (real, free,
    $0) test calls. Returns None for non-Gemini specs or models without a
    published paid price."""
    if not spec.startswith("gemini:"):
        return None
    model = spec.split(":", 1)[1]
    pricing = GEMINI_COST_PER_MTOK.get(model)
    if pricing is None:
        return None
    price_in, price_out = pricing
    pt = sum(r.get("prompt_tokens") or 0 for r in results)
    ct = sum(r.get("completion_tokens") or 0 for r in results)
    return pt / 1e6 * price_in + ct / 1e6 * price_out

# Canonical category order (matches the golden-set description in
# EVAL_HANDOFF.md / LLM_Local.md) so every categorical chart reads in the
# same order instead of alphabetical.
_CATEGORY_ORDER = [
    "core", "hallucination_guard", "nested_logic", "codeswitch",
    "long_sequence", "condition_variant", "combo",
]

# ---------------------------------------------------------------------------
# Thesis-ready chart style. Palette is the dataviz-skill reference instance
# (validated for CVD-safety and normal-vision separation on a light/print
# surface via scripts/validate_palette.js — see the chat that introduced this
# file for the exact validator output). Bars/lines use ONE hue by default
# (identity is already carried by the axis label, not by color) and only
# reach for a second hue to mark a genuine second category (baseline vs rest,
# positive vs negative gap, thinking vs nothink).
#
# Palette derived from the thesis's own brand colors (Blu Notte #27326E,
# Neutro Caldo, Nero Testo #1D1D1B) instead of the dataviz-skill generic
# default, re-validated in OKLCH the same way: #27326E itself is too dark for
# a thin mark (OKLCH L=0.343, below the 0.43-0.77 band a bar/cell needs to
# stay legible), so BLU_CHART keeps the same 272 deg hue lifted to a usable
# lightness. Red is reserved for genuine comparison/polarity (before/after,
# EN vs IT, thinking vs nothink) and never reused as a plain 4th series
# color elsewhere in the chapter. Orange is reserved for an actual grouping
# (e.g. one model family's scaling line vs every other family as reference
# points) -- never to single out one bar among same-kind bars; a highlighted
# single bar gets a bold label + dark edge instead of a second hue, so color
# never does identity work the label already does.
PALETTE = {
    "blue": "#445392", "orange": "#eb6834", "red": "#e34948",
}
INK = {
    "primary": "#1D1D1B", "secondary": "#52514e", "muted": "#898781",
    "grid": "#c9c7bd", "axis": "#a8a69c",
}
# Sequential ramp for the heatmap, same hue family as BLU_CHART/Blu Notte,
# light->dark and monotone by construction.
HEATMAP_RAMP = ["#F7F5EB", "#dbe4ff", "#a0b3fb", "#5a6aab", "#303c79", "#1d2661"]


def _apply_thesis_style():
    if plt is None:
        return
    plt.rcParams.update({
        "figure.dpi": 150, "savefig.dpi": 300,
        "font.family": "sans-serif",
        "font.size": 10,
        "axes.titlesize": 11, "axes.titleweight": "bold",
        "axes.labelcolor": INK["primary"],
        "xtick.color": INK["muted"], "ytick.color": INK["muted"],
        "text.color": INK["primary"],
        "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
    })


def _style_axes(ax, grid_axis="y"):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(INK["axis"])
    ax.spines["bottom"].set_color(INK["axis"])
    if grid_axis:
        ax.grid(axis=grid_axis, color=INK["grid"], linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)


def _save(fig, out_dir, name):
    """Save both a 300 DPI PNG (quick preview) and a vector PDF (LaTeX)."""
    if plt is None:
        return
    png = os.path.join(out_dir, f"{name}.png")
    pdf = os.path.join(out_dir, f"{name}.pdf")
    fig.savefig(png, dpi=300, bbox_inches="tight")
    fig.savefig(pdf, bbox_inches="tight")
    plt.close(fig)
    print(f"  saved {png} (+ .pdf)")


def _short(spec):
    """'gemini:gemini-2.5-flash' -> 'gemini-2.5-flash'; keeps ollama-nothink
    distinguishable from its thinking counterpart (same tag otherwise)."""
    label = spec.split(":", 1)[1]
    if spec.startswith("ollama-nothink"):
        label += " (nothink)"
    return label


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


def _boxplot_one(labels, series, out_dir, name, title):
    """Shared boxplot renderer, capped to a thesis-page-friendly width
    regardless of how many models are in the group (font shrinks a bit
    before the figure keeps growing, so a 10+ model group still fits one
    printed page instead of stretching across several)."""
    if plt is None or not series:
        return
    n = len(labels)
    width = min(10.5, max(5, n * 0.85))
    fontsize = 9 if n <= 10 else 7.5
    fig, ax = plt.subplots(figsize=(width, 5))
    ax.boxplot(
        series, tick_labels=labels, patch_artist=True,
        boxprops=dict(facecolor=PALETTE["blue"], alpha=0.25, edgecolor=PALETTE["blue"]),
        medianprops=dict(color=HEATMAP_RAMP[-1], linewidth=2),  # darkest step of the same blue family, not a new hue
        whiskerprops=dict(color=INK["secondary"]),
        capprops=dict(color=INK["secondary"]),
        flierprops=dict(markeredgecolor=INK["muted"], markersize=4),
    )
    ax.set_ylabel("latenza (ms)")

    # A handful of retry-exhausted timeouts on one model (100s+) can dwarf
    # every other model's sub-10s box on a linear axis. Switch to log scale
    # once the spread is wide enough that it would otherwise flatten
    # everything but the outliers into an unreadable line.
    all_values = [v for s in series for v in s if v > 0]
    if all_values and max(all_values) / statistics.median(all_values) > 20:
        ax.set_yscale("log")
        title += "\n(scala log: outlier di timeout comprimono l'asse lineare)"
    ax.set_title(title)
    _style_axes(ax, grid_axis="y")
    plt.xticks(rotation=40, ha="right", fontsize=fontsize)
    plt.tight_layout()
    _save(fig, out_dir, name)


def report_latency(all_results, out_dir):
    """Fig 6.5/6.6 — latency distribution, split into a cloud chart and a
    local chart. One combined boxplot across ~20 models (cloud + every
    Ollama variant) comes out too wide for a printed page and mixes two
    different sections of the thesis into one figure; splitting by
    cloud/local keeps each chart at a sane, single-page width and puts each
    where it's actually discussed."""
    print("\n" + "=" * 70)
    print("LATENCY")
    print("=" * 70)
    cloud_labels, cloud_series = [], []
    local_labels, local_series = [], []
    for spec, results in all_results.items():
        latencies = [r["latency_ms"] for r in results if "latency_ms" in r]
        if not latencies:
            continue
        mean = statistics.mean(latencies)
        median = statistics.median(latencies)
        std = statistics.stdev(latencies) if len(latencies) > 1 else 0.0
        print(f"  {spec}: mean {mean:.0f}ms | median {median:.0f}ms | stdev {std:.0f}ms")
        if spec.startswith("ollama"):
            local_labels.append(_short(spec))
            local_series.append(latencies)
        else:
            cloud_labels.append(_short(spec))
            cloud_series.append(latencies)

    if plt is None:
        print("  (matplotlib not installed, skipping latency boxplots)")
        return
    _boxplot_one(cloud_labels, cloud_series, out_dir, "latency_boxplot_cloud",
                 "Distribuzione della latenza per modello (cloud)")
    _boxplot_one(local_labels, local_series, out_dir, "latency_boxplot_local",
                 "Distribuzione della latenza per modello (locale)")


def report_cost(all_results):
    print("\n" + "=" * 70)
    print("COST PER 100 REQUESTS")
    print("=" * 70)
    for spec, results in all_results.items():
        priced = [r["cost_usd"] for r in results if r.get("cost_usd") is not None]
        if not results:
            continue
        if spec.startswith("ollama"):
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
        if not spec.startswith("ollama"):
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
    """Fig 6.6 — model size vs accuracy for the local matrix.

    Only genuinely same-family points (Qwen2.5 3B/7B/14B, the one series
    where "bigger" is actually the same architecture/training recipe at a
    different scale) are connected by a line — that connection is the real
    "scaling isn't monotone" story. Every other point is a different
    architecture that happens to land near the same parameter count; drawing
    one continuous line through all of them would visually claim a single
    scaling trend across unrelated model families, which is the trend-line
    anti-pattern (connecting categorically distinct points implies a
    continuity the data doesn't have). They're plotted as unconnected
    reference points instead, colored by family so an evolutive pair
    (Qwen2.5->Qwen3.5, Granite4->Granite4.1) still reads as related without a
    line falsely spanning families.
    """
    print("\n" + "=" * 70)
    print("MODEL SIZE vs ACCURACY (Ollama scale)")
    print("=" * 70)
    points = []  # (size_b, accuracy, label, family)

    def _family(spec):
        name = spec.split(":", 1)[1]
        if name.startswith("qwen2.5:"):
            return "qwen2.5"
        if name.startswith("qwen2.5-coder"):
            return "qwen2.5-coder"
        if "qwen3.5" in name:
            return "qwen3.5"
        if name.startswith("granite4:"):
            return "granite4"
        if name.startswith("granite4.1"):
            return "granite4.1"
        if name.startswith("llama"):
            return "llama3.1"
        if name.startswith("gemma4"):
            return "gemma4"
        return "altro"

    for spec, results in all_results.items():
        if not spec.startswith("ollama"):
            continue
        m = _SIZE_RE.search(spec)
        if not m:
            continue
        size_b = float(m.group(1))
        if m.group(2) == "m":
            size_b /= 1000
        acc = _pass_rate(results)
        points.append((size_b, acc, spec, _family(spec)))
        print(f"  {spec}: {size_b:g}B -> {acc:.1f}% pass rate")

    if plt is None or len(points) < 2:
        if plt is None:
            print("  (matplotlib not installed, skipping curve)")
        return

    fig, ax = plt.subplots(figsize=(8, 6))

    qwen25 = sorted([p for p in points if p[3] == "qwen2.5"], key=lambda p: p[0])
    others = [p for p in points if p[3] != "qwen2.5"]
    if len(qwen25) > 1:
        ax.plot([p[0] for p in qwen25], [p[1] for p in qwen25], color=PALETTE["blue"],
                linewidth=1.5, zorder=2, label="qwen2.5 (3B→7B→14B, stessa famiglia)")
    ax.scatter([p[0] for p in qwen25], [p[1] for p in qwen25], s=70, color=PALETTE["blue"],
               edgecolor="white", linewidth=1, zorder=3)
    ax.scatter([p[0] for p in others], [p[1] for p in others], s=70, color=PALETTE["orange"],
               edgecolor="white", linewidth=1, zorder=3, label="altre famiglie (riferimento, non in scala continua)")

    # Label placement: hand-placed per model, not algorithmic. This chart's
    # crowded region (7-9B, 49-64% pass rate) has THREE different x=7/8/9
    # clusters sitting close enough in y that any per-x-group-only offset
    # rule still collides across groups -- a generic rule can't see that.
    # With a fixed, small (10-model) roster for this thesis figure, manual
    # (dx, dy, ha, va) per label is the reliable fix; verified by rendering.
    # Falls back to a plain upper-right offset for any model not listed
    # (e.g. if the local matrix grows later).
    label_offsets = {
        "granite4:350m": (8, 8, "left", "bottom"),
        "qwen2.5:3b": (8, 8, "left", "bottom"),
        "qwen2.5:7b": (-10, 20, "right", "bottom"),
        "qwen2.5-coder:7b": (0, -16, "center", "top"),
        "granite4.1:8b": (10, -16, "left", "top"),
        "llama3.1:8b": (0, 16, "center", "bottom"),
        "qwen3.5:9b": (10, -16, "left", "top"),
        "qwen3.5:9b (nothink)": (0, 14, "center", "bottom"),
        "gemma4:12b-it-qat (nothink)": (10, 10, "left", "bottom"),
        "qwen2.5:14b": (8, 8, "left", "bottom"),
    }
    for size_b, acc, label, _fam in points:
        short = _short(label)
        dx, dy, ha, va = label_offsets.get(short, (8, 8, "left", "bottom"))
        ax.annotate(short, (size_b, acc), textcoords="offset points",
                    xytext=(dx, dy), fontsize=8, color=INK["secondary"], va=va, ha=ha)

    ax.set_xlabel("dimensione modello (miliardi di parametri)")
    ax.set_ylabel("pass rate (%)")
    ax.set_ylim(0, max(p[1] for p in points) + 16)  # headroom for the topmost point's label
    ax.set_title("Scala dei modelli locali vs accuratezza sul task")
    ax.legend(loc="lower right", frameon=False, fontsize=8)
    _style_axes(ax, grid_axis="both")
    plt.tight_layout()
    _save(fig, out_dir, "size_vs_accuracy")


def report_pass_rate_bar(all_results, out_dir, baseline_spec="gemini:gemini-3.5-flash-lite"):
    """Fig 6.5 — headline bar chart: overall pass rate per cloud model.

    All bars share one hue (identity is already carried by the y-axis
    label); the baseline model is called out with a bold label and a dark
    edge instead of a second color, so orange/red stay reserved for a real
    grouping or a real comparison elsewhere in the chapter, not a
    single-bar highlight here.
    """
    print("\n" + "=" * 70)
    print("PASS RATE PER MODEL (bar chart, cloud)")
    print("=" * 70)
    rows = []
    for spec, results in all_results.items():
        if spec.startswith("ollama"):
            continue
        rows.append((spec, _pass_rate(results), len(results)))
    if not rows:
        print("  (no cloud results)")
        return
    rows.sort(key=lambda r: r[1])
    for spec, rate, n in rows:
        flag = " (parziale)" if n < 245 else ""
        print(f"  {spec}: {rate:.1f}%{flag} (n={n})")

    if plt is None:
        return
    labels = [_short(spec) + (" *" if n < 245 else "") for spec, _, n in rows]
    values = [r[1] for r in rows]
    edgecolors = [INK["primary"] if spec == baseline_spec else "none" for spec, _, _ in rows]
    linewidths = [1.6 if spec == baseline_spec else 0 for spec, _, _ in rows]
    fig, ax = plt.subplots(figsize=(7.5, max(4, len(rows) * 0.42)))
    y = list(range(len(rows)))
    ax.barh(y, values, color=PALETTE["blue"], edgecolor=edgecolors, linewidth=linewidths, height=0.6, zorder=3)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    for i, (spec, _, _) in enumerate(rows):
        if spec == baseline_spec:
            ax.get_yticklabels()[i].set_fontweight("bold")
    for yi, v in zip(y, values):
        ax.text(v + 1, yi, f"{v:.1f}%", va="center", fontsize=9)
    ax.set_xlim(0, 108)
    ax.set_xlabel("pass rate (%)")
    ax.set_title("Accuratezza complessiva per modello (cloud)")
    _style_axes(ax, grid_axis="x")
    notes = f"Contorno in grassetto: baseline di produzione ({_short(baseline_spec)})."
    if any(n < 245 for _, _, n in rows):
        notes += "  * copertura parziale (<245 chiamate)."
    fig.text(0.01, -0.02, notes, fontsize=7, color=INK["muted"])
    plt.tight_layout()
    _save(fig, out_dir, "pass_rate_per_model")


def report_category_heatmap(all_results, out_dir):
    """Fig 6.5 — pass rate per category x model, cloud models only."""
    print("\n" + "=" * 70)
    print("PASS RATE PER CATEGORIA x MODELLO (heatmap)")
    print("=" * 70)
    cloud_specs = [s for s in all_results if not s.startswith("ollama")]
    if not cloud_specs:
        return
    seen = set()
    for s in cloud_specs:
        for r in all_results[s]:
            seen.add(r.get("category") or "uncategorized")
    categories = [c for c in _CATEGORY_ORDER if c in seen] + sorted(seen - set(_CATEGORY_ORDER))

    cloud_specs.sort(key=lambda s: _pass_rate(all_results[s]))
    matrix = []
    for s in cloud_specs:
        row = []
        for c in categories:
            rs = [r for r in all_results[s] if (r.get("category") or "uncategorized") == c]
            row.append(_pass_rate(rs) if rs else float("nan"))
        matrix.append(row)
        print(f"  {s}: " + " | ".join(f"{c}={v:.0f}%" for c, v in zip(categories, row)))

    if plt is None:
        return
    arr = np.array(matrix)
    fig, ax = plt.subplots(figsize=(1.15 * len(categories) + 3, 0.5 * len(cloud_specs) + 2))
    cmap = mcolors.LinearSegmentedColormap.from_list("blu_notte", HEATMAP_RAMP)
    cmap.set_bad(color="#f2f2f0")
    im = ax.imshow(np.ma.masked_invalid(arr), cmap=cmap, vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels(categories, rotation=30, ha="right")
    ax.set_yticks(range(len(cloud_specs)))
    ax.set_yticklabels([_short(s) for s in cloud_specs])
    for i in range(len(cloud_specs)):
        for j in range(len(categories)):
            v = arr[i, j]
            if v != v:  # NaN: no cases of this category for this model
                continue
            ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=8,
                     color="white" if v > 55 else INK["primary"])
    cbar = fig.colorbar(im, ax=ax, shrink=0.8)
    cbar.set_label("pass rate (%)")
    cbar.outline.set_visible(False)
    ax.set_title("Accuratezza per categoria e modello")
    for spine in ax.spines.values():
        spine.set_visible(False)
    plt.tight_layout()
    _save(fig, out_dir, "category_heatmap")


def report_cost_vs_accuracy(all_results, out_dir):
    """Fig 6.5 — cost vs accuracy. Two kinds of point, same hue, different
    marker style: filled circles are real charges (OpenAI, billed in the
    test itself); open circles are Gemini paid-tier ESTIMATES (all Gemini
    testing ran free-tier, real cost $0). The real/estimated split is
    explained in the thesis figure caption, not baked into the image."""
    print("\n" + "=" * 70)
    print("COSTO vs ACCURATEZZA (reale + stima Gemini a tariffa a pagamento)")
    print("=" * 70)
    real_points, est_points = [], []
    for spec, results in all_results.items():
        acc = _pass_rate(results)
        priced = [r["cost_usd"] for r in results if r.get("cost_usd") is not None]
        if priced:
            total_cost = sum(priced)
            real_points.append((spec, total_cost, acc))
            print(f"  {spec}: ${total_cost:.2f} totali reali (n={len(results)}) -> {acc:.1f}%")
            continue
        est_cost = _estimate_gemini_cost(spec, results)
        if est_cost is not None:
            est_points.append((spec, est_cost, acc))
            print(f"  {spec}: ${est_cost:.2f} totali STIMATI a tariffa a pagamento (n={len(results)}) -> {acc:.1f}% "
                  f"[testato su free tier, costo reale $0]")

    points = real_points + est_points
    if plt is None or not points:
        return
    # One hue for every point: they're all in the same cost/accuracy story,
    # and each is already identified by its direct label -- color doesn't
    # need to re-do that work (see PALETTE comment above). Marker fill (not
    # color) carries the real-vs-estimated distinction.
    #
    # Label placement: hand-placed per model, not algorithmic. Two Gemini
    # points land at essentially the same (cost, accuracy) coordinate
    # (gemini-2.5-flash $0.49/97.1% and gemini-3.5-flash-lite $0.50/97.1%) --
    # no generic offset rule tells those two apart, so this fixed, small
    # roster gets fixed offsets, verified by rendering.
    label_offsets = {
        "gemini:gemini-3.1-flash-lite": (-10, 0, "right", "center"),
        "gemini:gemini-2.5-flash": (0, 16, "center", "bottom"),
        "gemini:gemini-3.5-flash-lite": (16, 0, "left", "center"),
        "gemini:gemini-3-flash-preview": (18, 10, "left", "bottom"),
        "openai:gpt-4.1-mini": (0, -16, "center", "top"),
    }
    fig, ax = plt.subplots(figsize=(7.5, 5.5))
    for spec, cost, acc in real_points:
        ax.scatter(cost, acc, s=100, color=PALETTE["blue"], zorder=3, edgecolor="white", linewidth=1)
        dx, dy, ha, va = label_offsets.get(spec, (8, 4, "left", "center"))
        ax.annotate(_short(spec), (cost, acc), textcoords="offset points",
                    xytext=(dx, dy), fontsize=9, color=INK["primary"], ha=ha, va=va)
    for spec, cost, acc in est_points:
        ax.scatter(cost, acc, s=100, facecolor="none", edgecolor=PALETTE["blue"], linewidth=1.8, zorder=3)
        dx, dy, ha, va = label_offsets.get(spec, (8, 4, "left", "center"))
        ax.annotate(_short(spec), (cost, acc), textcoords="offset points",
                    xytext=(dx, dy), fontsize=9, color=INK["primary"], ha=ha, va=va)
    ax.set_xlabel("costo protocollo pieno (USD, 245 chiamate)")
    ax.set_ylabel("pass rate (%)")
    # Headroom above the highest point for its label, but capped so the
    # axis/gridlines never draw past 100% (a bare tick above 100 reads as an
    # error on a pass-rate axis) -- ticks are set explicitly instead of left
    # to matplotlib's auto-locator, which would otherwise add one at 105.
    ymin = min(p[2] for p in points) - 10
    ax.set_ylim(ymin, max(p[2] for p in points) + 6)
    ax.set_yticks([t for t in range(60, 101, 5) if t >= ymin - 5])
    ax.set_title("Costo vs accuratezza")
    _style_axes(ax, grid_axis="both")
    plt.tight_layout()
    _save(fig, out_dir, "cost_vs_accuracy")


def report_it_en_gap_core(all_results, out_dir):
    """Fig 6.5 — EN-IT gap on the 'core' category only (the one balanced
    50/50 in the golden set; see the multilingual-gap caveat in
    EVAL_HANDOFF.md before reading the all-category gap)."""
    print("\n" + "=" * 70)
    print("GAP IT/EN SU CATEGORIA 'core' (bilanciata 50/50)")
    print("=" * 70)
    rows = []
    for spec, results in all_results.items():
        if spec.startswith("ollama"):
            continue
        core = [r for r in results if (r.get("category") or "") == "core"]
        en = [r for r in core if r.get("lang") == "en"]
        it = [r for r in core if r.get("lang") == "it"]
        if not en or not it:
            continue
        gap = _pass_rate(en) - _pass_rate(it)
        rows.append((spec, gap))
        print(f"  {spec}: {gap:+.1f}pp (EN {_pass_rate(en):.1f}% vs IT {_pass_rate(it):.1f}%)")

    if plt is None or not rows:
        return
    rows.sort(key=lambda r: r[1])
    labels = [_short(spec) for spec, _ in rows]
    values = [g for _, g in rows]
    colors = [PALETTE["blue"] if v >= 0 else PALETTE["red"] for v in values]
    fig, ax = plt.subplots(figsize=(7, max(4, len(rows) * 0.42)))
    y = list(range(len(rows)))
    ax.barh(y, values, color=colors, height=0.6, zorder=3)
    ax.axvline(0, color=INK["axis"], linewidth=1)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    for yi, v in zip(y, values):
        ax.text(v + (0.4 if v >= 0 else -0.4), yi, f"{v:+.1f}", va="center",
                 ha="left" if v >= 0 else "right", fontsize=9)
    ax.set_xlabel("gap EN - IT (punti percentuali, categoria 'core')")
    ax.set_title("Robustezza multilingua: gap EN-IT su casi bilanciati")
    _style_axes(ax, grid_axis="x")
    fig.text(0.01, -0.02,
              "Blu = EN migliore, rosso = IT migliore. Solo categoria 'core' (16 EN + 16 IT), "
              "l'unica bilanciata del golden set.", fontsize=7, color=INK["muted"])
    plt.tight_layout()
    _save(fig, out_dir, "it_en_gap_core")


def report_thinking_toggle(all_results, out_dir, pair=("ollama:qwen3.5:9b", "ollama-nothink:qwen3.5:9b")):
    """Fig 6.6 — the one ceteris-paribus reasoning-toggle pair in the dataset:
    same weights, only the request-time think:true/false flag differs."""
    print("\n" + "=" * 70)
    print("THINKING vs NO-THINKING (stesso modello, stessi pesi)")
    print("=" * 70)
    think_spec, nothink_spec = pair
    if think_spec not in all_results or nothink_spec not in all_results:
        print(f"  (servono entrambi {think_spec} e {nothink_spec} tra i file passati)")
        return
    think_r, nothink_r = all_results[think_spec], all_results[nothink_spec]
    acc = [_pass_rate(think_r), _pass_rate(nothink_r)]
    lat = [statistics.mean([r["latency_ms"] for r in rs if "latency_ms" in r]) / 1000
           for rs in (think_r, nothink_r)]
    print(f"  accuratezza: thinking {acc[0]:.1f}% -> think:false {acc[1]:.1f}%")
    print(f"  latenza media: thinking {lat[0]:.1f}s -> think:false {lat[1]:.1f}s")

    if plt is None:
        return
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8, 4.5))
    labels = ["thinking\n(default)", "think:false"]
    colors = [PALETTE["red"], PALETTE["blue"]]
    for ax, values, ylabel, title, fmt in (
        (ax1, acc, "pass rate (%)", "Accuratezza", "{:.1f}%"),
        (ax2, lat, "latenza media (s)", "Latenza", "{:.1f}s"),
    ):
        bars = ax.bar(labels, values, color=colors, width=0.55, zorder=3)
        for b, v in zip(bars, values):
            ax.text(b.get_x() + b.get_width() / 2, v, fmt.format(v), ha="center", va="bottom", fontsize=10)
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.set_ylim(0, max(values) * 1.15)
        _style_axes(ax, grid_axis="y")
    fig.suptitle("qwen3.5:9b: ragionamento nascosto attivo vs disattivato", fontweight="bold")
    plt.tight_layout()
    _save(fig, out_dir, "thinking_toggle_qwen35_9b")


def report_tokens_per_sec_bar(all_results, out_dir):
    """Fig 6.6 — local-model throughput, bar chart version of the console table."""
    print("\n" + "=" * 70)
    print("THROUGHPUT LOCALE (tok/s, bar chart)")
    print("=" * 70)
    rows = []
    for spec, results in all_results.items():
        if not spec.startswith("ollama"):
            continue
        rates = []
        for r in results:
            tokens = r.get("completion_tokens")
            latency_s = r.get("latency_ms", 0) / 1000
            if tokens and latency_s > 0:
                rates.append(tokens / latency_s)
        if rates:
            rows.append((spec, statistics.mean(rates)))
            print(f"  {spec}: {statistics.mean(rates):.1f} tok/s")

    if plt is None or not rows:
        return
    rows.sort(key=lambda r: r[1])
    labels = [_short(spec) for spec, _ in rows]
    values = [v for _, v in rows]
    fig, ax = plt.subplots(figsize=(7, max(4, len(rows) * 0.4)))
    y = list(range(len(rows)))
    ax.barh(y, values, color=PALETTE["blue"], height=0.6, zorder=3)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    for yi, v in zip(y, values):
        ax.text(v + 0.3, yi, f"{v:.1f}", va="center", fontsize=9)
    ax.set_xlabel("token/s (completion, media)")
    ax.set_title("Throughput dei modelli locali")
    _style_axes(ax, grid_axis="x")
    plt.tight_layout()
    _save(fig, out_dir, "tokens_per_sec")


def report_bugfix_impact(out_dir):
    """Fig 6.7 — bug #3 before/after (gemini-3.5-flash-lite double-escape
    parsing fix). Numbers are the two verified measurements documented in
    EVAL_HANDOFF.md bug #3, not derived from a passed-in file: the pre-fix
    run was superseded in place once the fix landed, so there is no separate
    clean artifact to re-aggregate generically here."""
    print("\n" + "=" * 70)
    print("IMPATTO FIX BUG #3 (virgolette doppiamente escaped, gemini-3.5-flash-lite)")
    print("=" * 70)
    before, after = 60.0, 97.1
    print(f"  prima del fix: {before:.1f}% (32/49 casi flaky)")
    print(f"  dopo il fix:   {after:.1f}% (2/49 casi flaky)")
    if plt is None:
        return
    fig, ax = plt.subplots(figsize=(4.5, 4.8))
    labels = ["prima del fix", "dopo il fix"]
    values = [before, after]
    colors = [PALETTE["red"], PALETTE["blue"]]
    bars = ax.bar(labels, values, color=colors, width=0.5, zorder=3)
    for b, v in zip(bars, values):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.1f}%", ha="center", va="bottom", fontsize=10)
    ax.set_ylim(0, 108)
    ax.set_ylabel("pass rate (%)")
    ax.set_title("gemini-3.5-flash-lite:\nstesso modello, stesso prompt,\nfix di parsing di due righe")
    _style_axes(ax, grid_axis="y")
    plt.tight_layout()
    _save(fig, out_dir, "bugfix3_before_after")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("json_files", nargs="+", help="one or more JSON files produced by eval_llm_chat.py --json")
    parser.add_argument("--out-dir", default="testing/out/charts", help="directory for chart PNG/PDF (default: testing/out/charts)")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    _apply_thesis_style()

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

    report_pass_rate_bar(all_results, args.out_dir)
    report_category_heatmap(all_results, args.out_dir)
    report_cost_vs_accuracy(all_results, args.out_dir)
    report_it_en_gap_core(all_results, args.out_dir)
    report_thinking_toggle(all_results, args.out_dir)
    report_tokens_per_sec_bar(all_results, args.out_dir)
    report_bugfix_impact(args.out_dir)

    if plt is not None:
        print(f"\nTutti i grafici (PNG 300dpi + PDF vettoriale) salvati in {args.out_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
