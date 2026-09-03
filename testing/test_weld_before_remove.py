"""Guard on the one rule that keeps gz-sim's physics world consistent.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_weld_before_remove.py -v

**Never remove the "object" model while the DetachableJoint may still hold it.**

Reproduced deliberately on the live twin, 2026-09-03: spawn "object", send
attach, then remove the model without sending detach. gz-sim starts printing

    [Err] [Physics.cc:2967] Internal error: a physics entity ptr with an ID of
    [N] does not exist.

once per physics step and never stops. The session is spoiled from that moment:
the storm floods the console and the run slows to a crawl.

Two things make this expensive to diagnose, and both are worth writing down:

  * the id in the message is the PHYSICS ENGINE's own numbering, not a gz-sim
    entity id. It looks like something you can look up in `gz model` output —
    it is not, it changes between reproductions of the identical fault, and an
    hour can go into mapping it against the entity table before that becomes
    clear.
  * the storm outlives its cause. By the time anyone looks, the world contains
    no trace of the model whose removal caused it.

Three functions remove "object". Two detached first and said so in their
comments; `_persist_placed_object` did not, and it is the one that runs on
every single place. It was relying on `simulate_ros_place` having detached
about 2.6 seconds earlier — an assumption about code several steps away, in a
plugin that carries a pending auto-attach (which is why `_h_pick` sends detach
TWICE straight after every spawn).

This asserts the invariant rather than that one call, so a fourth removal site
added later is covered without anyone remembering this file exists.
"""
import os
import re
import sys

import pytest

SIMULATE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)

# A detach further back than this is not a guarantee: the window is what the
# pending auto-attach can reopen.
LOOKBACK_LINES = 12


def _lines() -> list:
    return open(SIMULATE, encoding="utf-8").read().split("\n")


def _removal_sites() -> list:
    """(line number, enclosing function) for every removal of "object"."""
    lines = _lines()
    sites = []
    for i, line in enumerate(lines):
        if re.search(r'remove_entity_and_wait\("object"\)|type: MODEL, name: "object"', line):
            enclosing = next(
                (lines[j].strip() for j in range(i, 0, -1) if lines[j].startswith("def ")),
                "?",
            )
            sites.append((i + 1, enclosing))
    return sites


def test_the_removal_sites_are_still_findable():
    """A refactor that renames the helper must not silently disable this."""
    sites = _removal_sites()
    assert len(sites) >= 3, (
        f"trovati solo {len(sites)} punti che rimuovono 'object' (attesi 3+). "
        "Se il nome dell'helper e' cambiato, questo test ha smesso di "
        "controllare qualsiasi cosa."
    )


@pytest.mark.parametrize("line_no,enclosing", _removal_sites())
def test_every_removal_of_object_detaches_first(line_no, enclosing):
    lines = _lines()
    window = "\n".join(lines[max(0, line_no - 1 - LOOKBACK_LINES):line_no - 1])
    assert "detach_object_from_gripper" in window, (
        f"riga {line_no} ({enclosing}) rimuove 'object' senza sganciarlo "
        f"nelle {LOOKBACK_LINES} righe precedenti.\n"
        "Rimuovere un modello ancora saldato dal DetachableJoint lascia "
        "un'entita' fisica orfana: gz-sim stampa "
        "'Physics.cc:2967 ... entity ptr with an ID of [N] does not exist' "
        "a ogni passo di fisica per il resto della sessione, e la "
        "simulazione rallenta drasticamente. Riprodotto sul gemello vivo "
        "il 2026-09-03."
    )


def test_the_pick_neutralises_the_pending_auto_attach():
    """Why a detach next to the removal is not redundant.

    The plugin re-arms an attach whenever a model named "object" appears, so a
    freshly spawned object welds itself to the arm and free-falls from the home
    pose. `_h_pick` sends detach twice right after every spawn for that reason
    — and that same re-arming is why "something detached this 2.6 seconds ago"
    is not a guarantee anywhere else.
    """
    source = open(SIMULATE, encoding="utf-8").read()
    pick = source[source.index("def _h_pick():"):]
    pick = pick[:pick.index("def _h_place():")]
    assert pick.count("detach_object_from_gripper()") >= 2, (
        "il pick non neutralizza piu' l'auto-weld pendente con un doppio "
        "detach dopo lo spawn: l'oggetto si salda da solo al braccio e cade "
        "dalla posa di home."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
