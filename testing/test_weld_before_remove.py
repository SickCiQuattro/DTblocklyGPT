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

Three functions used to remove "object". Two detached first and said so in
their comments; `_persist_placed_object` did not, and it is the one that ran on
every single place. It was relying on `simulate_ros_place` having detached
about 2.6 seconds earlier — an assumption about code several steps away, in a
plugin that carries a pending auto-attach (which is why `_h_pick` sends detach
TWICE straight after every spawn).

`_persist_placed_object` no longer removes anything: it PARKS the entity
instead, because deleting it there forced the next pick to create a same-named
model, and that is the operation that binds the DetachableJoint to a corpse.
See testing/test_object_entity_reuse.py, which guards the replacement. Two
removal sites remain, and both are on paths where the entity genuinely has to
go away.

This asserts the invariant rather than one call, so a removal site added later
is covered without anyone remembering this file exists.
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
    """A refactor that renames the helper must not silently disable this.

    Names, not a count. The count was `>= 3` until _persist_placed_object
    stopped removing anything, and lowering a bound is exactly how a canary
    stops being one — a later refactor that removed a second site would have
    passed a `>= 2` just as quietly. Naming the functions means a site that
    disappears fails here and has to be justified, and a NEW site fails the
    detach-invariant test below on its own merits.
    """
    enclosing = {site[1] for site in _removal_sites()}
    assert enclosing == {
        "def reset_simulation_world():",
        "def delete_spawned_object_and_place():",
    }, (
        f"i punti che rimuovono 'object' sono cambiati: {sorted(enclosing)}.\n"
        "Se ne e' sparito uno, la rimozione e' stata sostituita da qualcos'altro "
        "e va documentato qui. Se ne e' comparso uno nuovo, deve sganciare "
        "prima (lo verifica il test seguente) e deve azzerare _live_object_sdf "
        "(lo verifica test_object_entity_reuse.py)."
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


def test_the_between_picks_removal_reads_its_own_answer():
    """`remove_entity_and_wait` returns False for a reason, and this is the
    call site that has to act on it.

    Its docstring is explicit: False means the model is still there after the
    timeout, and "the caller must NOT spawn over it". Two of the four call
    sites checked. The one between two picks in the same run — the one its own
    comment calls the narrowest window — discarded the answer, and a spawn
    followed immediately.

    What that produced, in a three-pick run on 2026-09-04: picks 1 and 2 welded
    and lifted, pick 3 spawned over a corpse, the DetachableJoint bound to the
    dead entity, and the weld silently refused. The run aborted blaming the
    grasp. The grasp was fine; the world had been corrupted two picks earlier
    with nothing said about it.

    The abort does not repair the weld — nothing at this layer can, since
    <child_model>object</child_model> is fixed in Cobotta.sdf.template and
    gz-sim8 refuses the re-attach on a duplicate name. It makes the failure
    arrive where it happens and name the remedy.
    """
    source = open(SIMULATE, encoding="utf-8").read()
    fn = source[source.index("def delete_spawned_object_and_place():"):]
    fn = fn[:fn.index("\ndef ", 1)]

    assert 'if not remove_entity_and_wait("object")' in fn, (
        "delete_spawned_object_and_place ignora di nuovo il valore di ritorno "
        "di remove_entity_and_wait: lo spawn del prelievo successivo puo' "
        "atterrare su un'entita' non ancora rimossa, e da li' in poi ogni "
        "saldatura fallisce in silenzio."
    )
    assert "_abort_task" in fn, (
        "il ramo di rimozione fallita non aborta: proseguire significa "
        "spawnare sopra il cadavere, che e' esattamente il caso che il "
        "contratto dell'helper dice di non fare."
    )


def test_the_world_reset_reports_a_removal_that_did_not_take():
    """The reset does not abort — a run has not started yet — but it must not
    stay silent either: an entity that outlives a 4s wait here is the same
    corrupted world, and it explains a Physics.cc:2967 storm that begins at
    second zero and runs for the whole session."""
    source = open(SIMULATE, encoding="utf-8").read()
    fn = source[source.index("def reset_simulation_world("):]
    fn = fn[:fn.index("\ndef ", 1)]

    assert fn.count("if not remove_entity_and_wait(") == 2, (
        "il reset del mondo non guarda piu' l'esito di entrambe le rimozioni "
        "('object' e 'location')"
    )
    assert "_STALE_ENTITY_WARNING" in fn, (
        "il reset non stampa piu' l'avviso: senza il riavvio dello stack il "
        "mondo resta in uno stato in cui le saldature rifiutano in silenzio, "
        "e l'operatore non ha modo di saperlo"
    )
    source_all = open(SIMULATE, encoding="utf-8").read()
    assert "Restart the Gazebo stack" in source_all, (
        "l'avviso non dice piu' all'operatore cosa fare"
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
