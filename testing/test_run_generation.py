"""Guard: teardown from a retired run must not land on the one that replaced it.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_run_generation.py -v

Stop a run and start another one a second later, and the first one's teardown
is still in flight. `_set_world_paused(True)` and the placed-object sweep are
`gz` subprocesses with their own latency, and they are issued from TWO threads:
the Stop request, and the run thread as it unwinds.

The dangerous one is silent. Stop's pause arriving after the new run's unpause
leaves the world PAUSED for the whole new run: the arm never moves and nothing
says why. Reported 2026-09-03 — "l'ho riavviata dopo 1-2s e ci sono stati dei
problemi".

Ordering two threads with subprocess latency between them is a wish. A
generation counter is a fact: every run and every Stop claims one, and anything
that could land late checks whether its generation is still current before
acting. Same shape as the epoch guard in useWebcamVision.
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.functions import simulate  # noqa: E402

SIMULATE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)


def _source() -> str:
    return open(SIMULATE, encoding="utf-8").read()


def _strip_comments(source: str) -> str:
    source = re.sub(r'"""[\s\S]*?"""', "", source)
    return re.sub(r"^\s*#.*$", "", source, flags=re.M)


def test_a_new_generation_retires_the_previous_one():
    first = simulate._begin_run_generation()
    assert simulate._generation_is_current(first)
    second = simulate._begin_run_generation()
    assert simulate._generation_is_current(second)
    assert not simulate._generation_is_current(first), (
        "una generazione vecchia si considera ancora corrente: il suo "
        "smontaggio tardivo agirebbe sulla corsa che l'ha sostituita."
    )


def test_generations_never_repeat():
    seen = {simulate._begin_run_generation() for _ in range(50)}
    assert len(seen) == 50, "due corse hanno ricevuto la stessa generazione"


def test_the_run_claims_a_generation_before_touching_the_world():
    """Claimed after the lock and before the unpause, or a teardown already in
    flight would still count as current."""
    src = _strip_comments(_source())
    body = src[src.index("_SIM_RUN_LOCK.acquire(blocking=False)"):]
    body = body[:body.index("_SIM_RUN_LOCK.release()")]
    claim = body.index("run_generation = _begin_run_generation()")
    unpause = body.index("_set_world_paused(False)")
    assert claim < unpause, (
        "la corsa riprende il mondo prima di reclamare una generazione: "
        "lo smontaggio precedente resterebbe 'corrente' e potrebbe rimettere "
        "in pausa subito dopo."
    )


def test_both_late_pauses_are_guarded():
    """Two threads can pause late: the run thread as it unwinds, and the Stop
    request. Guarding only one leaves the failure reachable from the other."""
    src = _strip_comments(_source())
    pauses = [m.start() for m in re.finditer(r"_set_world_paused\(True\)", src)]
    assert len(pauses) >= 2, "mancano i punti di pausa attesi"
    for at in pauses:
        window = src[max(0, at - 200):at]
        assert "_generation_is_current(" in window, (
            "una pausa non e' protetta dalla generazione: puo' atterrare "
            "sulla corsa successiva e congelarne il mondo senza dirlo."
        )


def test_the_stop_retires_the_run_it_interrupts():
    src = _strip_comments(_source())
    stop = src[src.index("def stop_simulation"):]
    stop = stop[:stop.index("return success_response()")]
    assert "stop_generation = _begin_run_generation()" in stop, (
        "lo Stop non ritira piu' la corsa che interrompe: la pausa di fine "
        "corsa di quest'ultima resterebbe valida e cadrebbe sulla prossima."
    )
    set_at = stop.index("SIMULATION_STOP_EVENT.set()")
    claim_at = stop.index("stop_generation = _begin_run_generation()")
    assert set_at < claim_at, (
        "lo Stop reclama la generazione prima di alzare la bandiera: la corsa "
        "potrebbe finire e reclamarne un'altra nel mezzo."
    )


def test_the_state_endpoint_answers_the_question_the_panel_asks():
    """The panel keeps Run disabled until this says the lock is free, so it has
    to report the SAME lock simulate_task tries to acquire — not a proxy for
    it, or the button lights up a moment before the next run can start."""
    src = _strip_comments(_source())
    body = src[src.index("def run_state"):]
    body = body[:body.index("def stop_simulation")]
    assert "_SIM_RUN_LOCK.locked()" in body, (
        "run_state non riporta piu' lo stato del lucchetto vero: il pannello "
        "riabiliterebbe Run su un'informazione diversa da quella che decide "
        "se la corsa parte."
    )


def test_the_panel_waits_for_the_server_instead_of_a_timer():
    panel = os.path.join(
        os.path.dirname(__file__), "..", "frontend", "src", "components",
        "DigitalTwinPanel.tsx")
    src = open(panel, encoding="utf-8").read()
    src_nc = re.sub(r"//.*$", "", src, flags=re.M)
    src_nc = re.sub(r"/\*[\s\S]*?\*/", "", src_nc)

    assert "endpoints.task.runState" in src_nc, (
        "il pannello non interroga piu' lo stato del server dopo lo Stop: "
        "tornerebbe a indovinare un ritardo fisso."
    )
    stop = src_nc[src_nc.index("const stopSimulation"):]
    stop = stop[:stop.index("fetchApi(")]
    assert "waitForRunToRelease()" in stop, (
        "lo Stop non avvia piu' l'attesa: Run resta premibile subito."
    )
    assert "stopping ||" in src_nc, (
        "il pulsante Run non e' piu' disabilitato durante l'attesa."
    )
    assert "'Stopping…'" in src_nc, (
        "il pulsante non dice piu' che sta aspettando: un pulsante spento "
        "senza spiegazione si legge come un guasto."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
