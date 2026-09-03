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


def _luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _linear(r) + 0.7152 * _linear(g) + 0.0722 * _linear(b)


def contrast_vs_white(hex_colour: str) -> float:
    """WCAG relative-luminance contrast ratio against #FFFFFF."""
    return 1.05 / (_luminance(hex_colour) + 0.05)


def contrast_ratio(a: str, b: str) -> float:
    """WCAG contrast between two arbitrary colours.

    Needed for the amber tones: their pairing is ink-on-colour, not
    white-on-colour, so contrast_vs_white says nothing about them.
    """
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _read_source(relative_path: str) -> str:
    return open(
        os.path.join(os.path.dirname(__file__), "..", relative_path),
        encoding="utf-8",
    ).read()


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


# ── ConfirmDialog tones ───────────────────────────────────────────────────────


def test_the_caution_tone_pairs_amber_with_ink_at_its_lightest():
    """Amber is the one ramp where darkening HURTS the ink pairing.

    main/ink 7.94:1, dark/ink 5.35:1, darker/ink 3.40:1 — the last fails AA.
    The other two dialog tones go darker for contrast; caution must go the
    other way, and it lands on the same pair the robot panel's run button uses.
    A future "make it darker for emphasis" edit is exactly what this catches.
    """
    ink = "#1A1A2E"
    assert contrast_ratio("#F59E0B", ink) >= 4.5   # warning.main  — resting
    assert contrast_ratio("#D97706", ink) >= 4.5   # warning.dark  — hover
    assert contrast_ratio("#B45309", ink) < 4.5    # warning.darker — must NOT be used

    src = _read_source("frontend/src/components/ConfirmDialog.tsx")
    caution = src[src.index("caution: {"):src.index("default: {")]
    assert "warning.main" in caution and "warning.dark" in caution
    assert "warning.darker" not in caution, (
        "il tono caution usa warning.darker: 3.40:1 con l'inchiostro, sotto AA."
    )


def test_starting_the_arm_is_not_the_destructive_colour():
    """Red is the Stop button during a run. If the dialog that STARTS the arm
    were also red, the two opposite actions would share a colour on a cell with
    a physical robot in it."""
    src = _read_source("frontend/src/components/DigitalTwinPanel.tsx")
    dialog = src[src.index('title="Run on the real robot?"'):]
    dialog = dialog[:dialog.index("/>")]
    assert 'tone="caution"' in dialog, (
        "il dialogo di avvio del robot reale non e' piu' in tono caution"
    )


# ── Live-execution highlight ─────────────────────────────────────────────────


def test_the_running_block_outline_separates_from_every_block_colour():
    """The highlight cannot be a palette colour, and this is why.

    palette.ts tunes all eight colours to clear 4.5:1 against white LABEL text,
    which lands them all at roughly the same relative luminance (0.115–0.183).
    Two colours of equal luminance contrast at ~1:1 regardless of hue — so the
    indigo outline this used to have measured 1.01:1 against eventsConditions,
    1.02:1 against macroTasks, and 1.42:1 at its very best. An operator asked
    why the running block was hard to spot; it was not a matter of taste.

    Lightness is the only free dimension, and white is the end of it.
    """
    css = _read_source("frontend/src/features/blockly/styles/editor.css")
    block = css[css.index(".block--executing > .blocklyPath"):]
    block = block[:block.index("@keyframes blockExecuting")]
    stroke = re.search(r"stroke:\s*(#[0-9a-fA-F]{3,8})", block)
    assert stroke, "il contorno del blocco in esecuzione non e' piu' un colore esplicito"

    worst = min(
        (contrast_ratio(stroke.group(1), hex_colour), name)
        for name, hex_colour, _ in palette_entries()
    )
    assert worst[0] >= 4.5, (
        f"il contorno {stroke.group(1)} rende {worst[0]:.2f}:1 su "
        f"'{worst[1]}': sotto AA, e l'operatore non distingue il blocco in "
        f"esecuzione dagli altri."
    )


def test_the_running_block_glow_separates_from_the_canvas():
    """White clears the block fill and disappears on the canvas (1.04:1), so
    the glow carries that half. Two colours because there are two backgrounds,
    not for decoration."""
    css = _read_source("frontend/src/features/blockly/styles/editor.css")
    frames = css[css.index("@keyframes blockExecuting"):]
    frames = frames[:frames.index("@media")]
    glow = re.search(r"rgba\((\d+),\s*(\d+),\s*(\d+)", frames)
    assert glow, "l'alone non e' piu' un rgba() leggibile"
    hexv = "#%02X%02X%02X" % tuple(int(glow.group(i)) for i in (1, 2, 3))
    assert contrast_ratio(hexv, "#FAFAFB") >= 3.0, (
        f"l'alone {hexv} rende {contrast_ratio(hexv, '#FAFAFB'):.2f}:1 sul "
        "fondo della tela: il blocco in esecuzione non si stacca da essa."
    )


def test_the_glow_is_never_fully_transparent():
    """It used to animate 0 → 0.7 → 0, so the highlight was invisible for half
    of every cycle no matter what colour it was."""
    css = _read_source("frontend/src/features/blockly/styles/editor.css")
    frames = css[css.index("@keyframes blockExecuting"):]
    frames = frames[:frames.index("@media")]
    alphas = [float(a) for a in re.findall(r"rgba\([^)]*,\s*([\d.]+)\)", frames)]
    assert alphas, "nessun alone trovato nell'animazione"
    assert min(alphas) >= 0.3, (
        f"l'alone scende a {min(alphas)}: il blocco in esecuzione torna a "
        "sparire per una parte di ogni ciclo."
    )
