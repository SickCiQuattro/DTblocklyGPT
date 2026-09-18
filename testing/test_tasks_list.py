"""Guard on the Tasks list's claims and its ways out.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_tasks_list.py -v

The page made three statements in one block and two of them fought the third:

    13 tasks ready to run · 2 drafts waiting
    ⚠ The simulator is not responding — tasks cannot run until it is back.

"Ready to run" counted `publishedCount`, which deliberately includes
published_with_draft — right for the filter chip, whose question is "has a live
version", and wrong for a readiness claim, whose question is `canRun`, strictly
'published'. So a task with unpublished changes was counted as ready while its
own Simulate button sat disabled saying "publish or discard them to run this
task". And the claim was made with the simulator down regardless.

Two other things this pins. The grid scrolls AND paginated, hiding three of
fifteen tasks behind an arrow below a scroll region. And there was no way at all
to reach the physical arm from this list — CLAUDE.md described a card action
that the menu did not have.

There is no JS test runner in this project (same constraint as
`test_wcag_contrast.py` and `test_panel_messages.py`), so this parses the
TypeScript source.
"""
import os

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
LIST = os.path.join(FRONTEND, "pages", "tasks", "listTasks.tsx")


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _status_line(src: str) -> str:
    return src[src.index("const liveStatusLine") : src.index("const actionProps")]


def _row_actions(src: str) -> str:
    """Just the card's buttons and overflow menu.

    Scoped, not file-wide: the page component legitimately reads `metaKey` for
    the Cmd+K search shortcut, and a whole-file ban on modifiers would forbid
    that too.
    """
    return src[src.index("const TaskRowActions = ({") : src.index("// ─── Task card")]


# ── The readiness claim ────────────────────────────────────────────────────


def test_ready_to_run_uses_the_same_predicate_as_the_run_button():
    src = _read(LIST)
    assert "const runnableCount = rows.filter(" in src, (
        "Il conteggio 'ready to run' torna a essere quello del filtro, che "
        "include published_with_draft: task contate come pronte mentre il "
        "loro Simulate e' disabilitato."
    )
    assert "(r as any).status?.toLowerCase() === 'published'" in src
    line = _status_line(src)
    assert "publishedCount} task" not in line, (
        "publishedCount torna dentro la frase di prontezza."
    )


def test_the_claim_is_dropped_while_the_simulator_is_down():
    line = _status_line(_read(LIST))
    assert "if (simulatorDown) {" in line, (
        "La pagina torna a dire che N task sono pronte a partire, subito "
        "sopra il banner che dice che nessuna puo' partire."
    )


def test_a_filtered_view_states_what_it_shows_and_claims_nothing():
    line = _status_line(_read(LIST))
    published_branch = line[line.index("statusFilter === 'published'") :]
    published_branch = published_branch[: published_branch.index("statusFilter === 'draft'")]
    assert "ready to run" not in published_branch, (
        "Il ramo filtrato torna a mescolare due numeri diversi nella stessa "
        "frase: quanti ne mostra e quanti ne possono partire."
    )


def test_the_run_button_is_not_disabled_by_the_health_check():
    """That check is fetched on arrival and on focus, never polled.

    Disabling a control on state nobody is monitoring blocks work that would
    have succeeded — the same rule that stopped `lastSaved` from rendering
    "Saved" over a pending edit. The warning goes in the tooltip instead.
    """
    src = _read(LIST)
    assert "disabled={!canRun}" in src, "il gate del pulsante non e' piu' solo lo stato"
    assert "disabled={!canRun || simulatorDown}" not in src
    assert "the simulator was not responding when this page loaded" in src, (
        "Il tooltip non avverte piu': il banner resta l'unico posto dove la "
        "cosa e' detta, e non e' dove sta la mano dell'operatore."
    )


# ── One way through the list, not two ──────────────────────────────────────


def test_the_list_scrolls_and_does_not_also_paginate():
    src = _read(LIST)
    for gone in ("TablePagination", "rowsPerPage", "paginated"):
        assert gone not in src, (
            f"'{gone}' e' tornato: la griglia scorre gia', quindi le task "
            "oltre la prima pagina finiscono dietro una freccia in fondo a "
            "un'area che scorre."
        )


# ── A visible way to the physical arm ──────────────────────────────────────


def test_the_card_menu_can_run_the_task_on_the_real_robot():
    src = _read(LIST)
    assert "executionTarget: 'real'" in src, (
        "Sparito l'unico percorso dall'elenco al braccio fisico: si torna ad "
        "aprire la task, premere Run e cambiare il bersaglio a mano."
    )
    assert "executionTarget: 'sim'" in src, (
        "Simulate deve restare vincolato al gemello: una scorciatoia da "
        "elenco non puo' far muovere il braccio."
    )


def test_reaching_the_arm_is_a_named_row_not_a_hidden_modifier():
    """Cmd+click already means "open in a new tab", and this button sits inside
    a card that navigates — that gesture would arm the arm for someone reaching
    for a tab. A modifier is also the least discoverable affordance there is."""
    actions = _row_actions(_read(LIST))
    assert "UI_TEXT.runOnRobot" in actions, "la voce ha perso il nome"
    for modifier in ("metaKey", "ctrlKey"):
        assert modifier not in actions, (
            f"'{modifier}': l'accesso al braccio fisico torna dietro un tasto "
            "modificatore, invisibile e in collisione con Cmd+click."
        )
