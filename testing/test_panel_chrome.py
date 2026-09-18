"""The robot panel's chrome: one left edge, one indicator shape, one identity.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_panel_chrome.py -v

Reported as "the panel is not centred, there is much more space on the right",
and it was measurably true. The panel's body is its only scroll region and it
had no scrollbar styling at all, so it took the platform's — about 15px wide,
and taken out of the CONTENT box. The header and the run footer are not scroll
containers and lose nothing. So every heading, card and the video sat 16px from
the left edge and ~31px from the right, under a Run button spanning the full
16/16. Nothing in the source said "right", which is why reading the values did
not find it and looking at the panel did.

Two smaller versions of the same thing came out with it: the header was padded
18px against the body's 16, and every toggle row ended seven pixels short of
the right edge because a MUI Switch carries transparent padding around its
track.

Separately, and not about geometry: the panel's title wore a Camera icon — the
same glyph used below it as the video's own empty-state mark — and its
connection indicator was a bordered pill in the bad state and bare text in the
good one, so a two-state control was built out of two different components and
the title shifted sideways whenever the stream dropped.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
COMPONENTS = os.path.join(ROOT, "frontend", "src", "components")
FRONTEND_SRC = os.path.join(ROOT, "frontend", "src")
GLOBAL_CSS = os.path.join(ROOT, "frontend", "public", "global.css")
PANEL = os.path.join(COMPONENTS, "DigitalTwinPanel.tsx")
SEGMENTED = os.path.join(COMPONENTS, "SegmentedControl.tsx")


def _read(path=None):
    with open(path or PANEL, encoding="utf-8") as f:
        return f.read()


def _code(path=None):
    """Without comments — they quote what was replaced, to record why."""
    src = re.sub(r"/\*.*?\*/", "", _read(path), flags=re.DOTALL)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", src)


def _padding_before(src, marker):
    """The last `padding: '...'` declared before `marker`.

    Each of the three boxes below is identified by something only it has, and
    its padding is the nearest one above that landmark.
    """
    end = src.index(marker)
    return re.findall(r"padding: '([^']+)'", src[:end])[-1]


def _horizontal(shorthand):
    """(left, right) of a CSS padding shorthand, in px."""
    parts = [int(p.rstrip("px")) for p in shorthand.split()]
    if len(parts) == 2:
        return parts[1], parts[1]
    if len(parts) == 3:
        return parts[1], parts[1]
    return parts[3], parts[1]


def test_the_panel_has_one_left_edge():
    src = _code()
    header = _horizontal(_padding_before(src, 'id="digital-twin-title"'))
    body = _horizontal(_padding_before(src, "overflowY: 'auto'"))
    footer = _horizontal(_padding_before(src, "borderTop: `1px solid"))
    assert header[0] == body[0] == footer[0], (
        "intestazione, corpo e piede del pannello non partono piu' dallo "
        f"stesso bordo sinistro: {header[0]} / {body[0]} / {footer[0]}px."
    )


def test_the_scrollbar_is_paid_for_out_of_the_padding():
    """The arithmetic, not the literal: whatever the numbers become, the
    content's right inset has to end up equal to its left one.

    The scrollbar is styled to a known width and its gutter reserved, so the
    right padding can be that much smaller and the two sides meet. Without the
    reservation the content would also jump sideways the moment the panel got
    long enough to scroll.
    """
    src = _code()
    body = _padding_before(src, "overflowY: 'auto'")
    left, right = _horizontal(body)
    bar = re.search(
        r"'&::-webkit-scrollbar': \{ width: '(\d+)px' \}", src
    )
    assert bar, (
        "il corpo del pannello torna alla barra di scorrimento di sistema: "
        "~15px presi dalla larghezza del contenuto, su un solo lato, mentre "
        "intestazione e piede non ne perdono nessuno. E' il difetto per cui "
        "il pannello sembrava non centrato."
    )
    assert "scrollbarGutter: 'stable'" in src, (
        "lo spazio della barra non e' piu' riservato: il contenuto scivola di "
        "lato non appena il pannello diventa abbastanza lungo da scorrere."
    )
    assert right + int(bar.group(1)) == left, (
        f"i due lati non tornano piu': {left}px a sinistra, {right}px di "
        f"padding + {bar.group(1)}px di barra a destra."
    )


def test_every_toggle_row_ends_where_the_cards_end():
    src = _code()
    switches = src.count("<Switch")
    assert switches, "spariti gli interruttori del pannello"
    assert src.count('edge="end"') == switches, (
        "un interruttore ha perso edge=\"end\": la MUI Switch ha 7px di "
        "padding trasparente attorno al track, quindi la sua riga finisce "
        "sette pixel prima del bordo che tutte le schede accanto raggiungono."
    )


def test_the_title_is_the_robot_not_a_camera():
    src = _code()
    title = src.index('id="digital-twin-title"')
    icon = src.rindex("size={16}", 0, title)
    assert "Bot" in src[icon - 40 : icon], (
        "il titolo del pannello torna all'icona della fotocamera: e' lo stesso "
        "glifo usato piu' sotto come segnaposto del video, quindi un simbolo "
        "solo per due cose diverse sulla stessa schermata, e quella piu' "
        "specifica finisce sul titolo."
    )


# ── The event-stream indicator left the header ──────────────────────────────
#
# Three guards used to live here, all describing one header pill that reported
# the SocketIO stream: keep one shape across both states (or the title beside it
# shifts every time the stream drops), build both halves the same way, and never
# wear amber (amber means "the physical arm is involved", and the pill sat right
# next to the chip that earns it).
#
# The pill was removed on 2026-09-10, so those three now describe nothing. It
# said the same thing in three places at once — this pill, the "· events
# offline" annotation on the STATUS card, and the pre-flight row in the footer —
# and it occupied the header width the execution target needed, having become
# the one control users reported they could not find. The pre-flight copy is the
# one that survives on merit: it is outside the scroll region, so it is always
# visible, and it names what BREAKS rather than naming a transport.
#
# What replaces them is the property, not the element: the fact must still reach
# the operator without scrolling, and must still not wear the arm's colour.


def test_the_event_stream_is_reported_without_scrolling():
    """It moved out of the header; it must not have moved out of sight."""
    src = _code()
    # The header is everything before the scroll container. Bounded by the
    # scroll declaration rather than by a comment, because _code() strips
    # comments and a landmark that vanishes makes this test pass on anything.
    header = src[: src.index("overflowY: 'auto'")]
    assert "'No live updates'" not in header, (
        "l'indicatore del canale eventi e' tornato nell'intestazione: e' la "
        "terza copia dello stesso fatto, nello spazio piu' scarso del "
        "pannello, e sposta il titolo ogni volta che lo stream cade."
    )
    text = "No live updates — the run would start"
    assert text in src, (
        "il fatto 'il canale eventi e' giu'' non viene piu' riportato da "
        "nessuna parte: era in tre posti, ne e' rimasto zero."
    )
    # The pre-flight list renders inside the footer, which is a sibling of the
    # scroll container with flexShrink: 0 — so it is visible whatever the
    # operator has scrolled to. That placement is the whole guarantee.
    footer_at = src.index("borderTop: `1px solid")
    scroll_at = src.index("overflowY: 'auto'")
    assert scroll_at < footer_at, (
        "il piede del pannello non e' piu' dopo la regione che scorre: la "
        "lista di pre-volo tornerebbe a poter finire sotto la piega."
    )


def test_the_event_stream_does_not_wear_the_arm_s_colour():
    """Amber means one thing in this panel: the physical arm is involved.

    The pre-flight row that now carries this fact is pushed with no `tone`,
    which PanelMessage renders as info. A `hardware` tone here would put the
    arm's colour on a websocket.
    """
    src = _code()
    # Bounded to the push itself. A wider window reaches the PreflightIssue
    # interface, whose `tone?: 'hardware'` would match and make this pass for
    # the wrong reason.
    at = src.index("No live updates — the run would start")
    push = src[src.rindex("preflightIssues.push({", 0, at):]
    push = push[: push.index("})") + 2]
    assert "hardware" not in push and "warning" not in push, (
        "la riga sul canale eventi torna in ambra: e' il colore che questo "
        "pannello riserva al braccio fisico."
    )


def test_the_sandbox_does_not_claim_the_wrong_camera():
    """The Test recognition tab runs on the webcam, and says so twice — the
    object-detection caption promises real runs use the robot camera only. The
    legend under it used to end "The robot's camera looks for objects here."

    _code(), not _read(): the comment recording the removal quotes the sentence
    verbatim, so the raw source contains it in a fixed file."""
    src = _code()
    assert "The robot's camera looks for objects here" not in src, (
        "la legenda della scheda Test recognition torna a nominare la "
        "telecamera del robot in un pannello che gira sulla webcam, una "
        "schermata sotto la didascalia che dice l'opposto."
    )


# ── Simulation vs Real robot ────────────────────────────────────────────────


def test_the_mode_selector_can_actually_wear_its_target_colour():
    """`activeColor` was a dead prop, and dead in a way nothing could catch.

    SegmentedControl writes its selected style as a descendant selector —
    `.css-group .MuiToggleButtonGroup-grouped.Mui-selected`, (0,3,0) — while
    the per-option override compiled to `.css-button.Mui-selected`, (0,2,0).
    The specificities differ, so the group won every time and both Mode pills
    rendered indigo: never green for Simulation, never amber for Real robot.

    That is not cosmetic here. The robot panel's Run button justifies its own
    amber by citing "the Mode selector's Run on robot pill" as carrying the
    same meaning — a pill that had never been amber. The file already documents
    this exact trap ten lines up, for Mui-disabled.
    """
    src = _code(SEGMENTED)
    # From the per-option ternary onward. The GROUP's own `'&.Mui-selected'`
    # sits earlier in the file and is the rule being beaten, not the one under
    # test — matching it instead reports a broken file as fixed.
    src = src[src.index("opt.activeColor") :]
    override = re.search(r"'(&+)\.Mui-selected([^']*)':", src)
    assert override, "sparito l'override per-opzione di activeColor"
    amps, tail = override.group(1), override.group(2)
    assert len(amps) >= 3, (
        f"l'override di activeColor torna a '{amps}.Mui-selected': la regola "
        "del gruppo e' un selettore discendente a (0,3,0) e vince sempre, "
        "quindi le pillole Simulation/Real robot tornano entrambe indaco e la "
        "regola di colore che il pannello dichiara resta applicata in due "
        "punti su tre."
    )
    assert ":not(.Mui-disabled)" in tail, (
        "l'override non esclude piu' lo stato disabilitato. La regola "
        "'&.Mui-selected.Mui-disabled' del gruppo e' anch'essa (0,4,0): a pari "
        "specificita' decide l'ordine di inserimento di Emotion, e perdere "
        "quel lancio di moneta rimette la pillola bloccata con il suo "
        "riempimento acceso — il bug che quel blocco esiste per impedire."
    )


def test_a_preflight_notice_keeps_its_icon_on_the_first_line():
    """`center` + `wrap` put the icon, as first flex item, on a line of its own
    above the text as soon as the sentence wrapped — which every one of these
    sentences does in a 360px panel. Three notices rendered as a floating
    symbol over a centred paragraph, directly under a disabled Run."""
    src = _code()
    start = src.index("preflightIssues.map")
    row = src[start : start + 400]
    assert "flexWrap: 'wrap'" not in row, (
        "le note di pre-volo tornano ad andare a capo: l'icona finisce su una "
        "riga tutta sua sopra il testo."
    )
    assert "alignItems: 'flex-start'" in row, (
        "l'icona torna centrata verticalmente su un paragrafo di piu' righe"
    )


def test_the_hardware_notice_says_one_thing():
    """It carried a second sentence about gestures and voice that the
    camera/microphone notice below already says — and says only on a task that
    uses them, naming which permission Run will ask for. Here it was
    unconditional, and it is what the scroll fold cut in half."""
    src = _code()
    assert "Live hardware — the real robot will move." in src, (
        "sparito l'avviso hardware"
    )
    banner = src[src.index("Live hardware") :][:220]
    assert "Gestures and" not in banner, (
        "l'avviso hardware torna a due frasi: la seconda e' quella della nota "
        "camera/microfono, che pero' compare solo quando il compito usa "
        "davvero gesti o voce."
    )


def test_what_blocks_the_run_comes_before_what_to_do_during_it():
    """Two tenses, and they were interleaved: the pre-flight list says what
    stops the run now and explains the disabled button above it; the e-stop
    line says what to do once the arm moves. Amber, blue, amber."""
    src = _code()
    footer = src[src.index("preflightIssues.length > 0") :]
    estop = footer.index("teach-pendant e-stop")
    ready = footer.index("Ready to run")
    assert estop > ready, (
        "la riga dell'e-stop torna sopra le note di pre-volo: l'operatore "
        "ordina a mano tre messaggi per trovare quello che lo sta bloccando."
    )


def test_the_stream_notice_does_not_name_one_target():
    src = _code()
    assert "No live updates from the simulator" not in src, (
        "la nota sul canale eventi torna a dire 'from the simulator': vale "
        "identica sui due target, ma chi ha appena scelto 'Real robot' la "
        "legge come riferita all'altro modo e la salta."
    )


# ── The wait strip stays on screen ──────────────────────────────────────────
#
# Reported 2026-09-10: "for some interaction channels you cannot see the time
# counting down without scrolling". Both halves matter to an operator holding
# two test tubes — WHAT is being asked and HOW LONG is left — and both were
# ordinary flex children at the foot of the panel's scrolling body.
#
# The space under the video is budgeted (the 64vh cap on the video box), but
# the budget is not the same for every channel: a gesture wait adds two
# drawings, voice adds a spoken form, object adds a longer name. On the
# channels that spend more, the countdown fell below the fold — and the
# operator had to scroll to find out how long they had, while being timed.
#
# Pinning it is the fix that does not need re-tuning every time something is
# added above it.

def test_the_wait_strip_is_pinned_to_the_bottom_of_the_body():
    src = _code()
    strip = src[src.index("{isHumanStepActive && ("):]
    strip = strip[:strip.index("{waitReadout && (")]
    assert "position: 'sticky'" in strip, (
        "la striscia di attesa e' tornata a essere un normale figlio del "
        "flusso: su alcuni canali il countdown finisce sotto la piega e "
        "l'operatore deve scorrere per sapere quanto tempo gli resta."
    )
    assert "bottom:" in strip, (
        "sticky senza `bottom` non si ancora a niente."
    )


def test_the_pinned_strip_has_its_own_ground():
    """Content scrolls UNDER a sticky element.

    Without an opaque background the video would slide through the countdown,
    which is worse than the scrolling it replaces.
    """
    src = _code()
    strip = src[src.index("{isHumanStepActive && ("):]
    strip = strip[:strip.index("{waitReadout && (")]
    assert "background: panel.bg" in strip, (
        "la striscia fissata non ha un fondo opaco: il contenuto che scorre "
        "le passa sotto e si legge attraverso il countdown."
    )


def test_the_strip_only_exists_while_a_step_waits():
    """Between steps the panel must scroll exactly as before.

    A permanently pinned band would eat the bottom of the body for every run,
    including the ones with no human step at all.
    """
    src = _code()
    strip_start = src.index("{isHumanStepActive && (")
    assert src[strip_start:strip_start + 60].startswith("{isHumanStepActive && ("), (
        "la striscia non e' piu' condizionata a un passo in attesa."
    )
    sticky_at = src.index("position: 'sticky'", strip_start)
    assert sticky_at > strip_start, (
        "lo sticky compare prima della guardia che lo rende condizionale: "
        "la striscia resterebbe fissata anche fuori da un passo in attesa."
    )


# ── The first viewport: what an operator sees without scrolling ─────────────
#
# Reported from the first sessions, and the third finding explains the other
# two: "users look for the action WITHOUT SCROLLING; if they do not see it,
# they go looking elsewhere in the app instead of scrolling the panel."
#
# Measured before the fix, panel at its default 520px: the idle 4:3 video took
# 42% of the first viewport at 1080p, 53% at 900p, 62% at 800p. The execution
# target sat below it and ended at ~573px on a 900px viewport — under the fold,
# and further under it the wider the panel was dragged, because a 4:3 box grows
# 0.75px of height per px of width. The gesture meaning "show me more" hid the
# control they were hunting for.


def test_the_execution_target_lives_in_the_header():
    """It is the only control in the app that selects the physical arm.

    `setExecutionTarget` has one call site. The task list deliberately sends
    'sim' (a one-click action must never move a physical arm), so if the header
    does not carry the choice there is nowhere else to find it — which is
    exactly what users reported.
    """
    src = _code()
    header = src[: src.index("overflowY: 'auto'")]
    assert 'aria-label="Execution target"' in header, (
        "il selettore del bersaglio non e' piu' nell'intestazione: torna sotto "
        "la piega, e non esiste nessun altro posto nell'app dove sceglierlo."
    )
    assert src.count("setExecutionTarget(v)") == 1, (
        "il bersaglio ha piu' di un punto di modifica: due controlli per la "
        "stessa scelta divergono."
    )


def test_the_target_is_locked_but_visible_during_a_run():
    """Switching target mid-run is meaningless; not knowing which one is live
    is dangerous. Locked, not hidden."""
    src = _code()
    control = src[src.index('aria-label="Execution target"'):]
    # Bound to the whole SegmentedControl: its options carry self-closing tags
    # of their own, so the first "/>" lands inside an icon, not at the end.
    control = control[: control.index("sx={{ flexShrink: 1")]
    assert "disabled={simulation.isRunning}" in control, (
        "il bersaglio e' modificabile mentre il braccio si muove."
    )
    assert "targetRobotLive" in control, (
        "il controllo non escala piu' a 'Arm live' durante la corsa: la "
        "distinzione fra la scelta e il fatto sparisce proprio quando conta."
    )


def test_the_idle_video_does_not_own_the_first_viewport():
    """Collapsed while nothing runs, full 4:3 the moment something does.

    Idle it renders ~370px of black reading "Start a simulation to see the
    robot here": the largest and topmost element, carrying nothing, exactly
    where the operator is scanning for an action.
    """
    src = _code()
    assert "videoCollapsed = !simulation.isRunning && !isHumanStepActive" in src, (
        "il video non si contrae piu' a riposo, oppure si contrae anche "
        "durante una corsa o un'attesa — quando in simulazione e' l'unico "
        "posto dove il robot esiste."
    )
    box = src[src.index("aspectRatio: videoCollapsed ? undefined : '4/3'") :]
    box = box[: box.index("}}")]
    assert "height: videoCollapsed ? IDLE_VIDEO_STRIP_PX : undefined" in box, (
        "l'altezza ridotta non e' piu' condizionata allo stato a riposo: "
        "applicata sempre, il flusso 4:3 verrebbe schiacciato durante la corsa."
    )


def test_the_run_settings_collapse_but_the_safety_notice_does_not():
    """Sound and wait time are set-once bench preferences; "the real robot will
    move" is not a preference at all."""
    src = _code()
    inside = src[src.index("<Collapse in={runSettingsOpen}") :]
    inside = inside[: inside.index("</Collapse>")]
    assert "Sound when a step needs you" in inside, (
        "il suono non e' piu' dentro la sezione richiudibile."
    )
    assert "Live hardware" not in inside and "Twin only" not in inside, (
        "un avviso di sicurezza e' finito dentro una sezione richiudibile: "
        "un avviso che si puo' chiudere e' un avviso che verra' chiuso."
    )


# ── Overscroll: a gesture over a panel must not move the workspace ──────────
#
# Reported 2026-09-10: scrolling over the robot panel or the nav rail, where
# there is nothing to scroll, bounced the workspace instead — canvas and the
# status bar carrying "running" and "View code" shifted together.
#
# Scroll chaining. A container that cannot scroll hands the gesture to its
# nearest scrollable ancestor; on /task/ the shell is height:100vh /
# overflow:hidden, so the nearest one left is the document, and the whole page
# rubber-banded under a UI meant to be fixed.


def test_the_document_does_not_rubber_band():
    css = _read(GLOBAL_CSS)
    block = css[css.index("html,") : css.index("* {")]
    assert "overscroll-behavior: none" in block, (
        "html/body torna a poter fare overscroll: una rotellina sopra un "
        "pannello che non scorre muove di nuovo il workspace e la barra di "
        "stato sotto di esso."
    )


def test_every_panel_scroll_area_contains_its_own_overscroll():
    """`contain` on each, so a panel at the end of its list stops there."""
    for rel in (
        os.path.join("components", "DigitalTwinPanel.tsx"),
        os.path.join("components", "BottomPanel.tsx"),
        os.path.join("components", "ChatThread.tsx"),
        os.path.join("layout", "MainLayout", "Drawer", "DrawerContent", "index.tsx"),
    ):
        src = _read(os.path.join(FRONTEND_SRC, rel))
        assert "overscrollBehavior: 'contain'" in src, (
            f"{rel} non contiene piu' il proprio overscroll: arrivato a fine "
            "elenco, la gesture prosegue sull'antenato e muove la pagina."
        )
