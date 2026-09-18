"""One destination, one heading — and the heading has to mean something.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_nav_groups.py -v

"My Robot" used to sit inside the manager's "Administration" group and inside a
separate "Operations" group for everyone else: the same page, filed under two
different words depending on who was looking. It is also not administration —
it is the arm assigned to you, sitting beside User Accounts and the fleet, which
are.

Splitting it out makes the operator's menu a subset of the manager's rather than
a different arrangement of the same items, and leaves "Administration" meaning
only what is genuinely manager-only.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "frontend", "src")
MENU = os.path.join(SRC, "menu-items", "management.ts")
INDEX = os.path.join(SRC, "menu-items", "index.ts")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _code(path):
    """The file without its comments.

    The comments here quote the names that were replaced, to record why — so a
    test matching the raw text finds "Settings2" and "Robots Fleet" in the very
    explanation of their removal, and reports a file that is already fixed.
    """
    src = re.sub(r"/\*.*?\*/", "", _read(path), flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", src)


def _group(source, name):
    """The body of one exported group object."""
    start = source.index(f"export const {name}")
    return source[start : source.index("\n}", start)]


def test_the_personal_robot_is_not_filed_under_administration():
    src = _read(MENU)
    admin = _group(src, "administration")
    assert "myrobots" not in admin, (
        "'My Robot' e' tornato dentro Administration: e' il braccio assegnato "
        "a te, non una funzione amministrativa, e finirebbe di nuovo sotto due "
        "intestazioni diverse a seconda di chi guarda."
    )
    ops = _group(src, "operations")
    assert "myrobots" in ops, "'My Robot' non e' piu' in Operations"


def test_the_operator_menu_is_a_subset_of_the_manager_one():
    """Not a different arrangement of the same items: the same items, plus one
    group. That is what keeps every destination in one place for both roles."""
    src = _read(INDEX)
    assert "operations" in src.split("if (group ===")[0], (
        "Operations non fa piu' parte del menu di base: tornerebbe a esistere "
        "solo per un ruolo."
    )
    manager_branch = src[src.index("if (group ==="):]
    manager_branch = manager_branch[: manager_branch.index("\n\n")]
    assert "administration" in manager_branch, (
        "il manager non riceve piu' il gruppo Administration"
    )
    assert "myrobots" not in manager_branch, (
        "il ramo del manager ricompone i propri elementi invece di aggiungere "
        "un gruppo a quelli comuni."
    )


def test_the_fleet_is_named_and_marked_as_many():
    src = _code(MENU)
    assert "'Robot Fleet'" in src, (
        "l'etichetta torna a 'Robots Fleet', che e' l'ordine delle parole di "
        "una traduzione letterale — era l'unica etichetta della barra ad "
        "averlo."
    )
    assert "Settings2" not in src, (
        "la flotta torna all'icona dei cursori, che significa configurazione. "
        "Cio' che deve leggersi a colpo d'occhio e' la differenza dalla voce "
        "sopra: un robot contro molti."
    )


def test_the_fleet_is_called_the_same_thing_on_its_own_page():
    """A rename that stops at the nav leaves the sidebar and the page it opens
    disagreeing — the exact drift this project keeps finding."""
    for name in ("listRobots.tsx", "detailRobot.tsx"):
        page = _code(os.path.join(SRC, "pages", "robots", name))
        assert "Robots Fleet" not in page, (
            f"{name} chiama ancora la pagina 'Robots Fleet' mentre la barra "
            "dice 'Robot Fleet'."
        )
    listing = _read(os.path.join(SRC, "pages", "robots", "listRobots.tsx"))
    assert re.search(r"title=\"Robot Fleet\"", listing), (
        "il titolo della pagina della flotta non corrisponde piu' alla voce "
        "di menu che ci porta."
    )
