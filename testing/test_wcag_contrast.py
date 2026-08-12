"""WCAG 1.4.3 / 1.4.11 guard on the Blockly block palette.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_wcag_contrast.py -v

The thesis claims AA conformance for block colours. Six of the eight palette
entries clear the 4.5:1 threshold by less than 0.13, and `eventsConditions`
clears it by 0.01 — a single luminosity step taken to make a colour "a bit
nicer" drops it below AA, and nothing else in the build would notice: there is
no JS test runner in this project and no automated contrast checker.

So the check lives here, parsing the TypeScript source the same way
`test_abort_messages.py` parses `simulate.py`. It asserts two things:

1. every colour still clears 4.5:1 against white;
2. the ratio written in the comment next to each colour matches the computed
   one, so a colour changed without updating its documented ratio fails here
   rather than silently making the thesis claim false.

White is the reference because block text is white under the Classic theme
(`features/blockly/workspace/workspaceConfig.ts`), not the workspace
background.
"""
import os
import re
import sys

import pytest

PALETTE = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "features",
    "blockly", "blocks", "palette.ts",
)

WCAG_AA_TEXT = 4.5  # 1.4.3 normal-size text

# `/** ... — 4.51:1 (+0.01) */` then `name: '#RRGGBB',`
ENTRY = re.compile(
    r"/\*\*(?P<doc>[^*]*(?:\*(?!/)[^*]*)*)\*/\s*"
    r"(?P<name>\w+):\s*'(?P<hex>#[0-9A-Fa-f]{6})'",
)
DOC_RATIO = re.compile(r"(\d+\.\d+):1")


def _linear(channel: int) -> float:
    c = channel / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def contrast_vs_white(hex_colour: str) -> float:
    """WCAG relative-luminance contrast ratio against #FFFFFF."""
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    luminance = 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)
    return 1.05 / (luminance + 0.05)


def palette_entries() -> list[tuple[str, str, float | None]]:
    """(name, hex, documented ratio or None) for every colour in palette.ts."""
    source = open(PALETTE, encoding="utf-8").read()
    entries = []
    for match in ENTRY.finditer(source):
        documented = DOC_RATIO.search(match.group("doc"))
        entries.append((
            match.group("name"),
            match.group("hex"),
            float(documented.group(1)) if documented else None,
        ))
    return entries


def test_palette_parses():
    """A refactor that reshapes the file must not silently disable this guard."""
    entries = palette_entries()
    assert len(entries) == 8, f"attese 8 voci, trovate {len(entries)}: {entries}"


@pytest.mark.parametrize("name,hex_colour,documented", palette_entries())
def test_colour_clears_wcag_aa(name, hex_colour, documented):
    ratio = contrast_vs_white(hex_colour)
    assert ratio >= WCAG_AA_TEXT, (
        f"{name} ({hex_colour}) ha contrasto {ratio:.2f}:1 contro il bianco, "
        f"sotto la soglia AA di {WCAG_AA_TEXT}:1. Alzare la luminosita' del "
        f"colore, non abbassare questa soglia."
    )


@pytest.mark.parametrize("name,hex_colour,documented", palette_entries())
def test_documented_ratio_matches_computed(name, hex_colour, documented):
    """Catches a colour edited without updating the ratio written beside it."""
    assert documented is not None, (
        f"{name} non ha un rapporto documentato nel commento. Aggiungere "
        f"'— {contrast_vs_white(hex_colour):.2f}:1' cosi' che una modifica "
        f"futura sia verificabile."
    )
    computed = contrast_vs_white(hex_colour)
    assert abs(computed - documented) < 0.01, (
        f"{name} ({hex_colour}): il commento dice {documented}:1 ma il valore "
        f"reale e' {computed:.2f}:1. Il colore e' stato cambiato senza "
        f"aggiornare il rapporto documentato."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
