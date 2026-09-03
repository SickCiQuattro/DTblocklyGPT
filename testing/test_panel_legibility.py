"""Guard on the robot panel's legibility: the video ground, the type scale, disabled states.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_panel_legibility.py -v

Three rules, each written after a measured failure. All three share a shape:
a value that was correct against the surface the author was looking at, and
wrong against the surface it actually rendered on.

1. **An overlay on video supplies its own ground.** Every overlay token was
   calibrated against `panel.bg` (#0c0c1c) and measured beautifully there. The
   frame they composite over is the Gazebo render, and `worldCobotta.sdf`
   declares no `<background>`, so gz-sim falls back to a light sky over a
   0.8-diffuse ground plane. Measured on the real thing: the "Show message"
   pill 1.59:1, "Step completed" 1.22:1, the camera label exactly 1.00:1 —
   the same colour as what was behind it. On a hardware run the feed is a real
   room, which this design controls even less.

2. **`panel.bg` is a swatch the panel never paints.** The panel is
   `panel.surface` at 0.97 over the app's #F5F5F7 page. Every ratio computed
   against `bg` is optimistic by ~5%, which is how `muted` carried a comment
   saying it cleared 4.5:1 while rendering at 4.32:1 in the Events rows.

3. **Fourteen font sizes are not a hierarchy.** Seven of them sat inside a
   9.6–11.5px band; `0.64 → 0.65 → 0.66 → 0.68` is four declared values
   spanning a third of a pixel. Sizes a reader cannot tell apart carry no
   information and cost every future edit a decision with no right answer.

There is no JS test runner here (same constraint as `test_wcag_contrast.py`),
so this parses the TypeScript source and does the colour maths itself.
"""
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_wcag_contrast import contrast_ratio  # noqa: E402

FRONTEND = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
PANEL = os.path.join(FRONTEND, "components", "DigitalTwinPanel.tsx")
TOKENS = os.path.join(FRONTEND, "components", "digitalTwin", "panelTokens.ts")
SEGMENTED = os.path.join(FRONTEND, "components", "SegmentedControl.tsx")

AA_TEXT = 4.5
AA_GRAPHIC = 3.0  # 1.4.11 non-text contrast

# The two extremes an overlay must survive. Not hypotheticals: `objectFit:
# contain` letterboxes the feed in black, and the Gazebo scene is near-white.
VIDEO_BLACK = "#000000"
VIDEO_WHITE = "#FFFFFF"


def _read(path: str) -> str:
    return open(path, encoding="utf-8").read()


def _strip_comments(source: str) -> str:
    """Drop // and /* */ so a rule quoted in prose can't satisfy its own test.

    Concretely: the icon file's header explains why `HandMetal` must NOT be
    used, and the test that forbids `HandMetal` matched that explanation.
    """
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"^\s*//.*$", "", source, flags=re.M)


def _composite(fg: str, alpha: float, bg: str) -> str:
    f, b = fg.lstrip("#"), bg.lstrip("#")
    return "#%02X%02X%02X" % tuple(
        round(int(f[i:i + 2], 16) * alpha + int(b[i:i + 2], 16) * (1 - alpha))
        for i in (0, 2, 4)
    )


def _token(name: str) -> str:
    """A literal hex or rgba token straight out of panelTokens.ts."""
    src = _read(TOKENS)
    match = re.search(rf"\b{name}: '([^']+)'", src)
    assert match, f"token {name} non trovato in panelTokens.ts"
    return match.group(1)


def _rgba_alpha(value: str) -> float:
    match = re.search(r"rgba\([^)]*,\s*([\d.]+)\)", value)
    assert match, f"{value} non e' un rgba()"
    return float(match.group(1))


# ── Rule 1: an overlay on video supplies its own ground ──────────────────────


def test_the_overlay_ground_survives_both_a_white_and_a_black_frame():
    """The number that decides the opacity, checked rather than trusted.

    0.92 is not a taste value: it is where every foreground token clears AA
    against BOTH extremes, and where the two extremes stop differing much —
    which is what "video-independent" means in practice. At 0.88 primaryLight
    falls to 4.80 and the margin is gone.
    """
    for token in ("overlayChip", "overlayScrim"):
        alpha = _rgba_alpha(_token(token))
        assert alpha >= 0.92, (
            f"panel.{token} e' sceso a {alpha}: gli elementi sopra il video "
            f"tornano a dipendere da cosa inquadra la camera."
        )

        on_white = _composite("#0c0c1c", alpha, VIDEO_WHITE)
        on_black = _composite("#0c0c1c", alpha, VIDEO_BLACK)

        for name, fg, threshold in (
            ("text", "#E2E8F0", AA_TEXT),
            ("textDim", "#94A3B8", AA_TEXT),
            ("primaryFaint", "#A5B4FC", AA_TEXT),
            ("successLight", "#86EFAC", AA_TEXT),
            ("primaryLight (icona)", "#818CF8", AA_GRAPHIC),
            ("errorLight", "#F87171", AA_TEXT),
        ):
            for ground, label in ((on_white, "bianco"), (on_black, "nero")):
                ratio = contrast_ratio(fg, ground)
                assert ratio >= threshold, (
                    f"{name} su panel.{token} rende {ratio:.2f}:1 sul fondo "
                    f"{label} ({ground}), sotto {threshold}."
                )


def test_no_element_over_the_video_borrows_the_frame_as_its_background():
    """The rule, applied to the elements that broke it.

    Each of these was a translucent tint of a brand colour, which over a
    near-white Gazebo frame washes out to nothing. The tone moved into the
    border and the icon; the ground became opaque.
    """
    src = _read(PANEL)

    pill = src[src.index("{videoPill && ("):]
    pill = pill[:pill.index("</Box>")]
    assert "background: panel.overlayChip" in pill, (
        "la pillola sul video e' tornata a una tinta translucida: misurava "
        "1.22:1 (successo) e 1.59:1 (messaggio) sul fotogramma di Gazebo, "
        "cioe' il messaggio scritto dall'autore era invisibile."
    )

    # The camera-source label: 50% white on nothing at all. Exactly 1.00:1.
    label = src[src.index("{webcam.activeLabel || 'Webcam'}") - 1400:]
    label = label[:label.index("{webcam.activeLabel || 'Webcam'}")]
    assert "panel.overlayChip" in label, (
        "l'etichetta della sorgente video non ha piu' un fondo proprio: era "
        "bianco al 50% su niente, cioe' 1.00:1 — lo stesso colore di quello "
        "che aveva dietro."
    )

    assert "videoLabel" not in src and "videoLabel" not in _read(TOKENS), (
        "il token videoLabel e' tornato: e' bianco al 50% pensato per un "
        "fotogramma scuro, e non esiste fotogramma garantito scuro."
    )


# ── Rule 2: measure against the surface that is actually painted ────────────


def test_muted_clears_aa_on_the_worst_ground_it_actually_sits_on():
    """`panel.bg` is a swatch this panel never paints.

    The panel is `surface` at 0.97 over the app's #F5F5F7 page — #131323, not
    #0c0c1c. Ratios computed against `bg` run ~5% optimistic, which is how
    #70819A carried a comment claiming it cleared 4.5:1 while rendering at
    4.32:1 on `chromeStrong` in the Events rows and the legend headings.
    """
    page = "#F5F5F7"
    surface = _composite("#0c0c1c", _rgba_alpha(_token("surface")), page)
    chrome_strong = _composite(
        "#FFFFFF", _rgba_alpha(_token("chromeStrong")), surface
    )

    muted = _token("muted")
    assert contrast_ratio(muted, chrome_strong) >= AA_TEXT, (
        f"panel.muted ({muted}) rende "
        f"{contrast_ratio(muted, chrome_strong):.2f}:1 su chromeStrong "
        f"({chrome_strong}), che e' il fondo peggiore su cui viene usato."
    )
    # It has to stay a visible step below textDim, or the token has no reason
    # to exist and the two-step dim ladder collapses.
    assert contrast_ratio(muted, surface) < contrast_ratio("#94A3B8", surface), (
        "panel.muted non e' piu' piu' tenue di textDim: i due gradini della "
        "scala di attenuazione sono collassati in uno."
    )


# ── Rule 3: a type scale you can see ────────────────────────────────────────


def test_the_panel_declares_a_scale_instead_of_fourteen_one_off_sizes():
    src = _read(PANEL)
    literals = re.findall(r"fontSize: '([\d.]+)rem'", src)
    assert not literals, (
        f"dimensioni di testo scritte a mano nel pannello: {sorted(set(literals))}. "
        "Devono passare da panelType, altrimenti si torna a quattordici valori "
        "che il lettore non distingue."
    )

    steps = re.findall(r"^\s+(\w+): '([\d.]+)rem',", _read(TOKENS), re.M)
    scale = {name: float(v) for name, v in steps}
    assert scale, "panelType non e' piu' leggibile da questo test"

    # The floor. The audience is a first-time study participant reading a
    # second language on a laptop next to a moving arm; 9.6px was the size of
    # the label naming the camera feed.
    smallest = min(scale.values())
    assert smallest >= 0.75, (
        f"il gradino piu' piccolo e' {smallest}rem ({smallest * 16:.1f}px), "
        "sotto il pavimento di 12px."
    )

    # Steps far enough apart to be seen. Two sizes 0.32px apart are one size.
    ordered = sorted(scale.values())
    for a, b in zip(ordered, ordered[1:]):
        assert (b - a) * 16 >= 1.0, (
            f"i gradini {a}rem e {b}rem distano {(b - a) * 16:.2f}px: "
            "indistinguibili, quindi non sono due gradini."
        )


def test_the_instruction_and_the_deadline_are_the_largest_things_on_screen():
    """Hierarchy is a claim about what matters, and this panel has two answers.

    What the operator must do, and how long they have. Both used to be below
    the panel's own body text — the countdown was 10.88px, the smallest type in
    the file apart from the camera label.
    """
    tokens = _read(TOKENS)
    scale = {
        n: float(v) for n, v in re.findall(r"^\s+(\w+): '([\d.]+)rem',", tokens, re.M)
    }
    assert scale["lead"] > scale["body"] and scale["display"] > scale["lead"], (
        "la scala non sale piu': lead deve superare body e display deve "
        "superare lead, o i due valori che contano non possono distinguersi."
    )

    src = _read(PANEL)
    overlay = src[src.index("{isHumanStepActive && !isGestureStep"):]
    overlay = overlay[:overlay.index("{videoPill && (")]
    assert "panelType.lead" in overlay, (
        "l'istruzione del passo umano non e' piu' al gradino `lead`: e' la "
        "frase su cui l'operatore deve agire."
    )
    assert "{countdown}s" in overlay, (
        "i secondi rimasti non compaiono piu' accanto all'azione: la scheda "
        "del countdown sta sotto il video, a circa 250px dal pulsante "
        "Confirm, e chi ha trenta secondi non puo' spendere due fissazioni."
    )


# ── Disabled states ─────────────────────────────────────────────────────────


def test_a_locked_segmented_control_looks_locked():
    """The failure was CSS specificity, and it was silent.

    MUI's own `&.Mui-disabled { color: action.disabled }` is a (0,2,0) rule;
    this component writes its colours as descendant selectors at (0,3,0) and
    wins. So the Live-view control, locked for the whole duration of a run,
    was pixel-identical to its enabled state: no cursor change, no hover, no
    response. The operator clicked it repeatedly while an arm was moving.
    """
    src = _read(SEGMENTED)
    assert "'&.Mui-disabled'" in src, (
        "SegmentedControl non ha piu' uno stile disabilitato proprio: quello "
        "di MUI perde per specificita' e il controllo bloccato torna "
        "identico a uno attivo."
    )
    assert "'&.Mui-selected.Mui-disabled'" in src, (
        "manca lo stato disabilitato della pillola SELEZIONATA: e' quella su "
        "cui va l'occhio, e con il riempimento accentato continua a "
        "sembrare disponibile."
    )

    panel_src = _read(PANEL)
    live = panel_src[panel_src.index('aria-label="Live view"') - 900:]
    live = live[:live.index('aria-label="Live view"')]
    assert "<Tooltip" in live and "<span>" in live, (
        "il controllo bloccato non spiega piu' perche'. Serve anche lo "
        "<span>: un figlio disabilitato assorbe gli eventi che il Tooltip "
        "ascolta, quindi senza wrapper la spiegazione non compare mai."
    )


def test_confirm_does_not_reintroduce_the_contrast_bug_the_theme_fixed():
    """`themes/overrides/Button.ts` swaps containedPrimary to primary.dark
    because primary.main renders white text at 4.47:1. An sx `bgcolor:
    panel.primary` on this button put that failure back — on the one control
    an operator has to find under a thirty-second deadline."""
    src = _read(PANEL)
    confirm = src[src.index("ref={confirmButtonRef}"):]
    confirm = confirm[:confirm.index("</Button>")]

    assert "bgcolor: panel.primary," not in confirm, (
        "il Confirm sovrascrive di nuovo bgcolor con primary.main: bianco su "
        "#6366F1 rende 4.47:1 e non passa AA. Il tema usa primary.dark "
        "(6.29:1) proprio per questo."
    )
    assert "minHeight: 48" in confirm, (
        "il Confirm e' tornato piccolo: da size='small' risultava alto 23.6px, "
        "sotto persino il minimo AA di 24px, per l'azione principale del "
        "pannello."
    )
    assert "'&.Mui-disabled'" in confirm, (
        "il Confirm non ha piu' uno stato disabilitato proprio: quello del "
        "tema e' grey[200], pensato per una pagina bianca, e su questo scrim "
        "scuro rendeva una lastra quasi bianca con testo #d9d9d9 a 1.24:1."
    )
    assert "confirmSending ? 'Sending…' : 'Confirm'" in confirm, (
        "il pulsante non dice piu' che sta inviando: su una risposta lenta "
        "si limitava a sbiadire, senza prova che la pressione fosse arrivata."
    )


def test_the_arm_is_announced_while_it_is_moving():
    """Amber means one thing here, and it used to leave the screen exactly
    when that thing became true: every amber cue sat inside the
    `!simulation.isRunning` gate."""
    src = _read(PANEL)
    header = src[:src.index("Scrollable body")]
    assert "'Arm live'" in header, (
        "il segnale 'il braccio fisico si sta muovendo' non e' piu' "
        "nell'intestazione, fuori da ogni gate: tornerebbe a sparire "
        "nell'istante in cui il braccio parte."
    )


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))


# ── Teaching the gesture, and closing the loop ──────────────────────────────


def test_every_recognised_gesture_has_an_icon():
    """A name is not an instruction when the name IS the hand shape.

    "Peace sign" / "OK sign" / "Fist" were bare English words shown to
    first-time participants reading a second language. MediaPipe rejects a
    wrong guess, so a participant who guessed produced a recognition failure
    that the study recorded as a recognition failure — when it was a labelling
    failure. Four gestures map onto icons lucide already ships; the other two
    are drawn in the same construction.
    """
    registry = _read(os.path.join(FRONTEND, "constants", "recognitionRegistry.ts"))
    codes = re.findall(r"code:\s*'([A-Z_]+)'", registry)
    gestures = codes[: codes.index("YES")] if "YES" in codes else codes
    assert gestures, "nessuna gesture trovata nel registro"

    icons = _strip_comments(
        _read(os.path.join(FRONTEND, "constants", "gestureIcons.tsx"))
    )
    mapping = icons[icons.index("GESTURE_ICONS"):]
    for code in gestures:
        assert f"{code}:" in mapping, (
            f"la gesture {code} non ha un'icona: resta una parola inglese "
            f"davanti a chi deve indovinare la forma della mano."
        )

    assert "HandMetal" not in icons, (
        "HandMetal e' le corna: usarla come 'abbastanza simile' al segno di "
        "pace insegnerebbe all'operatore una forma che il riconoscitore "
        "rifiuta — peggio di nessuna icona."
    )


def test_an_object_wait_does_not_cover_the_camera_it_asks_you_to_use():
    """Aiming an object at a lens is a closed loop: you move it and watch.

    The scrim excluded gesture steps only, so a step saying "show the camera a
    blue tube" was answered by blurring the camera's picture. The Objects
    readout that would close the loop lives in EVENTS, below the fold on a
    laptop, which is why this went unnoticed.
    """
    src = _strip_comments(_read(PANEL))
    assert "!isGestureStep && !isObjectStep" in src, (
        "lo scrim copre di nuovo l'attesa oggetto: l'operatore deve mostrare "
        "qualcosa a una camera di cui non vede piu' l'immagine."
    )
    bar = src[src.index("{isObjectStep && ("):]
    bar = bar[:bar.index("{videoPill && (")]
    # The NAMES, not merely a reference to the detections array — an earlier
    # version of this assertion passed while the readout was deleted, because
    # `activeDetections` was still mentioned in an icon's colour expression.
    assert "d.class" in bar, (
        "la barra dell'attesa oggetto non nomina piu' cosa la camera vede: "
        "senza quello l'operatore punta alla cieca fino al timeout."
    )
    assert "panel.overlayChip" in bar, (
        "la barra non ha piu' un fondo proprio sul video."
    )


def test_one_word_per_axis_in_the_execution_vocabulary():
    """Three questions, three vocabularies, no borrowing.

    The mode's label and the button's label were the SAME STRING on a hardware
    run: the operator chose "Run on robot" and then pressed "Run on robot",
    with nothing distinguishing a setting from an action.
    """
    vocab = _read(os.path.join(FRONTEND, "constants", "uiVocabulary.ts"))
    for key in ("targetSimulation", "targetRobot", "liveViewRobot"):
        assert f"{key}:" in vocab, f"manca {key} da UI_TEXT"

    src = _strip_comments(_read(PANEL))
    mode = src[src.index('aria-label="Mode"'):]
    mode = mode[:mode.index("]}")]
    assert "UI_TEXT.runOnRobot" not in mode and "UI_TEXT.simulate," not in mode, (
        "il controllo del modo usa di nuovo le etichette dei pulsanti: "
        "impostazione e azione tornano a chiamarsi allo stesso modo."
    )
    assert "'Task Execution'" not in src, (
        "la scheda si chiama di nuovo 'Task Execution': e' il terzo nome per "
        "la stessa cosa, accanto al modo e al pulsante."
    )


def test_nothing_over_the_video_uses_a_backdrop_filter():
    """The corner leak, and why the blur was never worth it.

    Chromium paints an element's blurred backdrop clipped to its SQUARE border
    box, not to its border-radius. Inside the video's 10px rounded frame that
    showed a bright blurred crescent in each corner — the white slivers, in a
    panel whose whole point is that nothing over the video may depend on what
    the camera is pointing at.

    And it bought nothing. Once the overlays became opaque (0.92), only 8% of
    the backdrop comes through, so the blur was decoration paying for a
    compositor layer and a rendering bug. The panel's own root keeps its glass
    — that one sits over the page, not over video, and is the effect it looks
    like.
    """
    src = _strip_comments(_read(PANEL))
    video = src[src.index("aspectRatio: '4/3'"):src.index("<SectionLabel>Run</SectionLabel>")]
    assert "backdropFilter" not in video, (
        "un elemento sopra il video usa di nuovo backdrop-filter: Chromium "
        "non ritaglia lo sfondo sfocato al border-radius, e negli angoli "
        "ricompare il fotogramma."
    )


def test_a_full_cover_overlay_uses_the_inner_radius_not_the_outer_one():
    """Geometry, not taste: the padding box of a bordered rounded rect has a
    corner radius of (outer − border width).

    `inset: 0` puts an overlay on the PADDING box, so `borderRadius: 'inherit'`
    handed it the outer 10px inside a 9px curve — over-rounded corners with a
    sliver of frame showing through. Sub-pixel on its own, and invisible next
    to the backdrop-filter leak, but wrong, and the kind of wrong that becomes
    visible the moment someone raises the border to 2px.
    """
    src = _strip_comments(_read(PANEL))
    assert "VIDEO_INNER_RADIUS = `${VIDEO_RADIUS_PX - VIDEO_BORDER_PX}px`" in src, (
        "il raggio interno non e' piu' derivato dal raggio esterno meno il "
        "bordo: due numeri che devono restare d'accordo tornano indipendenti."
    )
    video = src[src.index("aspectRatio: '4/3'"):src.index("<SectionLabel>Run</SectionLabel>")]
    assert "borderRadius: 'inherit'" not in video, (
        "un overlay usa di nuovo 'inherit': eredita il raggio ESTERNO mentre "
        "occupa il riquadro interno, quindi si arrotonda piu' del contenitore."
    )
    assert video.count("borderRadius: VIDEO_INNER_RADIUS") >= 3, (
        "non tutti gli overlay a copertura totale usano il raggio interno."
    )


def test_a_hand_only_ever_means_a_hand_shape():
    """`Hand` acquired a second job and quietly became a wrong instruction.

    It was the decorative mark on the human-step overlay long before it was
    anything else. Then it became the icon for the OPEN_HAND gesture — at which
    point a step asking the operator to press a button showed them an open
    palm, which in this panel's own vocabulary now says "make this hand shape".
    The wrong instruction, at the one moment the operator is on a deadline.

    Same collision twice more, both introduced by the same change: the Events
    row labelled "Gesture" and the sandbox chip that names a DETECTED gesture
    both drew a static open palm, so "PEACE" arrived wearing another gesture's
    icon in the surface built to teach the vocabulary.

    The rule this leaves: a hand icon in this panel is either the gesture
    actually in play, or the neutral fallback when there is none.
    """
    src = _strip_comments(_read(PANEL))

    # Just the WaitIcon statement: the declarations after it legitimately
    # mention `Hand` as the no-gesture-detected fallback.
    overlay = src[src.index("const WaitIcon ="):]
    overlay = overlay[: overlay.index("\n  const ", 1)]
    assert "Hand" not in overlay, (
        "l'attesa di un passo umano torna a mostrare una mano: nel vocabolario "
        "di questo pannello significa 'fai il gesto Open hand', mentre il "
        "passo chiede un pulsante, una voce o un'attesa."
    )
    for channel, icon in (("voice", "Mic"), ("timer", "Clock")):
        assert icon in overlay, (
            f"il canale {channel} non usa piu' {icon}, che e' il segno che "
            f"questo pannello e l'anteprima della chat usano gia'."
        )

    # Both places that name a gesture must draw THAT gesture.
    for anchor, what in (
        ("gestureIcon(activeGesture)", "la riga Events"),
        ("gestureIcon(webcam.gesture)", "il chip della sandbox"),
    ):
        assert anchor in src, (
            f"{what} non mostra piu' l'icona della gesture rilevata: torna a "
            f"un palmo fisso accanto al nome di un'altra gesture."
        )


def test_following_the_running_step_is_opt_in_and_only_when_off_screen():
    """Reintroduced as a setting, not as behaviour.

    An always-on version existed and was removed because it recentred the
    canvas on every step — including the ones already in front of the operator
    — and fought anyone trying to pan. Two things make it acceptable now: it is
    off by default, and it only acts when the block has actually left the
    viewport.
    """
    settings = _read(
        os.path.join(FRONTEND, "features", "blockly", "utils", "useViewSettings.ts")
    )
    assert "followRunningBlock: false," in settings, (
        "'segui lo step in esecuzione' non e' piu' disattivato di default: "
        "torna a essere un comportamento imposto invece di una scelta."
    )

    helper = _strip_comments(
        _read(os.path.join(FRONTEND, "features", "blockly", "utils",
                           "blockHighlight.ts"))
    )
    body = helper[helper.index("export function scrollRunningBlockIntoView"):]
    assert "fullyVisible" in body and "if (fullyVisible) return" in body, (
        "lo scorrimento non controlla piu' se il blocco sia gia' visibile: "
        "ricentrerebbe la tela a ogni passo, che e' la ragione per cui questa "
        "funzione era stata rimossa la prima volta."
    )


# ── One name per concept ────────────────────────────────────────────────────


def test_the_panel_calls_conditions_what_the_toolbox_calls_conditions():
    """The toolbox category was renamed Events → Conditions and the panel was
    not, so an operator who read "Gesture events auto-completed" and went
    looking for "Events" in the blocks found no such category."""
    panel = _strip_comments(_read(PANEL))
    registry = _read(
        os.path.join(FRONTEND, "features", "blockly", "toolbox", "toolboxRegistry.ts")
    )
    assert "name: 'Conditions'" in registry, (
        "la categoria della toolbox non si chiama piu' 'Conditions': se e' "
        "stata rinominata, questo test va aggiornato insieme al pannello."
    )
    assert "<SectionLabel>Events</SectionLabel>" not in panel, (
        "il pannello chiama di nuovo 'Events' cio' che i blocchi chiamano "
        "'Conditions'."
    )
    assert "events auto-completed" not in panel, (
        "i messaggi di auto-completamento parlano di nuovo di 'events'."
    )


def test_the_panel_uses_one_ellipsis_character():
    """`Waiting for operator...` sat next to `Checking the robot connection…`
    — and the same wait had two different wordings as well."""
    panel = _strip_comments(_read(PANEL))
    strays = re.findall(r"'[^']{4,60}\.\.\.'", panel)
    assert not strays, (
        f"puntini scritti come tre punti invece del carattere ellissi: {strays}"
    )


def test_a_dropped_condition_completes_the_sentence_that_hosts_it():
    """Conditions are mounted inside `Stop when %1` and `Resume when: %1`.
    Four of them, four different grammars: "Stop when Voice command" did not
    read as a condition at all. They now finish the sentence they are dropped
    into, and each keeps the keyword its toolbox pill uses so the two are still
    recognisably the same block.
    """
    defs = _read(os.path.join(FRONTEND, "features", "blockly", "blocks",
                              "definitions.ts"))
    for keyword, phrase in (
        ("object", "an object is detected"),
        ("gesture", "a gesture is detected"),
        ("voice command", "a voice command is heard"),
        ("Confirm button", "the Confirm button is pressed"),
    ):
        assert phrase in defs, (
            f"la condizione '{keyword}' non completa piu' la frase che la "
            f"ospita: attesa '{phrase}'."
        )


def test_every_pill_in_the_toolbox_has_a_description():
    """The Library pills — Objects, Locations, Skills — had no tooltip, and
    they are the first three a newcomer opens looking for what goes inside a
    'Pick up'."""
    registry = _read(os.path.join(FRONTEND, "features", "blockly", "toolbox",
                                  "toolboxRegistry.ts"))
    described = _read(os.path.join(FRONTEND, "features", "blockly", "blocks",
                                   "blockTextDictionary.ts"))
    shown = re.findall(r"^\s*type: '(\w+_block)'", registry, re.M)
    # Anchored at the start of a line: a bare `f"{t}:" in described` is
    # satisfied by ANY key ending in the same suffix — `find_object_block:`
    # contains `object_block:`, so the check passed while three pills had no
    # description at all.
    have = set(re.findall(r"^\s*(\w+_block):", described, re.M))
    missing = [t for t in shown if t not in have]
    assert not missing, f"pillole senza descrizione: {missing}"


def test_the_saved_task_block_names_the_concept():
    defs = _read(os.path.join(FRONTEND, "features", "blockly", "blocks",
                              "definitions.ts"))
    assert "'%1 Saved task: %2'" in defs, (
        "il blocco macro torna a dire solo 'Do:', che non nomina niente — "
        "l'operatore non ha modo di sapere che quello step esegue un altro "
        "programma intero."
    )


def test_the_repeat_pill_matches_the_block_it_produces():
    registry = _read(os.path.join(FRONTEND, "features", "blockly", "toolbox",
                                  "toolboxRegistry.ts"))
    defs = _read(os.path.join(FRONTEND, "features", "blockly", "blocks",
                              "definitions.ts"))
    assert "label: 'Repeat until'" not in registry, (
        "la pillola promette di nuovo 'Repeat until' mentre il blocco legge "
        "'Repeat / Do / Stop when': parole che il blocco non contiene."
    )
    block = defs[defs.index("type: 'repeat_until_block'"):]
    block = block[:block.index("message1:")]
    assert "message0: '%1 Repeat'" in block, (
        "il blocco repeat-until non legge piu' 'Repeat': pillola e blocco "
        "vanno tenuti d'accordo in entrambe le direzioni."
    )
