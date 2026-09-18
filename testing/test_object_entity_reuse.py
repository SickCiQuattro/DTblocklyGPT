"""Guard on the fix for "'X' didn't come up with the gripper — the grasp didn't hold".

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_object_entity_reuse.py -v

THE BUG. `<child_model>object</child_model>` is fixed in Cobotta.sdf.template,
so every pick in a session has to use that one entity name. The pick path
therefore removed the previous "object" and created a new one under the same
name — and removing a model and recreating it under a same name is the
operation gz-sim8 loses. `remove_entity_and_wait`'s own docstring puts the
reproduction rate at roughly one cycle in five:

    Msg [NameManager::issueNewName] The name [object/link] is a duplicate,
    so it has been renamed to [object/link(1)]

When that happens the DetachableJoint stays bound to the corpse. It answers
"attached", nothing is welded, the tube rides up on friction between the
closing fingers and drops somewhere later. `_verify_sim_grasp` catches it and
aborts — which is correct, and is the message above.

Two properties of the failure made it expensive:

  * it is NEVER the first pick of a session, because the first pick is the only
    one whose "object" the plugin resolved fresh. So it looks intermittent and
    survives every attempt to reproduce it by running one pick.
  * once the world is in that state, EVERY later weld fails the same way until
    Gazebo is restarted. Rehearsing a demo is enough to arm it before the
    demo itself runs. Observed live on 2026-09-10.

THE FIX. Stop destroying the entity. `_persist_placed_object` parks it at a
free corner of the table instead of deleting it, and the next pick MOVES it
into the slot instead of creating it. A model that is never destroyed cannot be
raced by a creation, so the failure mode is structurally gone rather than made
less likely.

Remove+create survives for the one case parking cannot cover: a pick of a
DIFFERENT model, which genuinely needs a different SDF loaded under that name.
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")
import django  # noqa: E402

django.setup()

from backend.functions import simulate  # noqa: E402

SIMULATE_PY = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "backend", "functions", "simulate.py")
)


def _source() -> str:
    return open(SIMULATE_PY, encoding="utf-8").read()


def _code() -> str:
    """Source with comments and blank lines stripped.

    Every assertion below has to match executable code. Matching a comment
    means the test passes on a file whose behaviour was deleted and whose
    explanation was left behind — which is the failure mode this file exists
    to prevent, so it must not be its own.
    """
    out = []
    for line in _source().split("\n"):
        stripped = re.sub(r"(?<!['\"])#.*$", "", line).rstrip()
        if stripped.strip():
            out.append(stripped)
    return "\n".join(out)


def _function_body(name: str, code: "str | None" = None) -> str:
    """Executable body of one function, bounded by the next def at any indent."""
    code = code if code is not None else _code()
    start = code.index(f"def {name}(")
    rest = code[start + 1:]
    match = re.search(r"\n\s*def \w+\(", rest)
    return rest[: match.start()] if match else rest


@pytest.fixture(autouse=True)
def _isolate_module_state(monkeypatch):
    """`_live_object_sdf` is module state. Restore it around every test."""
    monkeypatch.setattr(simulate, "_live_object_sdf", None, raising=False)


def _world_says(monkeypatch, answer):
    """Stub the world listing. `answer` is True / False / None."""
    monkeypatch.setattr(simulate, "_model_in_world", lambda name: answer)


# ─────────────────────────────────────────────────────────────────────────────
# The decision itself
# ─────────────────────────────────────────────────────────────────────────────

def test_a_fresh_world_is_never_reusable(monkeypatch):
    """No live entity means the pick has to create one."""
    _world_says(monkeypatch, False)
    assert simulate._object_entity_is_reusable("blue_tube") is False


def test_the_same_object_is_reused(monkeypatch):
    """The whole point: a second pick of the same tube moves the entity."""
    monkeypatch.setattr(simulate, "_live_object_sdf", "blue_tube")
    _world_says(monkeypatch, True)
    assert simulate._object_entity_is_reusable("blue_tube") is True


def test_a_different_object_is_not_reused(monkeypatch):
    """A medicine bottle is not a tube.

    Parking cannot cover this: the entity holds one SDF, and picking a
    different model needs a different SDF loaded. Reusing here would grasp a
    tube while the program, the panel and the study log all say bottle.
    """
    monkeypatch.setattr(simulate, "_live_object_sdf", "blue_tube")
    _world_says(monkeypatch, True)
    assert simulate._object_entity_is_reusable("medicine_bottle") is False


def test_a_vanished_entity_is_not_reused(monkeypatch):
    """The flag is not evidence — the world is.

    If something removed "object" behind our back, moving it moves nothing and
    the gripper closes on air. The listing has the final say.
    """
    monkeypatch.setattr(simulate, "_live_object_sdf", "blue_tube")
    _world_says(monkeypatch, False)
    assert simulate._object_entity_is_reusable("blue_tube") is False


def test_an_unanswered_listing_is_not_reused(monkeypatch):
    """None is not False, and neither is a reason to reuse.

    A `gz model --list` that failed or timed out says nothing about whether the
    entity is there. Falling back to remove+create is merely slow and
    occasionally unlucky; moving an entity that is not there hands the gripper
    empty air and the run reports a grasp failure with the wrong diagnosis.
    """
    monkeypatch.setattr(simulate, "_live_object_sdf", "blue_tube")
    _world_says(monkeypatch, None)
    assert simulate._object_entity_is_reusable("blue_tube") is False


def test_model_in_world_distinguishes_absent_from_unanswered(monkeypatch):
    """`_model_in_world` is what makes the three-way answer above possible."""
    monkeypatch.setattr(
        simulate, "_shell_output",
        lambda cmd: "Available models:\n    - object\n    - Cobotta\n")
    assert simulate._model_in_world("object") is True
    assert simulate._model_in_world("location") is False

    monkeypatch.setattr(simulate, "_shell_output", lambda cmd: "")
    assert simulate._model_in_world("object") is None, (
        "una listing vuota (servizio non risponde) deve dare None, non False: "
        "trattare il silenzio come assenza e' esattamente l'errore contro cui "
        "remove_entity_and_wait mette in guardia nel proprio commento."
    )


# ─────────────────────────────────────────────────────────────────────────────
# hold_object_at — the check that a set_pose actually landed
# ─────────────────────────────────────────────────────────────────────────────

def _stub_pose(monkeypatch, *poses):
    """Stub set_object_world_pose (always accepts) and the pose readback.

    `poses` are returned in order, the last one repeating — so a test can say
    "first read is wrong, second is right" without writing a counter.
    """
    calls = []
    monkeypatch.setattr(simulate, "set_object_world_pose",
                        lambda x, y, z, **kw: calls.append((x, y, z)) or True)
    seq = list(poses)
    monkeypatch.setattr(simulate, "get_object_world_pose",
                        lambda: seq.pop(0) if len(seq) > 1 else seq[0])
    monkeypatch.setattr(simulate, "_interruptible_sleep", lambda s: None)
    return calls


def test_hold_accepts_an_object_that_landed(monkeypatch):
    calls = _stub_pose(monkeypatch, (1.0, 2.0, 3.0))
    assert simulate.hold_object_at(1.0, 2.0, 3.0) is True
    assert len(calls) == 1, "un oggetto gia' arrivato non deve essere rispedito"


def test_hold_rejects_an_object_that_is_falling(monkeypatch):
    """The failure this helper exists for.

    A model that has left the table keeps falling. It is still listed by
    `gz model --list`, it still accepts set_pose, and it is still nowhere near
    where the gripper is about to close. Only reading the pose back can tell.
    """
    calls = _stub_pose(monkeypatch, (1.0, 2.0, -8.0))
    assert simulate.hold_object_at(1.0, 2.0, 3.0) is False, (
        "hold_object_at ha accettato un oggetto a 11 metri dalla posa "
        "richiesta: si sta fidando della risposta del servizio invece di "
        "rileggere la posa, ed e' esattamente il buco che faceva chiudere "
        "la pinza sul vuoto."
    )
    assert len(calls) == 2, "deve riprovare una volta prima di arrendersi"


def test_hold_retries_once_and_accepts_a_late_settle(monkeypatch):
    """One miss can be a sample taken mid-settle; two says it is not ours."""
    calls = _stub_pose(monkeypatch, (0.5, 2.0, 3.0), (1.0, 2.0, 3.0))
    assert simulate.hold_object_at(1.0, 2.0, 3.0) is True
    assert len(calls) == 2


def test_hold_fails_open_when_the_pose_cannot_be_read(monkeypatch):
    """Unreadable is not "wrong place".

    Same rule as the lift check: a missed `gz model` read is a reason to know
    less, not a reason to abort a run that may be fine.
    """
    _stub_pose(monkeypatch, None)
    assert simulate.hold_object_at(1.0, 2.0, 3.0) is True


def test_hold_tolerance_is_loose_enough_for_settling(monkeypatch):
    """This is not a precision check. It asks "roughly there, or elsewhere?"."""
    assert 0.005 <= simulate.HOLD_POSE_TOL_M <= 0.05, (
        f"HOLD_POSE_TOL_M={simulate.HOLD_POSE_TOL_M}: troppo stretta fa "
        "abortire pick sani per l'assestamento, troppo larga lascia passare "
        "un oggetto che sta cadendo."
    )
    _stub_pose(monkeypatch, (1.0, 2.0, 3.0 + simulate.HOLD_POSE_TOL_M / 2))
    assert simulate.hold_object_at(1.0, 2.0, 3.0) is True


# ─────────────────────────────────────────────────────────────────────────────
# The call sites — structural, because a live Gazebo is not available offline
# ─────────────────────────────────────────────────────────────────────────────

def test_persisting_a_placed_object_parks_instead_of_removing():
    """This is the site that ran on EVERY place, and the source of the cycle."""
    body = _function_body("_persist_placed_object")
    assert 'remove_entity_and_wait("object")' not in body, (
        "_persist_placed_object rimuove di nuovo 'object'. Gira a ogni place, "
        "quindi costringe il pick successivo a ricreare un modello con lo "
        "stesso nome: e' proprio il ciclo che lascia il DetachableJoint "
        "agganciato a un'entita' morta e fa fallire in silenzio ogni saldatura "
        "successiva della sessione."
    )
    assert "hold_object_at(OBJECT_PARK_X" in body, (
        "_persist_placed_object non parcheggia piu' l'entita'. Se non la "
        "rimuove e non la sposta, resta in piedi nel punto di deposito e "
        "compenetra la copia placed_* che viene creata li'."
    )
    # Verified, not assumed. set_object_world_pose returning True says the
    # service accepted the request, not that the model settled there — and a
    # model that is falling accepts set_pose happily while being nowhere.
    assert "set_object_world_pose(OBJECT_PARK_X" not in body, (
        "il parcheggio usa set_object_world_pose diretto invece di "
        "hold_object_at: la risposta del servizio non dice che l'oggetto sia "
        "arrivato, e un oggetto che sta cadendo la accetta comunque."
    )
    assert "_live_object_sdf = None" in body, (
        "un parcheggio fallito non forza piu' uno spawn nuovo al pick "
        "successivo: il riuso sposterebbe un oggetto che non e' piu' sotto "
        "controllo e la pinza si chiuderebbe sul vuoto."
    )


def test_the_pick_skips_the_create_when_it_reuses():
    """Reuse has to actually avoid the create, not just log that it would."""
    body = _function_body("_h_pick")
    assert "reuse_live_object = _object_entity_is_reusable(" in body, (
        "_h_pick non decide piu' se riusare l'entita'."
    )
    assert "if not reuse_live_object:" in body, (
        "_h_pick non salta piu' la gz create quando riusa l'entita': "
        "ricrea un modello con lo stesso nome e il fix non fa niente."
    )
    create_at = body.index("worldCobotta/create")
    guard_at = body.index("if not reuse_live_object:")
    assert guard_at < create_at, (
        "la guardia di riuso sta DOPO la gz create: la create parte comunque."
    )


def test_the_pick_records_the_live_model_outside_the_create_branch():
    """Otherwise the fix works exactly once.

    `_live_object_sdf` has to be set on the reuse path too. Recorded only when
    a model is created, the first reuse would clear the match and every second
    pick would fall back to remove+create — restoring the bug at half rate,
    which is harder to notice than the bug itself.
    """
    body = _function_body("_h_pick")
    assign_at = body.index("_live_object_sdf = safe_sdf_name")
    guard_at = body.index("if not reuse_live_object:")
    create_block_end = body.index("_spawned_in_world.add(sdf_name)")
    assert guard_at < create_block_end < assign_at, (
        "_live_object_sdf viene assegnato dentro il ramo della create. "
        "Dopo il primo riuso il valore non viene piu' aggiornato, la "
        "corrispondenza si perde e il pick successivo torna a "
        "rimuovere-e-ricreare."
    )


@pytest.mark.parametrize("func", [
    "reset_simulation_world",
    "delete_spawned_object_and_place",
])
def test_every_site_that_removes_object_clears_the_live_model(func):
    """A stale value here sends the next pick to move a model that is gone.

    Pairs with test_weld_before_remove.py, which names these same two functions
    as the only remaining removal sites: a third one added later fails there,
    and would have to be added here too.
    """
    body = _function_body(func)
    assert "_live_object_sdf = None" in body, (
        f"{func} rimuove 'object' senza azzerare _live_object_sdf. Il pick "
        "successivo trova la corrispondenza, prende il ramo di riuso e sposta "
        "un modello che non esiste: la pinza si chiude sul vuoto e la "
        "diagnosi che arriva all'operatore parla di presa fallita."
    )


def test_the_cleanup_has_exactly_one_caller_and_it_is_the_pick():
    """The miss that made the first version of this fix do nothing.

    Parking the entity at place time is worthless if something else deletes it
    a moment later. `_h_repeat` and `_h_repeat_until` both called
    `delete_spawned_object_and_place()` at the end of EVERY iteration, so a
    Repeat x3 still ran a remove-then-create cycle per iteration and still
    failed on its third pick. Observed live 2026-09-10, with the parking log
    line and the cleanup log line one after the other.

    Only `_h_pick` may call it, and only on the branch where the entity cannot
    be reused. Anywhere else is a caller duplicating a decision the pick
    already makes — and always answering "remove".
    """
    code = _code()
    callers = []
    for i, line in enumerate(code.split("\n")):
        if "delete_spawned_object_and_place()" not in line:
            continue
        if line.strip().startswith("def "):
            continue
        enclosing = next(
            (c.strip() for c in reversed(code.split("\n")[:i]) if c.lstrip().startswith("def ")),
            "?",
        )
        callers.append(enclosing)

    assert callers == ["def _h_pick():"], (
        f"delete_spawned_object_and_place() e' chiamata da {callers}.\n"
        "Solo _h_pick puo' chiamarla, e solo quando l'entita' non e' "
        "riusabile. Ogni altro chiamante rimette il ciclo "
        "cancella-e-ricrea su un percorso che il pick aveva gia' evitato: "
        "e' esattamente cosi' che un Repeat x3 continuava a fallire al terzo "
        "pick anche con il parcheggio attivo."
    )

    pick = _function_body("_h_pick", code)
    guard_at = pick.index("reuse_live_object = _object_entity_is_reusable(")
    cleanup_at = pick.index("delete_spawned_object_and_place()")
    assert guard_at < cleanup_at, (
        "_h_pick pulisce prima di decidere se puo' riusare l'entita'."
    )


def test_stop_clears_the_live_model():
    """STOP sweeps the world; the reuse state has to go with it."""
    body = _function_body("stop_simulation")
    assert "_live_object_sdf = None" in body, (
        "stop_simulation non azzera _live_object_sdf: la run successiva "
        "crede di poter riusare un'entita' cancellata dallo stop."
    )


def test_an_abort_is_reported_as_409_not_500():
    """An aborted run is a domain outcome, not an internal error.

    error_response defaults to 500, so every abort printed "Internal Server
    Error: /api/task/simulate/" in the same console where a real fault has to
    be spotted — directly under the line that already explained what happened.
    The operator Stop below it was fixed for exactly this reason and carries
    the argument in its own comment.

    The frontend is unaffected: runTask passes rethrowOn: [400, 409], so a 409
    rejects into its catch and raises the error banner just as a 500 did. That
    coupling is why this is asserted rather than left to a reviewer.
    """
    body = _function_body("simulate_task")
    abort_at = body.index("Task aborted: ")
    window = body[abort_at:abort_at + 200]
    assert "status=409" in window, (
        "l'abort torna ancora con lo status di default (500): Django lo "
        "registra come 'Internal Server Error' e il log chiama crash quello "
        "che e' un fallimento di dominio gia' spiegato dalla riga sopra.\n"
        "Se lo cambi, controlla prima rethrowOn in DigitalTwinPanel.runTask: "
        "uno status fuori da quella lista fa risolvere la promise e il "
        "pannello smette di mostrare il banner di errore."
    )


def test_the_parking_spot_is_on_the_table_and_out_of_reach():
    """The world has no ground plane — a park off the table falls forever.

    SimpleTable is 1.5x1.5 centred at (-9.0, -1.2) in worldCobotta.sdf, so the
    supported area is x >= -9.75 and y >= -1.95. And the spot has to be clear
    of both the arm (~0.34 m reach from the base) and the pick rack, or
    parking there would knock over the thing the next pick is about to grasp.

    The margin below is 0.10 m rather than zero: a 100 mm tube standing on the
    very rim is one contact away from falling off, and a parked object that
    fell would be teleported back carrying whatever velocity it accumulated.
    """
    x, y = simulate.OBJECT_PARK_X, simulate.OBJECT_PARK_Y
    margin = 0.10
    assert -9.75 + margin <= x <= -8.25 - margin, (
        f"parcheggio x={x} a meno di {margin * 100:.0f}cm dal bordo del tavolo."
    )
    assert -1.95 + margin <= y <= -0.45 - margin, (
        f"parcheggio y={y} a meno di {margin * 100:.0f}cm dal bordo del tavolo."
    )
    assert -9.75 <= x <= -8.25 and -1.95 <= y <= -0.45, (
        f"parcheggio ({x}, {y}) fuori dal piano del tavolo: il mondo non ha "
        "un ground plane, quindi l'oggetto cadrebbe all'infinito e tornerebbe "
        "indietro con una velocita' accumulata."
    )
    from_base = ((x - simulate.ROBOT_BASE_X) ** 2 + (y - simulate.ROBOT_BASE_Y) ** 2) ** 0.5
    assert from_base > 0.5, (
        f"parcheggio a {from_base:.2f} m dalla base del robot: dentro o "
        "troppo vicino allo spazio di lavoro del braccio (~0.34 m)."
    )
    from_rack = ((x - simulate.OBJECT_SPAWN_X) ** 2
                 + (y - simulate.OBJECT_SPAWN_Y) ** 2) ** 0.5
    assert from_rack > 0.3, (
        f"parcheggio a {from_rack:.2f} m dal rack di prelievo: l'oggetto "
        "parcheggiato puo' urtare quello che il pick successivo deve afferrare."
    )
