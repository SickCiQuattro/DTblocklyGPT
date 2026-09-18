"""Guard on the Blockly workspace's affordances.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_workspace_affordances.py -v

The editor gave the keyboard a one-press way to add a block and gave the mouse
none. A toolbox pill carries `role="button"` and the label "Add <block> to the
task"; Enter and Space on it inserted the block; a plain click did nothing at
all, and so did a drag released before the pointer reached the canvas. The only
instructions anywhere — the toolbox subtitle, the empty-canvas message, the
preview card's footer — all taught dragging, which is the interaction novices
fail at most in a block editor and was the sole mouse path.

The same shape as the Copilot suggestion chip (`test_chat_panel.py`), on the
primary construction surface and on every pill.

There is no JS test runner in this project (same constraint as
`test_wcag_contrast.py` and `test_panel_messages.py`), so this parses the
TypeScript source.
"""
import os

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
BLOCKLY = os.path.join(FRONTEND, "features", "blockly")
EDITOR = os.path.join(BLOCKLY, "editor", "BlocklyEditor.tsx")
TOOLBOX = os.path.join(BLOCKLY, "toolbox", "CustomToolbox.tsx")
PREVIEW = os.path.join(BLOCKLY, "toolbox", "BlockPreviewTooltip.tsx")
SETTINGS = os.path.join(BLOCKLY, "utils", "useViewSettings.ts")
WORKSPACE_PAGE = os.path.join(FRONTEND, "pages", "task-workspace", "index.tsx")


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _pointer_handler(src: str) -> str:
    start = src.index("const handleBlockPointerDown")
    return src[start : src.index("pendingDragCleanupRef.current = cleanup", start)]


# ── A click adds the block ─────────────────────────────────────────────────


def test_a_click_that_never_became_a_drag_adds_the_block():
    handler = _pointer_handler(_read(EDITOR))
    assert "handleInsertToolboxItem(item)" in handler, (
        "Il rilascio non inserisce piu' niente: il mouse torna a non avere "
        "nessuna via di un solo gesto per aggiungere un blocco, mentre la "
        "tastiera la mantiene."
    )


def test_an_abandoned_drag_is_not_treated_as_a_click():
    """Released back near the start after a wide excursion — still a drag."""
    handler = _pointer_handler(_read(EDITOR))
    assert "movedPastThreshold = true" in handler, (
        "Nessuno registra piu' il superamento della soglia. Ricalcolare la "
        "distanza al rilascio scambia per click un trascinamento abbandonato "
        "che torna vicino al punto di partenza."
    )
    assert "!movedPastThreshold" in handler


def test_pointercancel_does_not_add_a_block():
    """cancel is the system taking the gesture away, not the user choosing."""
    handler = _pointer_handler(_read(EDITOR))
    assert "endEvent.type === 'pointerup'" in handler, (
        "pointercancel torna a inserire un blocco che l'operatore non ha "
        "chiesto."
    )


# ── The instructions name the path that works ──────────────────────────────


def test_no_surface_teaches_dragging_as_the_only_way():
    for label, path in (
        ("sottotitolo toolbox", TOOLBOX),
        ("canvas vuoto", WORKSPACE_PAGE),
        ("piede della scheda di anteprima", PREVIEW),
    ):
        src = _read(path)
        for stale in ("Drag blocks into workspace", "Drag to add to program"):
            assert stale not in src, f"{label}: torna a insegnare solo il trascinamento"
    assert "Click or drag a block to add it" in _read(TOOLBOX)
    assert "Click or drag to add" in _read(PREVIEW)
    assert "Click a block in the toolbox to add it" in _read(WORKSPACE_PAGE)


# ── The view follows the robot ─────────────────────────────────────────────


def test_following_the_running_step_is_on_by_default():
    settings = _read(SETTINGS)
    block = settings[settings.index("DEFAULT_VIEW_SETTINGS") :]
    block = block[: block.index("}")]
    assert "followRunningBlock: true" in block, (
        "Torna spento di default. Con Copilot e pannello robot aperti il canvas "
        "ha un pavimento di 480px e un programma con due condizioni e' circa il "
        "doppio: meta' del programma resta fuori schermo durante una corsa, e "
        "l'operatore non puo' sapere dove scorrere perche' ad avanzare e' il "
        "robot, non la pagina."
    )


# ── Add a step is reachable without opening a menu ─────────────────────────


def test_add_a_step_is_on_the_toolbar_not_only_under_the_overflow():
    editor = _read(EDITOR)
    overlay = editor[editor.index("workspace-controls-group--top-right") :]
    overlay = overlay[: overlay.index("workspace-controls-group--bottom-right")]
    assert 'aria-label="Add a step"' in overlay, (
        "'Add a step' torna solo dentro il menu ⋯, allo stesso livello di "
        "'Export task': l'unica alternativa al trascinamento di nuovo dietro "
        "tre puntini."
    )


# ── The preview card ───────────────────────────────────────────────────────


def test_the_preview_opens_on_keyboard_focus():
    preview = _read(PREVIEW)
    assert "disableFocusListener" not in preview, (
        "L'anteprima torna a essere solo da mouse. Le pill si percorrono con "
        "le frecce e Enter aggiunge il blocco, quindi tutto cio' che spiega "
        "COSA sia un blocco sarebbe di nuovo irraggiungibile da tastiera."
    )


def test_an_io_line_is_shown_only_when_it_says_something():
    preview = _read(PREVIEW)
    assert "item.inputs !== 'None'" in preview, (
        "Le righe I/O tornano a comparire sempre: 'Output: None' su 13 dei 21 "
        "blocchi che dichiarano il campo, in vocabolario da firma di funzione, "
        "su una scheda letta da chi non programma."
    )
    assert "item.outputs !== 'None'" in preview
