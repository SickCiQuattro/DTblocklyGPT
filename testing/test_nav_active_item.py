"""Guard on the nav rail's "where am I" marker.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_nav_active_item.py -v

Every nav item's id is its LIST route and is plural (`objects`); the matching
detail route is singular (`object/:id`). The rail matched path segments against
the id, so no detail route ever matched, and the rail showed nothing selected
the moment you opened a record.

One item had a hand-written patch for it (`tasks`, via a `startsWith('/task/')`
check) and the other six did not. This test replaces that patch with the rule it
was a single instance of, and pins the rule against all seven pairs — a list
that is checked, unlike the one that went stale.

There is no JS test runner in this project (same constraint as
`test_wcag_contrast.py` and `test_panel_messages.py`), so this parses the
TypeScript source and re-implements the matcher it asserts on.
"""
import os
import re

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
NAV_ITEM = os.path.join(
    FRONTEND, "layout", "MainLayout", "Drawer", "DrawerContent",
    "Navigation", "NavItem.tsx",
)
MENU_ITEMS = os.path.join(FRONTEND, "menu-items")
ROUTES = os.path.join(FRONTEND, "routes")

# id -> the detail path a row opens. Both halves are asserted to exist below,
# so neither side of this table can drift away from the app without failing.
DETAIL_ROUTES = {
    "tasks": "/task/7",
    "objects": "/object/7",
    "locations": "/location/7",
    "actions": "/action/7",
    "myrobots": "/myrobot/7",
    "users": "/user/7",
    "robots": "/robot/7",
}


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _selects(item_id: str, pathname: str) -> bool:
    """The rule NavItem implements, restated independently."""
    singular = item_id[:-1] if item_id.endswith("s") else None
    return any(seg == item_id or seg == singular for seg in pathname.split("/"))


def test_every_detail_route_keeps_its_nav_item_selected():
    for item_id, path in DETAIL_ROUTES.items():
        assert _selects(item_id, path), f"{path} non evidenzia piu' '{item_id}'"


def test_the_list_route_still_selects_its_own_item():
    for item_id in DETAIL_ROUTES:
        assert _selects(item_id, f"/{item_id}")


def test_the_rule_does_not_select_a_neighbour():
    """`/myrobot/7` must light My Robot, never Robot Fleet — they differ by a
    prefix, and a substring match instead of segment equality would light both."""
    assert not _selects("robots", "/myrobot/7")
    assert not _selects("myrobots", "/robot/7")
    assert not _selects("tasks", "/objects")
    # `faq` has no plural form to strip; nothing may match a truncation of it.
    assert not _selects("faq", "/fa")
    assert _selects("faq", "/faq")


def test_navitem_implements_that_rule_and_not_a_special_case():
    src = _read(NAV_ITEM)
    assert "item.id.endsWith('s') ? item.id.slice(0, -1) : null" in src, (
        "La regola plurale/singolare e' sparita da NavItem: si torna a un "
        "rattoppo per voce, che era stato scritto per 1 delle 7."
    )
    assert "isTasksItemInWorkspace" not in src, (
        "Torna il caso speciale su 'tasks'. Se serve di nuovo, la regola "
        "generale non sta funzionando: aggiustare quella, non riaggiungere "
        "un'eccezione."
    )


def test_the_table_above_still_describes_the_real_app():
    """Both halves: the ids exist in the menu, the detail routes exist in the
    router. Either one drifting makes the assertions above vacuous."""
    menu_src = "".join(
        _read(os.path.join(MENU_ITEMS, f))
        for f in os.listdir(MENU_ITEMS)
        if f.endswith(".ts")
    )
    route_src = "".join(
        _read(os.path.join(ROUTES, f))
        for f in os.listdir(ROUTES)
        if f.endswith(".tsx")
    )
    for item_id, path in DETAIL_ROUTES.items():
        assert f"id: '{item_id}'" in menu_src, f"voce di menu '{item_id}' sparita"
        singular = path.split("/")[1]
        assert re.search(rf"path: '{singular}/:id'", route_src), (
            f"la rotta di dettaglio '{singular}/:id' non esiste piu'"
        )
