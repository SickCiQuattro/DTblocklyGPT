"""Guard on the two block-deletion paths in the Blockly editor.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_block_delete_paths.py -v

Blockly's own deletion (`BlockSvg.checkAndDelete()` -> `dispose(healStack)`) cascades
from the parent down and leaves a value-input child behind as a floating orphan when
the parent occupies a connection with a default shadow configured. The editor works
around this with `disposeBlockWithBody()` in `utils/blocklySelection.ts`, which
disposes leaves first.

The bug this file exists to prevent is subtle and was live in the codebase: the
workaround was invoked *inside the branch that shows a confirmation dialog*, so the
confirm gate was silently deciding **which deletion implementation ran**, not merely
whether to ask. With the default `deleteConfirmMode: 'multiple'` a single block never
asks, so the most common deletion of all fell through to Blockly and hit exactly the
cascade the workaround exists to avoid. It looked correct in review because the safe
code was right there, a few lines below.

So this checks the property that broke, not the code that implements it: every
deletion path runs the safe disposal, on both branches of the confirm gate.

There is no JS test runner in this project (same constraint as
`test_wcag_contrast.py`), so this parses the TypeScript source the way
`test_abort_messages.py` parses `simulate.py`.
"""
import os
import re
import sys

import pytest

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
EDITOR = os.path.join(FRONTEND, "features", "blockly", "editor", "BlocklyEditor.tsx")
SELECTION = os.path.join(FRONTEND, "utils", "blocklySelection.ts")

SAFE_DISPOSE = "disposeBlockWithBody"


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _strip_comments(source: str) -> str:
    """Drop `//` line comments so a test reasons about code, not about prose.

    Needed: the comments in these handlers explain the bug by naming the very
    call the test asserts is absent.
    """
    return re.sub(r"^\s*//.*$", "", source, flags=re.MULTILINE)


def _slice_between(source: str, start_marker: str, end_marker: str) -> str:
    """The source between two anchors, so a test reasons about one handler only."""
    start = source.find(start_marker)
    assert start != -1, f"ancora non trovata: {start_marker!r}"
    end = source.find(end_marker, start)
    assert end != -1, f"ancora di fine non trovata: {end_marker!r}"
    return source[start:end]


# ─── The safe disposal itself ────────────────────────────────────────────────


def test_safe_dispose_exists():
    assert f"export const {SAFE_DISPOSE}" in _read(SELECTION), (
        f"{SAFE_DISPOSE} non esiste piu' in blocklySelection.ts. E' la sola "
        f"cancellazione che non lascia orfani: se e' stata rinominata, aggiornare "
        f"questo test; se e' stata rimossa, il bug degli orfani e' tornato."
    )


def test_safe_dispose_goes_leaf_first():
    """Reverse iteration over the descendants is the whole point of the helper."""
    body = _slice_between(_read(SELECTION), f"export const {SAFE_DISPOSE}", "\n}")
    assert re.search(r"for \(let i = descendants\.length - 1; i >= 0; i--\)", body), (
        "la disposizione non e' piu' in ordine inverso (foglie per prime). "
        "Disporre il genitore per primo riattiva la cascata di Blockly, che e' "
        "esattamente cio' che orfana i figli negli innesti valore."
    )


# ─── Path 1: the keyboard Delete/Backspace handler ───────────────────────────


KEYBOARD_HANDLER = "const handleKeyDown = (e: KeyboardEvent) => {"


def test_keyboard_delete_uses_safe_dispose():
    body = _slice_between(_read(EDITOR), KEYBOARD_HANDLER, "document.addEventListener")
    assert SAFE_DISPOSE in body, (
        "il gestore Delete da tastiera non chiama piu' "
        f"{SAFE_DISPOSE}: la cancellazione ricade su quella di Blockly, che "
        "lascia orfani i figli negli innesti valore."
    )


def test_keyboard_delete_does_not_bail_before_deleting():
    """The regression itself: an early return that hands the key back to Blockly.

    `preventDefault()` must come before any confirm-gate branch. If the handler can
    return without it, the keydown continues to Blockly's own delete shortcut.
    """
    body = _slice_between(_read(EDITOR), KEYBOARD_HANDLER, "document.addEventListener")
    gate = body.find("shouldConfirmDeleteRef.current(")
    assert gate != -1, "il gate di conferma e' sparito dal gestore da tastiera"
    prevent = body.find("e.preventDefault()")
    assert prevent != -1, "preventDefault() non e' piu' chiamato"
    assert prevent < gate, (
        "preventDefault() viene dopo il controllo su shouldConfirmDelete. "
        "Cosi' il ramo che non chiede conferma esce lasciando proseguire "
        "l'evento fino a Blockly, che cancella con la cascata buggata. E' "
        "esattamente la forma del bug originale: il gate deve decidere se "
        "CHIEDERE, mai quale implementazione della cancellazione gira."
    )


# ─── Path 2: the block context-menu "Delete" item ────────────────────────────


CONTEXT_BRANCH = "if (isDelete && currentMenu?.blockId) {"


def test_context_menu_delete_uses_safe_dispose():
    body = _slice_between(_read(EDITOR), CONTEXT_BRANCH, "window.setTimeout")
    assert SAFE_DISPOSE in body, (
        "il ramo di cancellazione del menu contestuale non chiama piu' "
        f"{SAFE_DISPOSE}."
    )


def test_context_menu_delete_covers_both_confirm_branches():
    """Same property as the keyboard path, expressed for this branch.

    Both outcomes of the confirm gate must delete; neither may fall through to
    Blockly's own `option.callback()`.
    """
    body = _strip_comments(
        _slice_between(_read(EDITOR), CONTEXT_BRANCH, "window.setTimeout")
    )
    assert body.count(SAFE_DISPOSE) >= 1, "nessuna cancellazione sicura nel ramo"
    assert "option.callback()" not in body, (
        "il ramo del menu contestuale richiama ancora option.callback() di "
        "Blockly, cioe' checkAndDelete(): la cascata che orfana i figli."
    )
    assert re.search(r"if \(!shouldConfirmDelete\(totalCount\)\)", body), (
        "il ramo senza conferma non e' piu' esplicito. Serve che ENTRAMBI i "
        "rami del gate cancellino, non solo quello che apre il dialogo."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
