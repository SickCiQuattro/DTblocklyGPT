"""Guard on the removal-then-respawn window that corrupts a Gazebo session.
Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_entity_removal_wait.py -v
`gz service .../remove` returning true means the removal was ACCEPTED, not that
it happened — gz-sim applies entity removals at the end of an update cycle.
Creating a same-named model inside that window makes DART rename the newcomer
("The name [object/link] is a duplicate...") and leaves both the DetachableJoint
plugin and the Physics system holding the corpse: a `Physics.cc:2967` error on
every iteration for the rest of the session, and a weld that silently refuses.
Measured in an isolated world, 10 remove-then-recreate cycles with the same
detach beforehand, the only difference being how the code waits:
    fixed 0.2s sleep     4864 physics errors
    wait until gone         0
This pins the property that produced the second column: every path that removes
an entity the run will recreate goes through remove_entity_and_wait, and that
function decides on the world's own listing rather than on a timer.
"""
import os
import re
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

SIMULATE = os.path.join(os.path.dirname(__file__), "..", "backend", "functions", "simulate.py")


def _source() -> str:
    return open(SIMULATE, encoding="utf-8").read()


def _function_body(name: str) -> str:
    src = _source()
    start = src.index(f"def {name}(")
    end = src.index("\ndef ", start + 10)
    return src[start:end]


def test_the_waiting_removal_exists():
    assert "def remove_entity_and_wait(" in _source(), (
        "remove_entity_and_wait e' sparito: senza, ogni rimozione seguita da "
        "una ricreazione con lo stesso nome torna a essere una corsa."
    )


def test_it_polls_the_world_rather_than_sleeping():
    body = _function_body("remove_entity_and_wait")
    assert "gz model --list" in body, "non interroga piu' il mondo"
    assert "Available models" in body, (
        "non distingue piu' un elenco vuoto da un servizio che non ha "
        "risposto: 'il servizio non risponde' non e' 'il modello non c'e''."
    )


def test_every_respawning_path_waits():
    """The three places that remove an entity the run will recreate.
    A fixed sleep in any of them reopens the window. reset_simulation_world
    runs before every run, delete_spawned_object_and_place between two picks in
    one run, and _persist_placed_object immediately before spawning placed_N.
    """
    for fn in ("reset_simulation_world", "delete_spawned_object_and_place",
               "_persist_placed_object"):
        body = _function_body(fn)
        assert "remove_entity_and_wait" in body, (
            f"{fn} non passa piu' dalla rimozione con attesa"
        )


def test_no_path_removes_object_with_a_bare_service_call():
    """The rule this whole file exists for, stated as a grep.
    A bare `remove` on "object" or "location" anywhere outside the helper is
    the bug returning: it is the call that succeeds while the entity is still
    in the physics engine.
    """
    src = _source()
    helper_start = src.index("def remove_entity_and_wait")
    helper_end = src.index("\ndef ", helper_start + 10)
    outside = src[:helper_start] + src[helper_end:]
    offenders = re.findall(r'remove[^\n]*type: MODEL, name: \\?"(object|location)\\?"', outside)
    assert not offenders, (
        f"rimozione diretta di {set(offenders)} fuori da remove_entity_and_wait: "
        "e' la chiamata che riesce mentre l'entita' e' ancora nel motore fisico."
    )
