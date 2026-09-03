"""Guard on the robot panel's message system.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_panel_messages.py -v

The panel had grown sixteen distinct message surfaces, each added on its own and
correct on its own. What broke was the system between them:

  * the two halves of ONE button press landed in two different parts of the
    screen — a successful Stop was a global toast, a failed Stop an in-panel
    banner. The operator who just pressed Stop is looking at one place;
  * amber meant "the physical arm is involved" (the Run button, the live
    hardware notice, the confirm dialog) AND "timeout" AND "pre-flight problem",
    so the one meaning worth reserving was diluted by two that had nothing to do
    with the arm;
  * four lifetimes — 2 s, 4 s, 5 s and forever — picked per call site;
  * the priority between banners was a hand-maintained chain of `&& !other`
    guards that had to be edited in four places to add a fifth message.

`PanelMessage.tsx` fixes the shape; these tests fix the *rules*, because rules
are what a later well-meaning edit breaks. There is no JS test runner in this
project (same constraint as `test_wcag_contrast.py` and
`test_block_delete_paths.py`), so this parses the TypeScript source.
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_wcag_contrast import contrast_ratio  # noqa: E402

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
PANEL = os.path.join(FRONTEND, "components", "DigitalTwinPanel.tsx")
MESSAGE = os.path.join(FRONTEND, "components", "digitalTwin", "PanelMessage.tsx")


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _strip_comments(source: str) -> str:
    """Drop // and /* */ so a rule quoted in prose can't satisfy its own test."""
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


# ── The colour rule ──────────────────────────────────────────────────────────


def test_amber_is_structurally_unavailable_to_a_runtime_banner():
    """The rule that has to be mechanical, because prose did not hold it.

    Amber is the panel's one reserved colour: the physical arm is involved.
    Nothing else may borrow it — an operator who has learned that the amber Run
    button means "this moves the real robot" must not meet the same amber on a
    gesture that simply was not detected.

    A comment asking for this is what existed before, and the timeout banner
    was amber anyway. `RuntimeTone` removes the option from the type, so tsc
    refuses it and no reviewer has to notice.
    """
    src = _strip_comments(_read(MESSAGE))
    assert re.search(
        r"export type RuntimeTone\s*=\s*Exclude<MessageTone,\s*'hardware'>", src
    ), (
        "RuntimeTone non esclude piu' 'hardware': un banner di runtime puo' "
        "tornare a prendersi l'ambra, che in questo pannello significa una "
        "cosa sola — il braccio fisico e' coinvolto."
    )

    panel_src = _strip_comments(_read(PANEL))
    assert "tone: RuntimeTone" in panel_src, (
        "lo slot esito non e' piu' tipizzato RuntimeTone: il divieto "
        "dell'ambra smette di essere verificato dal compilatore."
    )


def test_the_timeout_is_not_amber():
    """The concrete case the rule was written for.

    A timeout states what did not happen. It does not claim the arm is doing
    anything, and whether the run even stops depends on where the condition was
    used — the abort banner is the authoritative signal for that, and it
    outranks the timeout in the same priority list.
    """
    src = _strip_comments(_read(PANEL))
    timeout = src[src.index("isTimeout && {"):]
    timeout = timeout[:timeout.index("runResult && {")]
    assert "'info'" in timeout and "warning" not in timeout, (
        "il banner di timeout e' tornato ambra: ruba il colore riservato al "
        "braccio fisico per uno stato che non riguarda il braccio."
    )


def test_only_the_hardware_preflight_issue_keeps_amber():
    """Same rule, applied where it costs something.

    Four pre-flight issues, one of which is genuinely about the arm ("Robot not
    connected"). The other three — a draft task, auto-answered human steps, an
    unsupported browser — were amber too, sitting directly beneath the amber
    hardware notice and meaning something else. They read as blockers from
    their position under a disabled Run button and from carrying a fix, not
    from the colour.
    """
    src = _strip_comments(_read(PANEL))
    start = src.index("const preflightIssues")
    block = src[start:src.index("return (", start)]
    hardware_tones = re.findall(r"tone:\s*'hardware'", block)
    assert len(hardware_tones) == 1, (
        f"{len(hardware_tones)} problemi di pre-volo in ambra invece di 1. "
        "L'ambra spetta solo a quello sul braccio (robot non connesso)."
    )
    connection = block[block.index("!hardwareArmed"):]
    connection = connection[:connection.index("})")]
    assert "'hardware'" in connection, (
        "il problema 'robot non connesso' ha perso l'ambra: e' l'unico "
        "pre-volo che riguarda davvero il braccio."
    )


def test_every_tone_colour_clears_aa_on_the_panel_background():
    """The tones are centralised now, so one bad value would hit ten places."""
    background = "#0c0c1c"  # panel.bg
    tones = {
        "danger": "#EF4444",       # panel.error      (error.main)
        "info": "#A5B4FC",         # panel.primaryFaint
        "success": "#86EFAC",      # panel.successLight
        "hardware": "#FBBF24",     # panel.warningLight (warning.light)
        "dense body": "#94A3B8",   # panel.textDim
    }
    for name, hex_colour in tones.items():
        ratio = contrast_ratio(hex_colour, background)
        assert ratio >= 4.5, (
            f"il tono {name} ({hex_colour}) rende {ratio:.2f}:1 sul fondo del "
            f"pannello, sotto AA."
        )


# ── The duration rule ────────────────────────────────────────────────────────


def test_one_transient_lifetime_not_four():
    """2 s, 4 s and 5 s were three answers to one question.

    The rule: a message describing a STATE lasts as long as the state; one
    reporting an EVENT with nothing left to handle lasts MESSAGE_TTL_MS; one
    reporting an event with an OPEN CONSEQUENCE waits to be dismissed.
    """
    src = _strip_comments(_read(PANEL))
    stray = re.findall(r"setTimeout\([^,]+,\s*(\d{4,})\)", src)
    assert not stray, (
        f"scadenze a numero fisso ancora presenti: {stray}. Ogni messaggio "
        "transitorio deve usare MESSAGE_TTL_MS, altrimenti le durate tornano "
        "a divergere per punto di chiamata."
    )
    assert src.count("MESSAGE_TTL_MS") >= 3, (
        "meno di tre messaggi usano la durata condivisa: qualcuno e' tornato "
        "a un valore proprio."
    )


def test_a_run_result_with_an_open_consequence_is_not_auto_dismissed():
    """"The arm is still holding whatever was in the gripper" must not vanish.

    It is the one run result that describes the physical world after the run:
    a halt stops motion, it does not open the gripper. Four seconds is right
    for "Simulation stopped." and wrong for this.
    """
    src = _strip_comments(_read(PANEL))
    stop = src[src.index("const stopSimulation"):]
    stop = stop[:stop.index(".catch(")]
    assert "sticky: true" in stop and "still holding" in stop, (
        "l'esito dell'arresto hardware non e' piu' persistente: sparirebbe "
        "dopo quattro secondi, ed e' l'unico messaggio che descrive cosa il "
        "braccio sta ancora facendo."
    )

    expiry = src[src.index("if (!runResult || runResult.sticky) return"):]
    assert "MESSAGE_TTL_MS" in expiry[:200], (
        "la scadenza degli esiti non rispetta piu' il flag sticky."
    )


# ── One place per event class ────────────────────────────────────────────────


def test_both_halves_of_stop_land_in_the_same_place():
    """Success was a global toast, failure an in-panel banner.

    One button press, two surfaces, and the operator watching the panel saw
    only one of them. Whether the halt was acknowledged is the whole question
    on a hardware run, so both answers belong where the question was asked.
    """
    src = _strip_comments(_read(PANEL))
    assert "toast" not in src, (
        "il pannello usa di nuovo un toast globale: l'esito di Stop "
        "tornerebbe fuori dal pannello, mentre il fallimento resta dentro."
    )
    stop = src[src.index("const stopSimulation"):src.index("const stopSimulation") + 3000]
    assert "setRunResult(" in stop and "setErrorBanner(" in stop, (
        "successo e fallimento di Stop non finiscono piu' entrambi nelle "
        "regioni di messaggio del pannello."
    )


def test_the_authored_message_is_shown_over_the_live_view():
    """"Show message" and "Pause and show message" write the same block field.

    `fields.TASK_DESC`, same category, same authorial act — and they used to
    arrive in two different places: one a banner at the top of a scrollable
    body, the other an overlay on the video. The blocking one keeps its scrim;
    the non-blocking one gets a pill in the same place, because the operator's
    eye is on the video during a run and a flex-child banner both scrolls away
    and shoves the video down when it mounts.
    """
    src = _strip_comments(_read(PANEL))

    outcome = src[src.index("const outcomeBanner"):src.index("].find(Boolean)")]
    assert "notify" not in outcome.lower(), (
        "il messaggio di 'Show message' e' tornato nella regione esito, cioe' "
        "una striscia in cima al corpo scorrevole: comparirebbe di nuovo "
        "lontano dal video e potrebbe restare fuori vista."
    )

    pill = src[src.index("const videoPill"):]
    pill = pill[:pill.index("].find(Boolean)")]
    assert "notifyPill" in pill, (
        "la pillola sul video non mostra piu' il messaggio scritto "
        "dall'autore: 'Show message' resterebbe senza alcuna superficie."
    )
    assert pill.index("notifyPill") < pill.index("stepCompleted"), (
        "il lampo automatico 'Step completed' precede il messaggio scritto "
        "dall'autore: se arrivano ravvicinati vince quello che conta meno."
    )


def test_the_outcome_region_cannot_be_scrolled_out_of_view():
    """A banner that deletes itself is only useful if it was on screen.

    It was a plain flex child at the top of an `overflowY: auto` body: no
    sticky, no scroll-into-view. An operator scrolled down to STATUS or the
    Events readouts never saw it.
    """
    src = _read(PANEL)
    region = src[src.index("{outcomeBanner && ("):]
    region = region[:region.index("</Box>")]
    assert "position: 'sticky'" in region, (
        "la regione esito non e' piu' sticky: torna a poter uscire dalla "
        "vista mentre l'operatore guarda un'altra parte del pannello."
    )


def test_banner_priority_is_declared_once():
    """The chain of `&& !otherBanner` guards is what this replaces.

    Four blocks each carrying a copy of the priority order. Adding a fifth
    message meant editing four places, and forgetting one let two banners
    stack.
    """
    src = _strip_comments(_read(PANEL))
    order = src[src.index("const outcomeBanner"):src.index("].find(Boolean)")]
    for earlier, later in (("error", "timeout"), ("timeout", "result")):
        assert order.index(f"key: '{earlier}'") < order.index(f"key: '{later}'"), (
            f"'{earlier}' non precede piu' '{later}' nella lista di priorita'."
        )
    assert "!errorBanner" not in src and "!isTimeout" not in src, (
        "sono tornate le guardie incrociate fra banner: la priorita' deve "
        "vivere solo nell'ordine della lista."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
