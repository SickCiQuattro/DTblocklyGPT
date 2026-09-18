"""Guard on the Copilot panel's affordances.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_chat_panel.py -v

The panel had its affordances inverted. It was empty where it should have
offered — one welcome bubble, a composer, and roughly half the height blank,
with a text field as the only thing to act on — and it offered where nothing
happened: the suggestion chip was drawn in the same indigo, border and radius
as the Review and Apply buttons, carried an imperative ("Set confirmation to
thumbs up gesture"), and was a `div` with no handler.

That combination matters here because of what testing showed operators do:
they look for something to press, and when they do not see one they look
somewhere else rather than keep hunting. A panel with no true affordance and
one false affordance sends them away twice.

There is no JS test runner in this project (same constraint as
`test_wcag_contrast.py` and `test_panel_messages.py`), so this parses the
TypeScript source.
"""
import os

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
THREAD = os.path.join(FRONTEND, "components", "ChatThread.tsx")
BUBBLE = os.path.join(FRONTEND, "components", "AssistantBubble.tsx")
CARD = os.path.join(FRONTEND, "components", "TaskPreviewCard.tsx")


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _without_comments(src: str) -> str:
    """Drop `//` lines.

    A guard that reads the source has to ignore prose, or the comment
    explaining why a property was removed reintroduces the property's name and
    fails the test that the removal was the point of.
    """
    return "\n".join(
        line for line in src.splitlines() if not line.strip().startswith("//")
    )


# ── The chip that looks pressable must be pressable ────────────────────────


def test_the_suggestion_chip_is_a_button_and_sends_its_own_text():
    bubble = _read(BUBBLE)
    chip = bubble[bubble.index("part.type === 'suggestion'") :]
    chip = chip[: chip.index("part.type === 'warning'")]

    assert "<button" in chip, (
        "Il chip suggerimento e' tornato un elemento non interattivo, con lo "
        "stesso indaco e lo stesso bordo dei bottoni Review e Apply."
    )
    assert "onSuggestionClick(part.content)" in chip, (
        "Il chip non invia piu' il proprio testo: resta un bottone che non fa "
        "niente, che e' il difetto originale con una etichetta diversa."
    )

    thread = _read(THREAD)
    assert "onSuggestionClick={(text) => void sendText(text)}" in thread, (
        "ChatThread non collega piu' il gestore, e la prop obbligatoria e' "
        "l'unica cosa che impediva di ridisegnare l'affordance senza darle un "
        "effetto."
    )


def test_the_suggestion_handler_is_required_not_optional():
    """Optional would let the chip be drawn again with nothing behind it."""
    bubble = _read(BUBBLE)
    assert "onSuggestionClick: (text: string) => void" in bubble
    assert "onSuggestionClick?:" not in bubble, (
        "Prop resa opzionale: il chip puo' di nuovo essere reso senza gestore."
    )


# ── The opening state offers something to press ────────────────────────────


def test_the_opening_state_offers_starters():
    thread = _read(THREAD)
    assert "starterPrompts" in thread, (
        "Spariti gli avvii: il pannello torna a offrire solo un campo di testo "
        "a un operatore che non programma."
    )
    assert "void sendText(prompt)" in thread, (
        "Gli avvii non inviano piu' il proprio testo."
    )


def test_starters_name_the_operators_own_catalogue():
    """Hardcoded nouns go stale against seed_library; live ones cannot."""
    thread = _read(THREAD)
    block = thread[thread.index("const starterPrompts") :]
    block = block[: block.index("}, [dataObjects, dataLocations])")]
    assert "dataObjects[0]?.name" in block and "dataLocations[0]?.name" in block, (
        "Gli avvii non leggono piu' il catalogo vivo: tornano a nominare "
        "entita' scritte a mano, che scadono quando il catalogo cambia."
    )


def test_starters_are_an_empty_state_not_a_permanent_toolbar():
    thread = _read(THREAD)
    assert "listMessages.length <= 1 &&" in thread, (
        "Gli avvii restano visibili a conversazione iniziata, dove lo spazio "
        "vale piu' alla trascrizione."
    )


# ── One welcome, not two ───────────────────────────────────────────────────


def test_the_local_summary_is_not_posted_as_its_own_bubble():
    """It used to be, and the LLM reply then said the same thing a second later."""
    thread = _read(THREAD)
    assert "setListMessages(dynamicWelcome)" not in thread, (
        "Torna il doppio benvenuto: il riassunto locale e la risposta "
        "proattiva dicono la stessa cosa a un secondo di distanza, sullo "
        "stesso blocco e con lo stesso orario."
    )
    assert "requestProactiveHelp(issueTexts, [INITIAL_MESSAGE_1], localSummary)" in thread


def test_the_local_summary_survives_as_the_failure_fallback():
    """Withheld is not discarded — it is free, offline and known to be true."""
    thread = _read(THREAD)
    assert "text: `${localSummary}" in thread, (
        "Se la chiamata proattiva fallisce l'operatore torna a ricevere solo "
        "una scusa, e l'unica informazione gia' calcolata viene buttata."
    )


# ── The text that explains Apply is not cut ────────────────────────────────


def test_the_proposal_answer_has_no_height_cap():
    card = _read(CARD)
    block = card[card.index("{answer && (") :]
    block = _without_comments(block[: block.index("Validation warnings")])
    assert "maxHeight" not in block, (
        "Torna il tetto in pixel sulla risposta: il testo che dice cosa fara' "
        "Apply viene tagliato a meta' frase, dietro una seconda barra di "
        "scorrimento annidata in un pannello da 360px."
    )
    assert "overflowY" not in block


# ── Operator vocabulary ────────────────────────────────────────────────────


def test_the_panel_does_not_talk_about_tokens():
    """A billing concern belongs to whoever runs the server, not the operator."""
    vocab = _read(os.path.join(FRONTEND, "constants", "uiVocabulary.ts"))
    thread = _read(THREAD)
    for name, src in (("ChatThread.tsx", thread), ("uiVocabulary.ts", vocab)):
        auto_check = src[src.index("AutoCheck") if "AutoCheck" in src else 0 :]
        assert "uses tokens" not in auto_check, (
            f"{name} mostra di nuovo il costo in token nell'interfaccia "
            "dell'operatore."
        )


def test_the_header_does_not_restate_its_own_title():
    thread = _read(THREAD)
    assert "Ask for help with your task" not in thread, (
        "Torna il sottotitolo che ripete COPILOT, e con esso una riga di "
        "intestazione in una colonna il cui asse scarso e' l'altezza."
    )
