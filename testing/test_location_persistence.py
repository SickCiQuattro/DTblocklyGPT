"""Guard: the destination container stays in the world while it holds something.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_location_persistence.py -v

`delete_spawned_object_and_place()` removed BOTH the reusable "object" and the
"location" — from the start of every pick, and from the end of every
repeat/repeat-until iteration. But a pick never spawns a location; only
`_h_place` does. So the cup was deleted at the start of each pick and only
reappeared when the next place recreated it.

Cosmetically that is the container blinking out for the whole pick and transit.
Functionally it is worse: `_persist_placed_object` exists precisely so a placed
tube survives the next pick, and then this deleted the thing holding it up, so
the tube fell to the table. Reported 2026-09-03, on the third tube of a run:
"il cup sparisce ... poi torna il cup", and earlier "cup riapparso con però
provetta gialla ormai a terra".

Two properties, and the second is the one that keeps a repeated place stable:

  1. the removal lives where the entity is about to be replaced — in the place
     — not in the pick;
  2. an unchanged destination is REUSED rather than deleted and recreated.
     Placing three tubes into one cup used to destroy and rebuild that cup
     three times, and every recreate is a window in which its contents fall.
"""
import os
import re
import sys

import pytest

SIMULATE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "functions", "simulate.py"
)


def _source() -> str:
    return open(SIMULATE, encoding="utf-8").read()


def _strip_comments(source: str) -> str:
    """Drop docstrings and # comments.

    Docstrings too, not just comments: the helper this file guards explains in
    its own docstring why it must not touch "location", and a test looking for
    that string found the explanation and passed judgement on the prose.
    """
    source = re.sub(r'"""[\s\S]*?"""', "", source)
    return re.sub(r"^\s*#.*$", "", source, flags=re.M)


def _body(name: str) -> str:
    src = _source()
    start = src.index(f"def {name}(")
    rest = src[start:]
    match = re.search(r"\n(?=def |\S)", rest[1:])
    return rest[: match.start() + 1] if match else rest


def test_a_pick_does_not_delete_the_destination():
    body = _strip_comments(_body("delete_spawned_object_and_place"))
    assert 'remove_entity_and_wait("object")' in body, (
        "la pulizia non rimuove piu' l'oggetto riutilizzabile: il pick "
        "successivo spawnerebbe sopra quello vecchio."
    )
    assert '"location"' not in body, (
        "il pick torna a cancellare la destinazione. La cancella all'inizio "
        "di ogni presa e la ricrea solo al place successivo, quindi il "
        "contenitore sparisce per tutta la presa e il trasferimento — e "
        "quello che c'era dentro cade sul tavolo."
    )


def test_the_place_owns_the_destination_it_spawns():
    src = _strip_comments(_source())
    place = src[src.index("def _h_place():"):]
    place = place[:place.index("def _h_processing():")]
    assert 'remove_entity_and_wait("location")' in place, (
        "il place non ripulisce piu' la destinazione precedente: lo spawn "
        "sotto un nome fisso fallisce se la vecchia e' ancora li'."
    )
    remove_at = place.index('remove_entity_and_wait("location")')
    spawn_at = place.index("/world/worldCobotta/create")
    assert remove_at < spawn_at, (
        "la rimozione non precede piu' lo spawn nello stesso punto."
    )


def test_an_unchanged_destination_is_reused():
    """Three tubes into one cup must not destroy and rebuild that cup three
    times. Every recreate is a window in which its contents fall."""
    src = _strip_comments(_source())
    assert "_spawned_location_name" in src, (
        "non si tiene piu' traccia della destinazione presente nel mondo: "
        "ogni place torna a cancellare e ricreare il contenitore."
    )
    place = src[src.index("def _h_place():"):]
    place = place[:place.index("def _h_processing():")]
    assert re.search(r"if _spawned_location_name == \w+:", place), (
        "il place non confronta piu' la destinazione con quella gia' "
        "presente, quindi la ricrea anche quando e' la stessa."
    )
    reuse = place[place.index("if _spawned_location_name =="):]
    reuse = reuse[:reuse.index("remove_entity_and_wait")]
    assert "simulate_ros_place(" in reuse, (
        "il ramo di riuso non esegue piu' il place: una destinazione "
        "invariata verrebbe saltata del tutto."
    )


def test_a_world_reset_forgets_the_destination():
    """It removes "location", so the bookkeeping has to agree — otherwise the
    next place believes a container is there that is not, skips the spawn, and
    teleports the tube to coordinates with nothing under them."""
    body = _strip_comments(_body("reset_simulation_world"))
    assert '"location"' in body and "_spawned_location_name = None" in body, (
        "il reset del mondo rimuove la location senza azzerare il "
        "tracciamento: il place successivo la crederebbe ancora presente."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))


# ── Changing destination takes the old container's contents with it ─────────


def test_the_registry_records_where_each_object_was_placed():
    """Without the destination there is no way to sweep one container's
    contents, only all of them — and sweeping all would delete tubes sitting
    in a container that is still standing."""
    src = _strip_comments(_source())
    assert "_placed_in_world.append((placed_name, location))" in src, (
        "il registro degli oggetti piazzati non ricorda piu' in quale "
        "destinazione siano finiti."
    )
    assert re.search(r"def _persist_placed_object\([^)]*location", src, re.S), (
        "_persist_placed_object non riceve piu' la destinazione."
    )


def test_a_destination_change_sweeps_the_old_container_first():
    """The order is the whole point.

    Placed objects are independent top-level models resting ON the container,
    not children of it, so removing the container alone leaves them
    unsupported and they fall across the bench — which is what an operator
    sees as tubes tumbling for no visible reason. Sweeping AFTER the removal
    would still give them a moment to fall.
    """
    src = _strip_comments(_source())
    place = src[src.index("def _h_place():"):]
    place = place[:place.index("def _h_processing():")]

    assert "_delete_placed_objects(location=_spawned_location_name)" in place, (
        "cambiando destinazione il contenuto della precedente non viene piu' "
        "rimosso: quegli oggetti restano senza appoggio e cadono sul tavolo."
    )
    sweep_at = place.index("_delete_placed_objects(location=")
    remove_at = place.index('remove_entity_and_wait("location")')
    assert sweep_at < remove_at, (
        "lo sweep segue la rimozione del contenitore invece di precederla: "
        "restano comunque i fotogrammi in cui gli oggetti sono senza appoggio."
    )


def test_the_sweep_can_take_one_container_or_all_of_them():
    """`location=None` is the reset/STOP sweep and must stay total; naming one
    must leave everything in the other containers alone."""
    body = _strip_comments(_body("_delete_placed_objects"))
    assert "location: str = None" in body, (
        "_delete_placed_objects non accetta piu' una destinazione: puo' solo "
        "spazzare tutto, e spazzerebbe anche i contenitori ancora in piedi."
    )
    assert "if location is None:" in body, (
        "manca il ramo totale: reset del mondo e STOP devono continuare a "
        "rimuovere ogni oggetto piazzato."
    )
    assert re.search(r"_placed_in_world = \[e for e in _placed_in_world if e\[1\] != location\]", body), (
        "lo sweep parziale non toglie piu' dal registro esattamente gli "
        "oggetti che ha cancellato dal mondo: le due cose devono restare "
        "d'accordo o il reset successivo tentera' di cancellarli di nuovo."
    )
