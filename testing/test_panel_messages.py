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


def test_a_waiting_step_shows_its_instruction_on_every_channel():
    """The message of "Pause and show message" must reach the screen for all
    four resume channels, and this is the assertion that was missing when it
    did not.

    It rendered in exactly one place: the dark overlay that replaces the video.
    Gesture and object steps are deliberately excluded from that overlay — the
    operator has to SEE the camera to aim at it — so for those two channels the
    instruction was rendered NOWHERE. A step reading "show the camera a blue
    tube" ran with the panel saying only "Waiting to find tube".

    That is a measurement problem before it is a usability one.
    seed_partb_tasks.py gives all four Part-B tasks one shared `_TASK_DESC`
    exactly so the on-screen instruction is identical across the conditions —
    "anything else that differed between them would be a second explanation for
    any difference in the measurements". The shared constant made the DATA
    identical while two of the four screens showed no instruction at all.

    So: the description belongs to the pill, gated on the step being active and
    on nothing else. Any channel condition in that gate re-opens the hole.
    """
    src = _strip_comments(_read(PANEL))

    pill = src[src.index("const videoPill"):]
    pill = pill[: pill.index("].find(Boolean)")]

    assert "humanStep?.description" in pill, (
        "l'istruzione del passo umano non raggiunge piu' la pillola sul video: "
        "sui canali gesto e oggetto non verrebbe mostrata da nessuna parte, e "
        "le quattro condizioni della Parte B smetterebbero di mostrare la "
        "stessa frase."
    )

    entry = pill[: pill.index("humanStep?.description")]
    entry = entry[entry.rindex("[") + 1 :] if "[" in entry else entry
    for channel_gate in ("isGestureStep", "isObjectStep", "condition ==="):
        assert channel_gate not in entry, (
            f"l'istruzione e' condizionata al canale ({channel_gate}): deve "
            "comparire su tutti e quattro, altrimenti la differenza fra le "
            "condizioni della Parte B non e' piu' il solo canale."
        )

    assert pill.index("humanStep?.description") < pill.index("notifyPill"), (
        "un 'Show message' da 4 secondi puo' coprire l'istruzione di un passo "
        "che dura tutta l'attesa."
    )


def test_every_perceiving_channel_says_what_it_perceives():
    """REQUIRED next to DETECTED, for gesture AND voice AND object.

    It existed for gesture alone. Without it an operator cannot separate the
    two failures they must act on differently: "the microphone is not hearing
    me" and "the microphone hears me and the word is wrong" look identical, and
    so do "the camera cannot see the tube" and "the camera sees it as something
    else". One means try again, the other means change what you are doing, and
    the step is on a thirty-second clock.

    Part B makes it a measurement problem too. It times the four channels
    against each other; a channel that shows whether it is perceiving you is
    not competing on equal terms with three that do not.

    Button and timer are excluded on purpose: a press is not a perception (the
    button is its own readout) and a timer perceives nothing.
    """
    src = _strip_comments(_read(PANEL))

    readout = src[src.index("const waitReadout"):]
    readout = readout[: readout.index("}, [")]
    for channel in ("'gesture'", "'voice'", "'object'"):
        assert f"case {channel}:" in readout or f"case {channel}: {{" in readout, (
            f"il canale {channel} non produce piu' un readout REQUIRED/DETECTED: "
            "l'operatore non puo' distinguere 'non mi percepisce' da 'mi "
            "percepisce e non va bene'."
        )
    assert "'human_feedback'" not in readout and "'timer'" not in readout, (
        "pulsante o timer hanno un readout percettivo: non percepiscono nulla, "
        "e una riga DETECTED vuota accanto a un pulsante e' rumore."
    )

    # The card must read the shared object, not the gesture-only state it grew
    # out of — that is what made it a gesture card in the first place.
    # Anchored on code, not on a JSX comment: _strip_comments has already
    # removed those, and an anchor that cannot be found raises instead of
    # failing with the message this test wants to give.
    card = src[src.index("{waitReadout && ("):]
    card = card[: card.index("{isHumanStepActive && countdown !== null")]
    assert "{waitReadout.required}" in card and "{waitReadout.detected}" in card, (
        "la scheda non legge piu' waitReadout: e' tornata a essere la scheda "
        "del solo gesto."
    )


def test_the_channel_pill_and_the_ready_check_cannot_contradict():
    """An amber "Offline" in the header above a green "Ready to run" at the
    foot of the same column. Both true, nothing saying so.

    `connected` is the SocketIO event stream on :5001 — block_step, human_step,
    gestures, detections. Not the arm, not the HTTP bridge: a run can start over
    :5000 while this is down, and then the operator watches a still picture with
    no highlighted block, no "waiting for a gesture" and no countdown, which
    looks exactly like a run frozen at step zero.

    Two fixes, and they work together. The pill names the CHANNEL, so it stops
    reading as a verdict on the robot. And the disconnected case joins the
    preflight list, whose empty state IS "Ready to run" — so the reassuring
    line can no longer appear while the panel cannot see the run.
    """
    src = _strip_comments(_read(PANEL))

    assert "'Offline'" not in src, (
        "la pillola torna a dire 'Offline' sotto il titolo 'Robot': si legge "
        "come un verdetto sul braccio, mentre riguarda il canale eventi."
    )
    assert "live updates" in src.lower(), (
        "la pillola non nomina piu' cio' che smette di funzionare quando cade"
    )

    preflight = src[src.index("const preflightIssues"):]
    preflight = preflight[: preflight.index("return (")]
    assert "if (!connected)" in preflight, (
        "la caduta del canale eventi non e' piu' fra le condizioni di "
        "preflight: 'Ready to run' tornerebbe a comparire mentre il pannello "
        "non puo' vedere niente della corsa."
    )


def test_the_run_folds_copilot_away_like_the_other_two():
    """Focus mode collapsed the nav rail and the toolbox and left Copilot open.

    That was right while the robot panel floated over everything — starting a
    run covered whatever was open. Once the panel became a column with room
    reserved for it, an open Copilot stopped being covered and started
    competing: three surfaces dividing the viewport, with the workspace — the
    one showing which block is running — squeezed between them.

    Nothing an operator does with Copilot happens DURING a run: it writes
    blocks into a workspace that is executing. So it folds, and it comes back,
    because the operator did not close it — the run did.
    """
    workspace = _read(
        os.path.join(FRONTEND, "pages", "task-workspace", "index.tsx")
    )
    focus = workspace[workspace.index("const preRunLayoutRef"):]
    focus = focus[: focus.index("}, [isSimulationRunning])")]

    assert "chatOpen," in focus, (
        "lo stato di Copilot non viene piu' salvato prima della corsa: non "
        "puo' essere ripristinato dopo."
    )
    assert focus.count("toggleChat()") >= 2, (
        "Copilot non viene piu' chiuso all'avvio o non viene riaperto alla "
        "fine. Un pannello che non torna insegna a non aprirlo piu'."
    )


def test_the_conditions_list_is_hidden_while_a_step_is_waiting():
    """Three answers to "what is the robot waiting for", one of them wrong.

    The Conditions section lists the recognisers generically — it draws a
    "Gesture" row whether or not the step wants a gesture. During an object
    wait the panel therefore showed "Gesture … None" beside a step that has
    nothing to do with gestures, while STATUS named a third thing.

    While a step waits, waitReadout answers the question exactly, for the
    channel actually in play. The list returns when the step resolves, where it
    does its real job: showing the recognisers are alive between steps.
    """
    src = _strip_comments(_read(PANEL))
    gate = src[src.index("const eventsVisible"):]
    gate = gate[: gate.index("\n\n")]
    assert "!isHumanStepActive" in gate, (
        "l'elenco delle condizioni ricompare durante un'attesa: nominerebbe di "
        "nuovo un canale che quel passo non usa."
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


def test_an_authored_message_outlives_the_step_that_showed_it():
    """"Show message and continue" is the third case of the duration rule, and
    it was filed under the second.

    MESSAGE_TTL_MS is for an event with nothing left to handle. Here the thing
    left to handle is a PERSON READING the text — that is the entire purpose of
    the block, and "and continue" says the program will not wait while they do.
    Four seconds is roughly what it takes to notice a pill appeared, look up
    from a moving arm, and find it gone.

    So it persists, and three things end it: a dismiss, a newer authored
    message, and the run finishing. Not a longer timeout — any number here is a
    guess about how long someone needs to walk to a bench, and guessing wrong
    fails silently, while they are away from the screen.
    """
    src = _strip_comments(_read(PANEL))
    notify = src[src.index("if (humanStep?.status !== 'notify') return"):]
    notify = notify[:notify.index("}, [humanStep])")]
    assert "setTimeout" not in notify, (
        "il messaggio di 'Show message and continue' torna a scadere da solo: "
        "e' testo che una persona deve leggere, e il programma non l'aspetta."
    )

    assert "if (humanStep?.status === 'started') setNotifyPill(null)" in src, (
        "un passo in attesa non scaccia piu' il messaggio precedente: la "
        "priorita' di videoPill lo farebbe riapparire appena l'attesa si "
        "risolve, ormai vecchio."
    )
    assert "if (!simulation.isRunning) setNotifyPill(null)" in src, (
        "il messaggio sopravvive alla propria esecuzione: verrebbe trovato "
        "sopra il video all'apertura del pannello per il compito successivo."
    )


def test_a_message_that_never_expires_can_be_closed():
    """Persistent and undismissable is not persistent, it is stuck — and this
    one sits on the live view, the one thing the operator is watching."""
    src = _strip_comments(_read(PANEL))
    pill = src[src.index("notifyPill && {"):]
    pill = pill[:pill.index("stepCompleted &&")]
    assert "onDismiss" in pill, (
        "il messaggio persistente non ha piu' modo di essere chiuso"
    )
    render = src[src.index("{videoPill && ("):]
    render = render[:render.index("</Box>\n                )}")]
    assert "videoPill.onDismiss &&" in render, (
        "la pillola non disegna piu' la ✕: l'onDismiss esiste nei dati e non "
        "raggiunge lo schermo."
    )
    assert 'aria-label="Dismiss message"' in render, (
        "la ✕ e' senza nome accessibile"
    )
