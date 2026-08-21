#!/usr/bin/env python3
"""
Analysis/report generator for testing/eval_llm_chat.py --json output.

Reads one or more JSON result files (each shaped {"provider:model": [per-case-
per-run result dict, ...]}), merges them, and prints the tables + generates
the charts needed for the thesis chapter comparing LLMs on the chat pipeline:
accuracy per model/category, IT vs EN gap, latency distribution, cost vs
accuracy, local-model tokens/sec, thinking-vs-nothink toggle, model-size vs
accuracy curve, and a documented bug-fix before/after.

Charts that compare the two model families (remotely served vs locally
executed) are emitted once per family on a shared scale, rather than for the
cloud family alone: the chapter's claims are about the difference between the
two, and a chart that holds only one of them cannot carry them.

Every chart shares one thesis-ready style: a CVD-safe categorical palette
(validated with the dataviz skill's contrast/CVD checker), 300 DPI PNG +
vector PDF output (for LaTeX \\includegraphics), direct data labels so a
black-and-white printout stays legible, and consistent typography/spacing
across the whole figure set.

Run with:
    poetry run python testing/eval_llm_report.py testing/out/*.json \\
        --exclude smoke --exclude ctx8k --out-dir testing/out/charts

Both exclusions are there because a glob over the whole output directory picks
up two kinds of file that are not samples of the golden set:

  * smoke files are two-case plumbing checks. Merged into the measurement they
    change every rate, invent three models that were never evaluated, and do
    most of their damage on `combo` and `condition_variant`, which are the two
    smallest categories and the two that carry the largest deltas in the
    reasoning-toggle breakdown.
  * ctx8k is granite4:350m re-run with a larger context window. It is a
    different configuration of the same model sharing one spec key, and it is
    a single pass: 49 calls against the 245 every other model gets. Averaging
    it in mixes two configurations; keeping it instead of the full run would
    rest the model's number on a fifth of everyone else's evidence. It belongs
    in the text as a one-run observation, not in the charts as a measurement.

The coverage audit printed at the top of the run says whether anything is
still mixed: on a clean campaign every spec reads the same number of runs.
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

# Italian display names for the categories. The thesis table that describes
# the golden set uses these; the charts used to print the raw JSON keys, so a
# reader could not match a heatmap column to the table row it belongs to.
# Anything not in here falls back to the raw key rather than being hidden.
_CATEGORY_LABEL_IT = {
    "core": "centrale",
    "hallucination_guard": "allucinazioni",
    "nested_logic": "logica annidata",
    "codeswitch": "alternanza di lingua",
    "long_sequence": "sequenza lunga",
    "condition_variant": "variante di condizione",
    "combo": "combinato",
}

# Cases per category in a single pass of the golden set (see
# testing/eval_llm_cases.jsonl and the composition table in the thesis).
# Explicit rather than counted from the results, so the n= annotations stay
# right even when the report runs over a partial set of result files.
_GOLDEN_SET_CATEGORY_SIZE = {
    "core": 33, "hallucination_guard": 5, "nested_logic": 4, "codeswitch": 2,
    "long_sequence": 2, "condition_variant": 2, "combo": 1,
}


def _cat_label(category, n_cases=None):
    """Display name for a category, optionally with its case count.

    The count matters on this golden set: four of the seven categories have
    one or two cases, so a cell reading 100 or 0 means "the single case
    passed/failed", not a rate. Printing n on the axis puts that caveat where
    the number is read instead of leaving it to the caption.
    """
    label = _CATEGORY_LABEL_IT.get(category, category)
    return f"{label}\n(n={n_cases})" if n_cases else label


def _is_local(spec):
    """Ollama specs are the locally-executed models; everything else is a
    remote service. Used to split every chart that mixes the two families."""
    return spec.startswith("ollama")

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


def _save(fig, out_dir, name, title=None, note=None):
    """Save a clean vector PDF for LaTeX and an annotated PNG for inspection.

    The two outputs are not the same image on purpose, because they are read
    in two different places.

    The PDF goes into the thesis under \\includegraphics, where the figure
    already has a caption. A title drawn inside the image would be a second
    title in a second typeface: matplotlib's sans against the document's
    Arial, at a size that does not follow the document's and that shrinks
    again when the figure is scaled to the text width. It would also not
    reach the List of Figures, which is built from the caption. The same
    argument applies with more force to the explanatory note, which is prose:
    LaTeX sets it justified, hyphenated and at the caption size, and the
    caption is where a reader looks for it. So the PDF carries no title and
    no note.

    The PNG is read on its own, in a file browser or a chat, with no caption
    anywhere. There the title and the note are what make it legible, so they
    are drawn before it is written.

    What stays in BOTH is everything that points at a position inside the
    graphic: axis labels, tick labels, data labels, legends, and the panel
    identifiers of a multi-panel figure. A caption cannot point at the left
    panel; the image has to.
    """
    if plt is None:
        return
    png = os.path.join(out_dir, f"{name}.png")
    pdf = os.path.join(out_dir, f"{name}.pdf")

    fig.savefig(pdf, bbox_inches="tight")

    if title:
        fig.suptitle(title, fontweight="bold")
        fig.tight_layout()
    if note:
        fig.text(0.01, -0.02, note, fontsize=7, color=INK["muted"])
    fig.savefig(png, dpi=300, bbox_inches="tight")

    plt.close(fig)
    print(f"  saved {pdf} (senza titolo, per LaTeX) + {os.path.basename(png)} (annotato)")


def _short(spec):
    """'gemini:gemini-2.5-flash' -> 'gemini-2.5-flash'; keeps ollama-nothink
    distinguishable from its thinking counterpart (same tag otherwise)."""
    label = spec.split(":", 1)[1]
    if spec.startswith("ollama-nothink"):
        label += " (nothink)"
    return label


GOLDEN_SET_SIZE = sum(_GOLDEN_SET_CATEGORY_SIZE.values())  # 49 cases in one pass

# Runs per model the protocol calls for. Set by audit_coverage() from what the
# majority of the specs actually have, so the charts flag coverage against the
# campaign that was really run rather than against a number hard-coded here.
EXPECTED_RUNS = 5


def load_results(paths, exclude=()):
    """Merge {spec: [result, ...]} dicts from multiple JSON files.

    `exclude` holds substrings matched against the file name; a file whose
    name contains any of them is skipped. This exists because a shell glob
    over the output directory sweeps up artifacts that are not measurements
    (see audit_coverage), and rebuilding the glob by hand every time is how
    one of them eventually slips back in.

    Also records which files each spec came from, so the audit can name them
    when a spec turns out to be a mix of artifacts rather than a measurement.
    """
    merged = defaultdict(list)
    sources = defaultdict(list)
    skipped = []
    for path in paths:
        name = os.path.basename(path)
        if any(pat in name for pat in exclude):
            skipped.append(name)
            continue
        with open(path) as f:
            data = json.load(f)
        for spec, results in data.items():
            merged[spec].extend(results)
            sources[spec].append(name)
    if skipped:
        print(f"Esclusi {len(skipped)} file su richiesta: {', '.join(sorted(skipped))}")
    return merged, sources


def audit_coverage(merged, sources, include_partial=False):
    """Print a coverage audit and drop specs that are not a measurement.

    Merging every JSON in the output directory silently mixes two kinds of
    artifact. A smoke file is a two-case sanity check that the plumbing
    answers at all; it is not a sample of the golden set. Averaged into the
    real runs it does three things, all of them wrong and none of them
    visible in the resulting chart:

      * it invents models. Three specs exist ONLY in smoke files, so a bar
        chart sorted by pass rate puts a model measured on two calls at the
        top of the local family with a perfect score.
      * it shifts every rate by a fraction of a point, which is enough to
        reorder models that sit a tenth apart, and enough to make the
        numbers quoted in the thesis prose disagree with the bars.
      * it lands exactly where it hurts most. The smoke cases are `combo`
        and `condition_variant`, the two smallest categories and the two
        that carry the largest deltas in the reasoning-toggle breakdown, so
        the contamination concentrates on the least robust numbers in the
        chapter and leaves the other five categories untouched.

    So specs below one full pass of the golden set are dropped by default
    rather than flagged, because a footnote on a chart does not stop a
    reader from reading the tallest bar. `--include-partial` keeps them for
    inspection.

    Anything above one full pass is kept but flagged in BOTH directions: a
    spec with more calls than the protocol is as suspect as one with fewer,
    and usually means two different configurations were merged under the
    same model name.
    """
    print("\n" + "=" * 70)
    print("COPERTURA DEI DATI")
    print("=" * 70)
    global EXPECTED_RUNS
    runs = {s: len(r) / GOLDEN_SET_SIZE for s, r in merged.items()}
    complete = [v for v in runs.values() if v >= 1]
    if complete:
        EXPECTED_RUNS = max(set(round(v) for v in complete),
                            key=lambda k: sum(1 for v in complete if round(v) == k))
    expected = EXPECTED_RUNS

    dropped = []
    for spec in sorted(merged, key=lambda s: len(merged[s])):
        n = len(merged[spec])
        r = runs[spec]
        notes = []
        if r < 1:
            notes.append("SOTTO UNA ESECUZIONE" + ("" if include_partial else " -> escluso"))
        else:
            if n % GOLDEN_SET_SIZE:
                notes.append(f"non multiplo di {GOLDEN_SET_SIZE}")
            if round(r) != expected:
                notes.append(f"{r:g} esecuzioni contro {expected} della maggioranza")
        flag = "  <-- " + "; ".join(notes) if notes else ""
        print(f"  {spec:38s} n={n:4d}  ({r:g} esecuzioni){flag}")
        if notes:
            print(f"      da: {', '.join(sorted(set(sources.get(spec, []))))}")
        if r < 1 and not include_partial:
            dropped.append(spec)

    for spec in dropped:
        del merged[spec]
    if dropped:
        print(f"\n  Esclusi {len(dropped)} spec sotto una esecuzione completa: {', '.join(dropped)}")
        print("  (--include-partial per tenerli)")
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


def report_determinism(all_results):
    """Run-to-run stability, the numbers behind the determinism claim.

    These were being computed by hand when the chapter was written, which is
    the wrong place for a number that ends up in a printed sentence. They are
    produced here so the claim has a generator.

    The runs are recoverable from the merged results without any heuristic:
    each file stores the golden set replayed whole, so the rows arrive as
    consecutive blocks of GOLDEN_SET_SIZE in a fixed case order, and slicing
    by index recovers run 1..k exactly.

    Sample standard deviation, not population: five runs are a sample of the
    runs the model could have produced, not the population of them. It is
    also what report_accuracy already prints beside every model, and one
    chapter should not quote two different estimators for the same quantity.
    """
    print("\n" + "=" * 70)
    print("DETERMINISMO FRA ESECUZIONI (deviazione standard campionaria)")
    print("=" * 70)
    zero = {"cloud": 0, "locale": 0}
    total = {"cloud": 0, "locale": 0}
    worst = None
    for spec in sorted(all_results, key=lambda s: len(all_results[s])):
        rows = all_results[spec]
        k = len(rows) // GOLDEN_SET_SIZE
        if k < 2:
            continue
        blocks = [rows[i * GOLDEN_SET_SIZE:(i + 1) * GOLDEN_SET_SIZE] for i in range(k)]
        rates = [_pass_rate(b) for b in blocks]
        sd = statistics.stdev(rates)
        by_case = defaultdict(list)
        for b in blocks:
            for r in b:
                by_case[r["name"]].append(bool(r.get("pass")))
        flaky = sum(1 for v in by_case.values() if len(set(v)) > 1)
        family = "locale" if _is_local(spec) else "cloud"
        total[family] += 1
        if sd == 0:
            zero[family] += 1
        if worst is None or sd > worst[1]:
            worst = (spec, sd, flaky)
        print(f"  {spec:38s} sd={sd:5.2f}  escursione={max(rates) - min(rates):5.2f}  "
              f"casi con esito variabile={flaky:2d}/{GOLDEN_SET_SIZE}  ({family})")
    print()
    for family in ("locale", "cloud"):
        if total[family]:
            print(f"  {family}: {zero[family]}/{total[family]} con esiti identici caso per caso")
    if worst:
        print(f"  massima variabilità: {worst[0]} (sd={worst[1]:.2f}, {worst[2]} casi variabili)")


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
        title += " (scala log: gli outlier di timeout comprimono l'asse lineare)"
    _style_axes(ax, grid_axis="y")
    plt.xticks(rotation=40, ha="right", fontsize=fontsize)
    plt.tight_layout()
    _save(fig, out_dir, name, title=title)


def report_latency(all_results, out_dir):
    """latency_boxplot_* — latency distribution, three charts.

    latency_boxplot_compare is the one the thesis uses: two panels on a
    shared log axis, because that is the only arrangement in which the gap
    between the families, and the places where they overlap, are visible.

    The two single-family charts are kept as diagnostics, not as figures.
    Each auto-scales to its own group, which is what you want when reading
    one family on its own and exactly what you must not use to compare them:
    two charts scaled independently make different distributions look alike.
    They stay because a per-family view is useful while inspecting a run;
    they are not meant for the chapter.
    """
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
        if _is_local(spec):
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
    _boxplot_compare(cloud_labels, cloud_series, local_labels, local_series, out_dir)


def _boxplot_compare(cloud_labels, cloud_series, local_labels, local_series, out_dir):
    """latency_boxplot_compare — the two families on ONE shared log axis.

    The separate charts each auto-scale to their own family, which makes the
    two look alike and hides the only thing worth comparing. On a shared axis
    the order-of-magnitude gap between the medians is visible, and so are the
    two exceptions that a blanket 'seconds versus tens of seconds' statement
    would flatten: the smallest local model answers in about a second, and
    two remotely served models sit above ten.
    """
    if plt is None or not cloud_series or not local_series:
        return
    widths = [max(2.2, len(cloud_labels) * 0.62), max(2.2, len(local_labels) * 0.62)]
    fig, axes = plt.subplots(
        1, 2, figsize=(min(11, sum(widths) + 1), 5.2),
        sharey=True, gridspec_kw={"width_ratios": widths},
    )
    for ax, labels, series, title in (
        (axes[0], cloud_labels, cloud_series, "cloud"),
        (axes[1], local_labels, local_series, "locale"),
    ):
        ax.boxplot(
            series, tick_labels=labels, patch_artist=True,
            boxprops=dict(facecolor=PALETTE["blue"], alpha=0.25, edgecolor=PALETTE["blue"]),
            medianprops=dict(color=HEATMAP_RAMP[-1], linewidth=2),
            whiskerprops=dict(color=INK["secondary"]),
            capprops=dict(color=INK["secondary"]),
            flierprops=dict(markeredgecolor=INK["muted"], markersize=4),
        )
        ax.set_title(title, fontsize=10, loc="left", color=INK["secondary"])
        _style_axes(ax, grid_axis="y")
        ax.tick_params(axis="x", labelrotation=40)
        for lbl in ax.get_xticklabels():
            lbl.set_ha("right")
            lbl.set_fontsize(7.5)
    axes[0].set_yscale("log")
    axes[0].set_ylabel("latenza (ms)")
    plt.tight_layout()
    _save(fig, out_dir, "latency_boxplot_compare",
          title="Latenza per chiamata: le due famiglie sulla stessa scala",
          note="Scala logaritmica condivisa fra i due pannelli. Il distacco fra le mediane è di "
               "circa un ordine di grandezza, ma i due gruppi non sono separati agli estremi.")


def report_cost(all_results):
    print("\n" + "=" * 70)
    print("COST PER 100 REQUESTS")
    print("=" * 70)
    for spec, results in all_results.items():
        priced = [r["cost_usd"] for r in results if r.get("cost_usd") is not None]
        if not results:
            continue
        if _is_local(spec):
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
        if not _is_local(spec):
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
    """size_vs_accuracy — model size vs accuracy for the local matrix.

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
        if not _is_local(spec):
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
    ax.legend(loc="lower right", frameon=False, fontsize=8)
    _style_axes(ax, grid_axis="both")
    plt.tight_layout()
    _save(fig, out_dir, "size_vs_accuracy",
          title="Scala dei modelli locali vs accuratezza sul task")


def report_pass_rate_bar(all_results, out_dir, baseline_spec="gemini:gemini-3.5-flash-lite"):
    """pass_rate_per_model[_local] — headline bar chart, one per family.

    The local chart exists because the section that discusses local models
    used to carry all of its numbers in prose while the only accuracy figure
    in the chapter showed the other family. Same axis limits in both, so the
    two are readable against each other.

    All bars share one hue (identity is already carried by the y-axis
    label); the baseline model is called out with a bold label and a dark
    edge instead of a second color, so orange/red stay reserved for a real
    grouping or a real comparison elsewhere in the chapter, not a
    single-bar highlight here. The local family has no production baseline,
    so nothing is highlighted there.
    """
    _pass_rate_bar_one(all_results, out_dir, "cloud", False,
                       "pass_rate_per_model", baseline_spec)
    _pass_rate_bar_one(all_results, out_dir, "locale", True,
                       "pass_rate_per_model_local", None)


def _pass_rate_bar_one(all_results, out_dir, family, want_local, name, baseline_spec):
    print("\n" + "=" * 70)
    print(f"PASS RATE PER MODEL (bar chart, {family})")
    print("=" * 70)
    rows = []
    for spec, results in all_results.items():
        if _is_local(spec) != want_local:
            continue
        rows.append((spec, _pass_rate(results), len(results)))
    if not rows:
        print(f"  (nessun modello {family} fra i file passati)")
        return
    rows.sort(key=lambda r: r[1])
    # Coverage is flagged in BOTH directions. A model measured on more calls
    # than the protocol is as suspect as one measured on fewer: in this
    # dataset the only such case is two different context-window
    # configurations merged under one model name, which a "< full run" test
    # waves through.
    full = EXPECTED_RUNS * GOLDEN_SET_SIZE
    for spec, rate, n in rows:
        flag = "" if n == full else f" (copertura {n}/{full})"
        print(f"  {spec}: {rate:.1f}%{flag} (n={n})")

    if plt is None:
        return
    labels = [_short(spec) + ("" if n == full else " *") for spec, _, n in rows]
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
    _style_axes(ax, grid_axis="x")
    notes = []
    if baseline_spec and any(sp == baseline_spec for sp, _, _ in rows):
        notes.append(f"Contorno in grassetto: baseline di produzione ({_short(baseline_spec)}).")
    if any(n != full for _, _, n in rows):
        notes.append(f"* copertura diversa dalle {full} chiamate del protocollo.")
    plt.tight_layout()
    _save(fig, out_dir, name,
          title=f"Accuratezza complessiva per modello ({family})",
          note="  ".join(notes) if notes else None)


def report_category_heatmap(all_results, out_dir):
    """category_heatmap[_local] — pass rate per category x model.

    Emitted once per family, on a SHARED 0-100 colour scale, so the two
    images can be read side by side in the thesis as one comparison. A single
    combined heatmap over ~21 models would be taller than a printed page, and
    splitting by family also puts each image next to the section that
    discusses it. The scale being identical is what makes the split honest:
    the hallucination column is the one where the two families separate, and
    that only reads as a separation if the same value has the same colour in
    both images.
    """
    for family, is_local, name in (
        ("cloud", False, "category_heatmap"),
        ("locale", True, "category_heatmap_local"),
    ):
        _category_heatmap_one(all_results, out_dir, family, is_local, name)


def _category_heatmap_one(all_results, out_dir, family, want_local, name):
    print("\n" + "=" * 70)
    print(f"PASS RATE PER CATEGORIA x MODELLO ({family}, heatmap)")
    print("=" * 70)
    specs = [s for s in all_results if _is_local(s) == want_local]
    if not specs:
        print(f"  (nessun modello {family} fra i file passati)")
        return
    seen = set()
    for s in specs:
        for r in all_results[s]:
            seen.add(r.get("category") or "uncategorized")
    categories = [c for c in _CATEGORY_ORDER if c in seen] + sorted(seen - set(_CATEGORY_ORDER))

    specs.sort(key=lambda s: _pass_rate(all_results[s]))
    matrix = []
    for s in specs:
        row = []
        for c in categories:
            rs = [r for r in all_results[s] if (r.get("category") or "uncategorized") == c]
            row.append(_pass_rate(rs) if rs else float("nan"))
        matrix.append(row)
        print(f"  {s}: " + " | ".join(f"{c}={v:.0f}%" for c, v in zip(categories, row)))

    if plt is None:
        return
    arr = np.array(matrix)
    fig, ax = plt.subplots(figsize=(1.35 * len(categories) + 3, 0.5 * len(specs) + 2.2))
    cmap = mcolors.LinearSegmentedColormap.from_list("blu_notte", HEATMAP_RAMP)
    cmap.set_bad(color="#f2f2f0")
    im = ax.imshow(np.ma.masked_invalid(arr), cmap=cmap, vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels(
        [_cat_label(c, _GOLDEN_SET_CATEGORY_SIZE.get(c)) for c in categories],
        rotation=30, ha="right", fontsize=8,
    )
    ax.set_yticks(range(len(specs)))
    ax.set_yticklabels([_short(s) for s in specs])
    for i in range(len(specs)):
        for j in range(len(categories)):
            v = arr[i, j]
            if v != v:  # NaN: no cases of this category for this model
                continue
            ax.text(j, i, f"{v:.0f}", ha="center", va="center", fontsize=8,
                     color="white" if v > 55 else INK["primary"])
    cbar = fig.colorbar(im, ax=ax, shrink=0.8)
    cbar.set_label("pass rate (%)")
    cbar.outline.set_visible(False)
    for spine in ax.spines.values():
        spine.set_visible(False)
    plt.tight_layout()
    _save(fig, out_dir, name,
          title=f"Accuratezza per categoria e modello ({family})",
          note="Scala identica nelle due famiglie (0-100%), così che le due immagini si "
               "confrontino. n = casi per categoria in una singola esecuzione.")


def report_cost_vs_accuracy(all_results, out_dir):
    """cost_vs_accuracy — two kinds of point, same hue, different
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
    _style_axes(ax, grid_axis="both")
    plt.tight_layout()
    _save(fig, out_dir, "cost_vs_accuracy", title="Costo vs accuratezza")


def report_it_en_gap_core(all_results, out_dir):
    """it_en_gap_core — EN-IT gap on the 'core' category, BOTH families.

    Two panels sharing one x-axis, cloud on the left and local on the right.
    The claim this figure supports is that the sign of the gap is a property
    of the single variant and not of the language or the family: remote
    models cluster on zero, local ones spread wide in both directions. That
    claim is only visible if both families are in the picture — the chart
    used to exclude the local models while the text described them.

    Restricted to 'core' because it is the only category with enough cases
    per language to make a rate meaningful (15 EN + 18 IT out of 33; the
    other categories have one to five cases each, and the two codeswitch
    cases are mixed-language by construction and belong to neither side).
    Not a 50/50 split, and the note on the figure says so.
    """
    print("\n" + "=" * 70)
    print("GAP IT/EN SU CATEGORIA 'core' (15 EN + 18 IT)")
    print("=" * 70)
    per_family = {"cloud": [], "locale": []}
    for spec, results in all_results.items():
        core = [r for r in results if (r.get("category") or "") == "core"]
        en = [r for r in core if r.get("lang") == "en"]
        it = [r for r in core if r.get("lang") == "it"]
        if not en or not it:
            continue
        gap = _pass_rate(en) - _pass_rate(it)
        per_family["locale" if _is_local(spec) else "cloud"].append((spec, gap))
        print(f"  {spec}: {gap:+.1f}pp (EN {_pass_rate(en):.1f}% vs IT {_pass_rate(it):.1f}%)")

    families = [(f, rows) for f, rows in per_family.items() if rows]
    if plt is None or not families:
        return
    for _, rows in families:
        rows.sort(key=lambda r: r[1])

    span = max(abs(g) for _, rows in families for _, g in rows)
    limit = span * 1.25 + 2
    heights = [max(2.2, len(rows) * 0.42) for _, rows in families]
    fig, axes = plt.subplots(
        len(families), 1, figsize=(7, sum(heights) + 1.2),
        sharex=True, gridspec_kw={"height_ratios": heights},
    )
    if len(families) == 1:
        axes = [axes]

    for ax, (family, rows) in zip(axes, families):
        values = [g for _, g in rows]
        colors = [PALETTE["blue"] if v >= 0 else PALETTE["red"] for v in values]
        y = list(range(len(rows)))
        ax.barh(y, values, color=colors, height=0.6, zorder=3)
        ax.axvline(0, color=INK["axis"], linewidth=1)
        ax.set_yticks(y)
        ax.set_yticklabels([_short(spec) for spec, _ in rows])
        for yi, v in zip(y, values):
            ax.text(v + (0.8 if v >= 0 else -0.8), yi, f"{v:+.1f}", va="center",
                    ha="left" if v >= 0 else "right", fontsize=9)
        ax.set_xlim(-limit, limit)
        ax.set_title(family, fontsize=10, loc="left", color=INK["secondary"])
        _style_axes(ax, grid_axis="x")

    axes[-1].set_xlabel("gap EN - IT (punti percentuali, categoria centrale)")
    plt.tight_layout()
    _save(fig, out_dir, "it_en_gap_core",
          title="Robustezza multilingua: gap EN-IT sui casi centrali",
          note="Blu = EN migliore, rosso = IT migliore. Stessa scala nei due pannelli. Solo "
               "categoria centrale (15 EN + 18 IT su 33), l'unica con abbastanza casi per lingua.")


def report_thinking_toggle(all_results, out_dir, pair=("ollama:qwen3.5:9b", "ollama-nothink:qwen3.5:9b")):
    """thinking_toggle_qwen35_9b — the one ceteris-paribus reasoning-toggle pair:
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

    # Before the matplotlib guard: the breakdown prints its table either way.
    _thinking_toggle_by_category(think_r, nothink_r, out_dir)

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
    plt.tight_layout()
    _save(fig, out_dir, "thinking_toggle_qwen35_9b",
          title="qwen3.5:9b: ragionamento nascosto attivo vs disattivato")


def _thinking_toggle_by_category(think_r, nothink_r, out_dir):
    """thinking_toggle_by_category — where the toggle's gain actually comes from.

    The headline pair reports one number for the whole golden set, which says
    that turning the reasoning off helps but not why. Broken down by category
    the pattern is the argument: the gain concentrates on the cases whose
    expected output is structurally deepest, is nil where the structure is
    flat, and is NEGATIVE in one category. That shape is what supports the
    claim in the chapter, that explicit reasoning interferes with producing a
    form declared by a schema rather than with reasoning as such.

    Four of the seven categories hold one or two cases, so a bar at 0 or 100
    is one case passing or failing. The case count is printed on each axis
    label rather than left to the caption, because this chart is the one
    where a reader is most tempted to read a delta as an effect size.
    """
    # Console table first, then the chart: every other report function prints
    # its numbers whether or not matplotlib is installed, and this breakdown
    # is the one a reader is most likely to want to check against the figure.
    print("\n  scomposizione per categoria (think -> nothink):")
    cats, think_v, nothink_v = [], [], []
    for c in _CATEGORY_ORDER:
        t = [r for r in think_r if (r.get("category") or "") == c]
        nt = [r for r in nothink_r if (r.get("category") or "") == c]
        if not t or not nt:
            continue
        cats.append(c)
        think_v.append(_pass_rate(t))
        nothink_v.append(_pass_rate(nt))
        print(f"    {c:22s} {think_v[-1]:5.1f}% -> {nothink_v[-1]:5.1f}%  ({nothink_v[-1] - think_v[-1]:+.1f}pp)")
    if not cats or plt is None:
        return

    fig, ax = plt.subplots(figsize=(7.5, max(4, len(cats) * 0.72)))
    y = np.arange(len(cats))
    h = 0.36
    ax.barh(y + h / 2, think_v, height=h, color=PALETTE["red"], zorder=3, label="ragionamento attivo")
    ax.barh(y - h / 2, nothink_v, height=h, color=PALETTE["blue"], zorder=3, label="ragionamento disattivato")
    for yi, v in zip(y + h / 2, think_v):
        ax.text(v + 1.5, yi, f"{v:.0f}", va="center", fontsize=8, color=INK["secondary"])
    for yi, v in zip(y - h / 2, nothink_v):
        ax.text(v + 1.5, yi, f"{v:.0f}", va="center", fontsize=8, color=INK["secondary"])
    ax.set_yticks(y)
    ax.set_yticklabels([_cat_label(c, _GOLDEN_SET_CATEGORY_SIZE.get(c)) for c in cats], fontsize=8)
    ax.invert_yaxis()
    ax.set_xlim(0, 112)
    ax.set_xlabel("pass rate (%)")
    _style_axes(ax, grid_axis="x")
    # Above the axes, not inside them. Every corner of this plot is reachable
    # by a bar: the categories where the toggle matters are exactly the ones
    # that run to 100, so an inside placement collides with whichever bar
    # happens to be longest today and has to be re-picked whenever the data
    # moves. Outside the frame it cannot collide with anything, and one row of
    # two entries costs a line of height the figure already has.
    ax.legend(loc="lower right", bbox_to_anchor=(1, 1.01), ncol=2,
              frameon=False, fontsize=8)
    # The caveat has to name BOTH numbers. Saying only "n=1 case" understates
    # the evidence, because that one case is replayed once per run: the combo
    # bar is 0/5 against 5/5, not one trial against another. Saying only the
    # call count would overstate it, because five replays of a single case
    # measure the model's consistency on that case and not its rate over a
    # category. Both are printed, and the reader is told which is which.
    runs_per_arm = min(len(think_r), len(nothink_r)) // GOLDEN_SET_SIZE or 1
    plt.tight_layout()
    _save(fig, out_dir, "thinking_toggle_by_category",
          title="qwen3.5:9b: dove cambia l'effetto del ragionamento",
          note=f"n = casi distinti per categoria; ciascuno ripetuto su {runs_per_arm} esecuzioni "
               "per braccio. Sulle categorie da uno o due casi la barra misura la costanza del "
               "modello su quei casi, non una frequenza su un campione.")


def report_tokens_per_sec_bar(all_results, out_dir):
    """tokens_per_sec — local-model throughput, bar chart of the console table."""
    print("\n" + "=" * 70)
    print("THROUGHPUT LOCALE (tok/s, bar chart)")
    print("=" * 70)
    rows = []
    for spec, results in all_results.items():
        if not _is_local(spec):
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
    _style_axes(ax, grid_axis="x")
    plt.tight_layout()
    _save(fig, out_dir, "tokens_per_sec", title="Throughput dei modelli locali")


def report_bugfix_impact(out_dir):
    """bugfix3_before_after — bug #3 before/after (gemini-3.5-flash-lite double-escape
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
    _style_axes(ax, grid_axis="y")
    plt.tight_layout()
    _save(fig, out_dir, "bugfix3_before_after",
          title="gemini-3.5-flash-lite: stesso modello, stesso prompt,\nfix di parsing di due righe")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("json_files", nargs="+", help="one or more JSON files produced by eval_llm_chat.py --json")
    parser.add_argument("--out-dir", default="testing/out/charts", help="directory for chart PNG/PDF (default: testing/out/charts)")
    parser.add_argument("--exclude", action="append", default=[], metavar="PATTERN",
                        help="skip input files whose name contains PATTERN (repeatable). "
                             "Use --exclude smoke to leave the plumbing sanity checks out "
                             "of the measurement.")
    parser.add_argument("--include-partial", action="store_true",
                        help="keep specs measured on less than one full pass of the golden set "
                             "(smoke runs). Off by default: they are sanity checks, not samples, "
                             "and merging them changes every rate and invents models.")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    _apply_thesis_style()

    all_results, sources = load_results(args.json_files, exclude=args.exclude)
    if not all_results:
        print("No results found in the given JSON file(s).")
        return 1
    all_results = audit_coverage(all_results, sources, include_partial=args.include_partial)
    if not all_results:
        print("Nessuno spec con una esecuzione completa.")
        return 1

    report_accuracy(all_results)
    report_determinism(all_results)
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
