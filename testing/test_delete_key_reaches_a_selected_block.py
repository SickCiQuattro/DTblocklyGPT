"""Guard: Delete must reach a block that is selected but not focused.

Reported after P06's session, 2026-09-18: "the delete key often does not work".

Selection and DOM focus are two different things in Blockly. Clicking a block
selects it without moving focus — the gesture ends on an SVG element that is
not focusable, so `document.activeElement` stays where it was, very often
`<body>`, and after a drag from the palette the palette pill, which is a React
element outside the injection div.

The handler required focus to be INSIDE `.injectionDiv` and returned otherwise.
Blockly's own Delete shortcut needs workspace focus too, so nothing ran at all:
the block sat there visibly selected while the key did nothing.

The fix is narrow on purpose. "Nothing is focused" is the only extra case that
passes, because then there is no control to steal the key from and the selected
block is the only thing Delete could mean. A focused control outside the
workspace still wins, and every text field was already let through by
`isTypingContext()` one guard earlier.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EDITOR = os.path.join(
    ROOT, "frontend", "src", "features", "blockly", "editor", "BlocklyEditor.tsx"
)


def _handler() -> str:
    """The Delete/Backspace keydown handler, comments stripped."""
    src = open(EDITOR, encoding="utf-8").read()
    start = src.index("const handleKeyDown = (e: KeyboardEvent) => {")
    end = src.index("document.addEventListener('keydown', handleKeyDown", start)
    body = src[start:end]
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.DOTALL)
    return "\n".join(
        riga for riga in body.split("\n") if not riga.strip().startswith("//")
    )


def test_a_selected_block_is_deletable_with_nothing_focused():
    code = _handler()
    assert "document.body" in code, (
        "il gestore non ammette il caso «nessun controllo a fuoco»: un blocco "
        "selezionato col mouse non si cancella con Canc."
    )
    assert re.search(r"!isInsideWorkspace\s*&&\s*!nothingFocused", code), (
        "la guardia deve lasciar passare ENTRAMBI i casi — fuoco nell'area di "
        "lavoro, oppure nessun fuoco — e fermare solo un controllo a fuoco altrove."
    )


def test_a_focused_control_elsewhere_still_wins():
    """The guard must stay a guard: this is the half that is easy to delete."""
    code = _handler()
    assert "isInsideWorkspace" in code and "return" in code, (
        "la guardia sul fuoco è sparita: Canc verrebbe intercettato ovunque."
    )


def test_typing_is_still_checked_before_the_focus_guard():
    """Backspace in a description must erase a character, not a block.

    This handler runs in the capture phase, ahead of the input's own default,
    so the typing check has to come first — and relaxing the focus guard makes
    that ordering load-bearing rather than merely tidy.
    """
    code = _handler()
    assert code.index("isTypingContext()") < code.index("isInsideWorkspace"), (
        "isTypingContext deve precedere la guardia sul fuoco."
    )


def test_deletion_goes_through_the_cascade_safe_path():
    """Not Blockly's checkAndDelete, which orphans value-input children."""
    code = _handler()
    assert "disposeBlockWithBody" in code
    assert "checkAndDelete" not in code
