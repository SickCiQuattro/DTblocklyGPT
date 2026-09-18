"""The AND / OR / NOT operators are reachable, but only behind a setting.

They were pulled from the palette on advisor feedback, because they ask a
non-programmer to hold a boolean expression in mind. Commenting them out was
the quick way to do that, and it had a cost: the chat assistant still emits
them (`validate_condition` accepts them and the prompt documents them), so they
arrive in real workspaces through a door the toolbox does not have. A user who
receives one cannot build a second by hand.

The setting restores the hand-built path without restoring the default. These
tests pin the three properties that make that true: the entries exist, they are
marked advanced, and both insert paths filter on the same flag.
"""

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "src"
BLOCKLY = FRONTEND / "features" / "blockly"

SETTINGS = BLOCKLY / "utils" / "useViewSettings.ts"
REGISTRY = BLOCKLY / "toolbox" / "toolboxRegistry.ts"
TOOLBOX = BLOCKLY / "toolbox" / "CustomToolbox.tsx"
CATALOG = BLOCKLY / "editor" / "shadowPicker" / "catalog.ts"
PICKER = BLOCKLY / "editor" / "shadowPicker" / "useShadowPicker.ts"
EDITOR = BLOCKLY / "editor" / "BlocklyEditor.tsx"

OPERATORS = ("logic_and_block", "logic_or_block", "logic_not_block")


def _without_comments(text: str) -> str:
    """Drop // lines so a guard cannot be satisfied by prose about itself."""
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("//")
    )


def test_the_setting_exists_and_is_off_by_default():
    source = SETTINGS.read_text(encoding="utf-8")
    assert "showLogicOperators: boolean" in source
    assert "showLogicOperators: false," in source, (
        "the default must stay off — turning it on changes the palette every "
        "study participant sees"
    )


def test_the_three_operators_are_live_entries_not_comments():
    for path in (REGISTRY, CATALOG):
        live = _without_comments(path.read_text(encoding="utf-8"))
        for operator in OPERATORS:
            assert operator in live, f"{operator} is still commented out in {path.name}"


def test_each_operator_carries_the_advanced_flag():
    for path in (REGISTRY, CATALOG):
        source = path.read_text(encoding="utf-8")
        # one `advanced: true` per operator, and no more: the flag is what
        # hides them, so an entry that loses it becomes silently visible.
        assert source.count("advanced: true") == len(OPERATORS), (
            f"{path.name} should mark exactly {len(OPERATORS)} entries advanced"
        )


def test_both_insert_paths_filter_on_the_same_flag():
    """The palette and the shadow picker are two ways to reach the same block."""
    for path in (TOOLBOX, PICKER):
        live = _without_comments(path.read_text(encoding="utf-8"))
        assert re.search(r"!item\.advanced \|\| showLogicOperators", live), (
            f"{path.name} does not filter advanced entries on the setting"
        )


def test_the_editor_feeds_the_setting_to_both_paths():
    live = _without_comments(EDITOR.read_text(encoding="utf-8"))
    assert live.count("viewSettings?.showLogicOperators") == 2, (
        "the toolbox and the shadow picker must both receive the setting; "
        "wiring only one leaves the operators reachable from the other"
    )
    assert 'label="Condition operators"' in live, "no switch in the settings panel"
