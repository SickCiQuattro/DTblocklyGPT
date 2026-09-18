"""Guards on the statistics the recognition benches feed into the thesis.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_recognition_report.py -v

The numbers here end up in a table someone else will read as a claim about the
system, so the two that are easy to get subtly wrong are pinned: the interval
at the edges (where a naive normal approximation asserts certainty from a
handful of trials) and the false-positive accounting on the silence class
(where "the operator did nothing and the system agreed" must not be scored as
a recognition).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from testing.recognition_report import wilson, rule_of_three, summarize  # noqa: E402


def test_a_perfect_score_does_not_claim_certainty():
    """10/10 is the case a normal approximation gets wrong in the flattering
    direction: it yields [1.0, 1.0]."""
    lo, hi = wilson(10, 10)
    assert hi == pytest.approx(1.0)
    assert 0.6 < lo < 0.8, (
        f"limite inferiore {lo:.3f} su 10/10: con dieci prove perfette "
        "l'intervallo deve restare largo, altrimenti la tabella afferma una "
        "certezza che i dati non sostengono."
    )
    # More trials must tighten it, or the interval is not doing its job.
    assert wilson(30, 30)[0] > wilson(10, 10)[0]


def test_no_trials_says_nothing():
    assert wilson(0, 0) == (0.0, 1.0)


def test_rule_of_three_matches_the_sample_size_advice():
    """The figure quoted in both benches' docstrings."""
    assert rule_of_three(10) == pytest.approx(0.30)
    assert rule_of_three(30) == pytest.approx(0.10)


def test_rule_of_three_never_reports_a_bound_above_certainty():
    """Below three trials the raw 3/n exceeds 1 and printed as '150%'.

    A hand-filled sheet with a couple of trials per class is exactly where that
    happened, and a percentage over 100 reads like a number while meaning
    nothing.
    """
    for n in (1, 2, 3):
        assert rule_of_three(n) <= 1.0, f"3/{n} non e' limitato a 1.0"
    assert rule_of_three(2) == 1.0


def _run(windows, silence="REST"):
    return {"channel": "gesture", "silence_class": silence,
            "classes": ["FIST", silence], "windows": windows}


def test_a_quiet_silence_window_is_not_a_confusion():
    per_class = summarize(_run([{"expected": "REST", "observations": []}]))
    assert per_class["REST"]["recognized"] == 1
    assert per_class["REST"]["confused"] == 0


def test_any_emission_during_silence_is_a_false_positive():
    per_class = summarize(_run([{"expected": "REST", "observations": ["THUMBS_UP"]}]))
    assert per_class["REST"]["confused"] == 1, (
        "un'emissione durante una finestra di riposo non e' conteggiata come "
        "falso positivo: e' l'errore che risolve un passo in attesa da solo, "
        "e sparirebbe dal rapporto."
    )


def test_a_window_counts_as_recognized_on_a_single_correct_observation():
    """Operator-relevant definition: a step resolves the first time the right
    thing is seen, not on a majority of frames."""
    per_class = summarize(_run([
        {"expected": "FIST", "observations": ["PEACE", "FIST", "PEACE"],
         "onset_correct_s": 0.9},
    ]))
    assert per_class["FIST"]["recognized"] == 1
    assert per_class["FIST"]["confused"] == 0


def test_nothing_observed_is_missed_not_confused():
    per_class = summarize(_run([{"expected": "FIST", "observations": []}]))
    assert per_class["FIST"]["missed"] == 1
    assert per_class["FIST"]["confused"] == 0
