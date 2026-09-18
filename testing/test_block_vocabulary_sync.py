"""One block, one name, on every surface that shows it.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_block_vocabulary_sync.py -v

A step block is named in four places: the Blockly definition (canvas text and
tooltip), the toolbox pill, the Ctrl/Cmd+K search palette, and the shadow-slot
picker. The last three each kept their own string literals, and drifted:

    repeat_until_block    toolbox "Repeat"                 palette "Repeat until"
    when_block            toolbox "When → Do"              palette "When"
    when_otherwise_block  toolbox "When → Do / Otherwise"  palette "When / Otherwise"
    human_action_block    toolbox "Pause and show message" palette "Pause and show"

The first is the one that mattered. "Repeat until" is the phrasing the block was
deliberately renamed away from — its canvas text reads "Repeat / Do / Stop when"
because operators read "repeat until they press" and "repeat each time they
press" equally readily when the condition is an event. The palette kept offering
the discarded name, so the app taught the misreading on one surface while
correcting it on another.

Descriptions had the same split: the palette said a "Worker" shows a gesture
where every other surface said "operator" — a third word for the person at the
cell, in front of someone learning the app in one session.

So both now come from blockTextDictionary, and this file checks that they still
do. It parses the TypeScript rather than importing it: the assertion is about
where the string comes from, and a bundler would erase exactly that.
"""
import os
import re

import pytest

SRC = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "features", "blockly")
)
DICTIONARY = os.path.join(SRC, "blocks", "blockTextDictionary.ts")
TOOLBOX = os.path.join(SRC, "toolbox", "toolboxRegistry.ts")
CATALOG = os.path.join(SRC, "editor", "shadowPicker", "catalog.ts")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _without_comments(src):
    """Strip // and /* */ comments.

    Not cosmetic: both files keep whole disabled entries commented out (the
    hidden timer and logic blocks), and a multi-line pattern happily matches a
    `name:` inside one against a `blockType:` in the live entry that follows —
    which reported 'Time passed' as repeat_block's hardcoded label.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", src)


def _dictionary_values(name):
    """key -> string literal, for the entries that are plain strings.

    Entries built from another constant (macro_task_block used to read
    UI_TEXT.savedTask) simply do not appear, which is correct: this reads the
    labels, not the expressions that produce them.
    """
    src = _read(DICTIONARY)
    body = src.split(f"export const {name} = {{", 1)[1].split("} as const", 1)[0]
    body = re.sub(r"//[^\n]*", "", body)
    return dict(re.findall(r"^\s*(\w+):\s*'([^']*)'", body, re.MULTILINE))


def _dictionary_keys(name):
    """Keys of one `export const <name> = { ... } as const` object."""
    src = _read(DICTIONARY)
    body = src.split(f"export const {name} = {{", 1)[1].split("} as const", 1)[0]
    # Strip comments first: a commented-out entry is not a key, and several
    # blocks carry a rationale comment containing a colon.
    body = re.sub(r"//[^\n]*", "", body)
    return set(re.findall(r"^\s*(\w+):", body, re.MULTILINE))


# ─────────────────────────────────────────────────────────────────────────────
# The dictionaries themselves
# ─────────────────────────────────────────────────────────────────────────────

def test_every_labelled_block_also_has_a_description():
    labels = _dictionary_keys("blockLabelsByType")
    descriptions = _dictionary_keys("blockDescriptionsByType")
    missing = sorted(labels - descriptions)
    assert not missing, (
        f"blockLabelsByType names {missing} with no entry in "
        "blockDescriptionsByType — the palette renders the description under "
        "the name, so these rows would show a title and nothing else"
    )


def test_the_dictionary_holds_only_blocks_something_actually_renders():
    """Every key must have a reader, or it drifts unnoticed.

    Objects / Locations / Skills are plural headings that open a picker, not
    step-block names. Saved Task has no single static name — the pill says the
    category term, each picker row says the task's own name. The hidden timer
    and logic blocks render no name at all: a collapsed block's text comes from
    collapseSummary.ts's per-block functions, not from a label.
    """
    labels = _dictionary_keys("blockLabelsByType")
    for absent in (
        "object_block", "location_block", "action_block", "macro_task_block",
        "timer_block", "logic_and_block", "logic_or_block", "logic_not_block",
    ):
        assert absent not in labels, (
            f"{absent} has no surface that renders a static label for it"
        )


# ─────────────────────────────────────────────────────────────────────────────
# The two surfaces
# ─────────────────────────────────────────────────────────────────────────────

# toolboxRegistry: `type: 'x_block',` … `label: <expr>,`
_TOOLBOX_ENTRY = re.compile(r"type: '(\w+)',\s*label: ([^,\n]+),")

# catalog: `name: <expr>,` … `blockType: 'x_block',` — the reverse order, and
# the two are separated by description/keywords lines.
_CATALOG_ENTRY = re.compile(r"name: ([^,\n]+),\n(?:[^\n]*\n)*?\s*blockType: '(\w+)'")

# A Saved Task row is named after the task the operator saved, at runtime.
# There is no static label for it on this surface, and pinning one would be
# wrong rather than merely redundant.
_RUNTIME_NAMED = {"macro_task_block"}


def _toolbox_entries():
    pairs = _TOOLBOX_ENTRY.findall(_without_comments(_read(TOOLBOX)))
    return [(t, n) for (t, n) in pairs if t not in _RUNTIME_NAMED]


def _catalog_entries():
    pairs = _CATALOG_ENTRY.findall(_without_comments(_read(CATALOG)))
    return [(t, n) for (n, t) in pairs if t not in _RUNTIME_NAMED]


def test_the_regexes_still_match_something():
    """A pattern that silently matches nothing turns every assertion below into
    a vacuous pass — which is how a guard survives the change it was meant to
    catch."""
    assert len(_toolbox_entries()) >= 12
    assert len(_catalog_entries()) >= 12


@pytest.mark.parametrize("surface,entries", [
    ("toolboxRegistry.ts", _toolbox_entries()),
    ("shadowPicker/catalog.ts", _catalog_entries()),
])
def test_no_surface_hardcodes_a_step_block_name(surface, entries):
    labels = _dictionary_keys("blockLabelsByType")
    hardcoded = [
        (block_type, expr.strip())
        for block_type, expr in entries
        if block_type in labels and "blockLabelsByType" not in expr
    ]
    assert not hardcoded, (
        f"{surface} writes its own name for {[b for b, _ in hardcoded]} instead "
        f"of reading blockLabelsByType: {hardcoded}. Two lists of the same names "
        "is how 'Repeat' and 'Repeat until' ended up on the same block."
    )


def test_the_palette_does_not_hardcode_descriptions_either():
    src = _read(CATALOG)
    static = src.split("const staticItems", 1)[1].split("const macroItems", 1)[0]
    triggers = src.split("TRIGGER_PICKER_ITEMS", 1)[1].split("]", 1)[0]
    literals = re.findall(r"description:\s*\n?\s*'", static + triggers)
    assert not literals, (
        f"{len(literals)} description(s) in the picker are string literals "
        "rather than blockDescriptionsByType lookups"
    )


def test_both_surfaces_cover_the_same_step_blocks():
    """Neither list may quietly gain or lose a block the other has.

    Only blocks the dictionary names are compared: the toolbox additionally
    carries the three entity pills, and the palette additionally carries one row
    per published Saved Task, both built at runtime.
    """
    labels = _dictionary_keys("blockLabelsByType")
    toolbox = {t for t, _ in _toolbox_entries() if t in labels}
    catalog = {t for t, _ in _catalog_entries() if t in labels}

    only_toolbox = sorted(toolbox - catalog)
    only_catalog = sorted(catalog - toolbox)
    assert not only_toolbox and not only_catalog, (
        f"draggable from the toolbox but unsearchable: {only_toolbox}; "
        f"searchable but not draggable: {only_catalog}"
    )


def test_the_two_message_blocks_state_their_difference():
    """One suspends the robot, the other does not, and both put a message on
    screen. The labels have to carry that.

    The non-blocking one was an ellipsis of its own canvas text: canvas "Show
    message and continue:", pill "Show message". It dropped the words that
    separate it from its twin, so the palette read

        Pause and show message
        Show message

    — two message blocks differing by a prefix that is easy to skim past, with
    the word stating the difference positively ("continue") missing entirely.

    Blocking versus non-blocking is what this category is for. Naming only one
    of the two for its effect is asymmetric.
    """
    labels = _dictionary_values("blockLabelsByType")
    human = labels["human_action_block"]
    notify = labels["notify_action_block"]

    assert "pause" in human.lower(), (
        "l'azione umana non dice piu' che mette in pausa: e' l'unico effetto "
        "che la distingue dal messaggio non bloccante."
    )
    assert "continue" in notify.lower(), (
        "il messaggio non bloccante non dice piu' che il robot prosegue: "
        "resterebbe distinguibile solo per assenza del prefisso 'Pause and'."
    )

    # Both quote their own canvas text rather than inventing a third wording.
    src = _read(os.path.join(SRC, "blocks", "definitions.ts"))
    assert "Pause and show:" in src and "Show message and continue:" in src, (
        "il testo sul canvas e' cambiato senza che le etichette lo seguissero"
    )


def test_the_two_repeat_blocks_are_told_apart_in_the_palette():
    """Adjacent in the same category and one word apart.

    "Repeat times" and a bare "Repeat" do not say which is the counted loop and
    which waits for something. On the canvas they are unmistakable, and by the
    mechanism the literature actually relies on: the SLOT. A number field
    against a Boolean socket — and this project draws Boolean connections with
    their own shape, see workspace/customRender.ts, where `thrasos_boolean`
    overrides shapeFor() for exactly that. It is the same trick as Scratch's
    hexagon.

    A text pill throws that shape away, so the palette is the one surface where
    the distinction is invisible. Naming the block's third row puts it back
    with words the block already contains.

    "Repeat until" stays banned: with conditions phrased as events, "repeat
    until they press" and "repeat each time they press" read equally, which is
    why the canvas says "Stop when" and why promising "until" in the palette
    would point at words the block does not have.
    """
    labels = _dictionary_values("blockLabelsByType")
    counted = labels["repeat_block"]
    conditional = labels["repeat_until_block"]

    assert counted != conditional
    assert "until" not in conditional.lower(), (
        "la pillola promette di nuovo 'until': il blocco dice 'Stop when', e "
        "con condizioni-evento 'until' e' proprio la lettura ambigua da cui il "
        "canvas era stato riscritto."
    )
    assert "stop when" in conditional.lower(), (
        "la pillola del ciclo condizionato non nomina piu' la riga che lo "
        "distingue: accanto a 'Repeat times' resta a una parola di distanza, "
        "e la palette e' l'unica superficie dove la forma dell'innesto non "
        "si vede."
    )

    # One joining mark for the whole category, not two. The two When pills
    # already joined the block's rows with an arrow; an ellipsis here would be
    # a second device doing the same job on the same four pills.
    assert "…" not in conditional and "..." not in conditional, (
        "la pillola unisce le righe con i puntini mentre le due 'When' della "
        "stessa categoria usano la freccia: due segni per lo stesso lavoro."
    )
    assert "→" in conditional, "manca la freccia che unisce le righe"
    for pill in ("when_block", "when_otherwise_block"):
        assert "→" in labels[pill], (
            f"{pill} non usa piu' la freccia: era la convenzione da cui "
            "'Repeat → Do → Stop when' e' derivata."
        )

    # The words must be ON the block, not invented for the palette.
    src = _read(os.path.join(SRC, "blocks", "definitions.ts"))
    assert "'Stop when %1'" in src, (
        "il canvas non dice piu' 'Stop when': la pillola citerebbe parole che "
        "il blocco non contiene."
    )


def test_the_boolean_slot_still_has_a_shape_of_its_own():
    """The palette label is a workaround for something the canvas does right.

    If the custom renderer goes, Boolean sockets fall back to thrasos's puzzle
    tab and the canvas loses the shape coding that tells a counted loop from a
    conditional one — at which point the pill text is carrying the distinction
    alone, on both surfaces, and that is worth knowing.
    """
    render = _read(os.path.join(SRC, "workspace", "customRender.ts"))
    assert "shapeFor" in render and "'Boolean'" in render, (
        "il renderer non da' piu' una forma propria agli innesti Boolean: il "
        "canvas perde la codifica di forma che distingue i due cicli."
    )
    config = _read(os.path.join(SRC, "workspace", "workspaceConfig.ts"))
    assert "thrasos_boolean" in config, (
        "il workspace non usa piu' il renderer che disegna quella forma"
    )


def test_the_logic_operators_are_not_written_as_code():
    """`AND` / `OR` / `NOT` in capitals is the hard-to-learn jargon Bau et al.
    cite Stefik & Siebert against, and Scratch writes them lowercase.

    These have no toolbox pill — hidden on the advisor's feedback — but the
    chat still emits them: the prompt documents "and"/"or"/"not" as valid
    conditions and validate_condition accepts them. They therefore arrive on a
    canvas the operator never chose them for, which makes them the one place in
    this vocabulary where machine notation actually reaches the screen.
    """
    src = _read(os.path.join(SRC, "blocks", "definitions.ts"))
    for shouty in ("'%1 AND %2'", "'%1 OR %2'", "'NOT %1'"):
        assert shouty not in src, (
            f"un operatore logico torna in maiuscolo ({shouty}): su un canvas "
            "in cui gli operandi sono proposizioni intere, si legge come "
            "codice invece che come una frase."
        )
    for quiet in ("'%1 and %2'", "'%1 or %2'", "'not %1'"):
        assert quiet in src, f"manca la forma minuscola {quiet}"


def test_search_still_finds_a_renamed_block_by_its_old_word():
    """Keywords are what make a rename safe.

    "Repeat until" was a name; it is now only a search synonym. An operator who
    learnt the old word, or who reaches for it because it is the natural one,
    must still land on the block.
    """
    src = _read(CATALOG)
    entry = src.split("blockLabelsByType.repeat_until_block", 1)[1].split("},", 1)[0]
    keywords = entry.split("keywords: [", 1)[1].split("]", 1)[0]
    assert "'until'" in keywords, (
        "repeat_until_block dropped 'until' from its keywords: the block no "
        "longer carries that word in its name, so nothing would match it"
    )
