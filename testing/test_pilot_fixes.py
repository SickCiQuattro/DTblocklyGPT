"""Five defects from the first pilot run, and the rules that keep them fixed.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_pilot_fixes.py -v

The first two are study blockers: without them a Part-B condition cannot be
measured at all.

  * find_object could never resolve in a plain simulation, and said so by
    accusing the operator. `launch_sim.sh` forwards no arguments, so vision
    defaults to false and no detector runs; the bridge answered detections: []
    exactly as it does when a running detector sees nothing, so the step waited
    out CONDITION_TIMEOUT_S and aborted with "the operator didn't confirm in
    time".
  * the voice vocabulary was printed in English at a recognizer listening in
    Italian. "Yes" survived because "si" is the obvious guess; "Done" and
    "Proceed" could be read aloud exactly as printed and match nothing.

The other three are interaction defects, each reported as a habit the operator
had to build against the interface rather than with it.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "frontend", "src")
SIMULATE = os.path.join(ROOT, "backend", "functions", "simulate.py")
BRIDGE = os.path.join(ROOT, "ros2_ws", "src", "cobotta_rest_api",
                      "cobotta_rest_api", "bridge_node_ROS.py")
REGISTRY = os.path.join(SRC, "constants", "recognitionRegistry.ts")
TOOLBOX = os.path.join(SRC, "features", "blockly", "toolbox", "CustomToolbox.tsx")
EDITOR_CSS = os.path.join(SRC, "features", "blockly", "styles", "editor.css")
HEADER = os.path.join(SRC, "layout", "MainLayout", "Header", "index.tsx")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _code(path):
    """Without comments — each one quotes the behaviour it replaced."""
    src = re.sub(r"/\*.*?\*/", "", _read(path), flags=re.DOTALL)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    src = re.sub(r"^\s*#.*$", "", src, flags=re.M)
    # Collapse the blank lines a stripped comment leaves behind. Without this a
    # fixed-size window anchored near a comment-heavy block is mostly
    # whitespace, and an assertion "X is not in this window" passes because the
    # window never reached X.
    return re.sub(r"\n\s*\n+", "\n", src)


# ── 1. A detector that is not running is not a slow operator ────────────────


def test_the_bridge_reports_how_old_the_last_detection_message_is():
    """vision_node publishes every cycle whether or not it found anything, so
    the age of the last message is what proves the node is alive. The bridge
    recorded that timestamp all along and never handed it out."""
    src = _code(BRIDGE)
    state = src[src.index("def get_vision_state") :]
    state = state[: state.index("\n    def ", 1)] if "\n    def " in state[1:] else state
    assert "object_age_s" in state, (
        "il bridge non dice piu' da quanto tempo non arriva una rilevazione: "
        "un nodo assente torna indistinguibile da un nodo che non vede nulla."
    )
    assert "_latest_object_time" in state, "l'eta' non e' calcolata dal timestamp reale"


def test_find_object_tells_an_absent_detector_from_an_absent_object():
    src = _code(SIMULATE)
    assert "VISION_STALE_AFTER_S" in src, (
        "sparita la soglia di obsolescenza: find_object torna ad aspettare "
        "l'intero timeout davanti a un rilevatore che non esiste."
    )
    branch = src[src.index("def _wait_for_condition") :]
    assert "vision_node_absent" in branch, (
        "il caso 'nessun rilevatore in ascolto' non e' piu' distinto: il passo "
        "consuma CONDITION_TIMEOUT_S e poi accusa l'operatore di non aver "
        "confermato in tempo."
    )
    # Same policy as an unreachable bridge, because it is the same fact — the
    # system cannot observe. One rule, not two.
    absent = branch[branch.index("vision_node_absent") :][:1400]
    assert "STRICT_CONDITIONS" in absent, (
        "il rilevatore assente non rispetta piu' STRICT_CONDITIONS: in sessione "
        "di studio deve interrompere, non aggirare in silenzio."
    )
    assert "_mark_condition_bypass" in absent, (
        "l'aggiramento non viene piu' registrato: nel log una conferma prodotta "
        "dal sistema diventerebbe indistinguibile da una dell'operatore."
    )


def test_the_message_does_not_blame_the_operator_for_a_missing_camera():
    src = _read(SIMULATE)
    assert "nothing is watching for objects" in src, (
        "sparito il messaggio che nomina la causa reale (nessun rilevatore) "
        "invece della mancata conferma dell'operatore."
    )


# ── 2. The voice vocabulary has to be pronounceable ─────────────────────────


def test_a_voice_command_shows_the_word_to_say():
    src = _code(REGISTRY)
    assert "voiceLabelWithSpokenForm" in src, (
        "le etichette vocali tornano al solo nome inglese del comando, davanti "
        "a un riconoscitore in ascolto in italiano."
    )
    assert "VOICE_DROPDOWN_OPTIONS" in src
    options = src[src.index("export const VOICE_DROPDOWN_OPTIONS") :][:200]
    assert "voiceLabelWithSpokenForm" in options, (
        "il menu a tendina del blocco vocale non mostra piu' la parola da "
        "pronunciare: e' li' che l'operatore sceglie il comando."
    )


def test_the_spoken_form_is_dropped_when_it_adds_nothing():
    """With VITE_SPEECH_LANG=en-US the spoken form IS the label, and a suffix
    would print 'Yes ("yes")'."""
    src = _code(REGISTRY)
    fn = src[src.index("export const voiceLabelWithSpokenForm") :][:400]
    assert "toLowerCase() === v.label.toLowerCase()" in fn, (
        "il suffisso non e' piu' condizionato: in inglese ripeterebbe "
        "l'etichetta fra parentesi."
    )


def test_every_voice_surface_uses_the_same_label():
    """Three places name a voice command: the block's dropdown, the Test
    recognition legend, and the card that previews a Copilot proposal. A
    participant who reads one and acts on another is the failure."""
    # The CALL, not the name: both files import the helper, so matching the
    # bare identifier passes on a file that imports it and renders v.label.
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "voiceLabelWithSpokenForm(v)" in panel, (
        "la legenda di Test recognition torna al solo nome inglese del "
        "comando vocale, davanti a un riconoscitore in ascolto in italiano."
    )
    card = _code(os.path.join(SRC, "components", "TaskPreviewCard.tsx"))
    assert "voiceCodeLabel(condition.voiceWord)" in card, (
        "la scheda che mostra una proposta di Copilot torna al solo nome "
        "inglese: e' li' che l'operatore decide se accettarla."
    )


# ── 3. The palette holds what the operator is reading ───────────────────────


def test_more_than_one_toolbox_category_can_be_open():
    src = _code(TOOLBOX)
    assert "expandedKeys" in src and "new Set" in src, (
        "la toolbox torna a una sola categoria aperta: costruire un programma "
        "passa da azione a condizione a passo umano, e ogni apertura "
        "richiuderebbe quella appena letta."
    )
    assert "expandedKeys.has(category.key)" in src, (
        "il pannello non legge piu' l'insieme delle categorie aperte"
    )


def test_the_heading_shortcut_follows_focus_not_the_open_panel():
    """H walked the categories by reading which one was expanded. With several
    open at once that no longer names one, and focus is the better source: it
    is what the operator moved last."""
    src = _code(TOOLBOX)
    handler = src[src.index("const handleToolboxKeyDown") :]
    handler = handler[: handler.index("return (")]
    assert "toolbox-category-${c.key}` === activeId" in handler, (
        "H torna a calcolare la propria posizione da cio' che e' espanso"
    )


# ── 4. A marker is not a control ────────────────────────────────────────────


def test_the_warning_triangle_does_not_take_the_click():
    """It sits on the shadow block whose own click opens the picker that fills
    the slot and removes the warning — the marker occupied the target you have
    to hit to make it go away."""
    css = _read(EDITOR_CSS)
    assert re.search(r"\.blocklyWarningIcon\s*\{[^}]*pointer-events:\s*none",
                     css, re.S), (
        "il triangolo di avviso torna cliccabile e continua a rubare i click "
        "destinati allo slot sotto di lui."
    )
    # Scoped: comment and mutator icons share .blocklyIconGroup, and disabling
    # those would break a real control rather than a marker.
    assert not re.search(r"\.blocklyIconGroup\s*\{[^}]*pointer-events:\s*none",
                         css, re.S), (
        "la regola torna su .blocklyIconGroup: colpirebbe anche l'icona di "
        "commento e quella del mutator, che sono controlli veri."
    )


# ── 5. The one control that offers help has to look like one ────────────────


def test_the_copilot_button_is_visible_before_it_is_opened():
    src = _code(HEADER)
    # The whole button, not a fixed-size window: bounded by its own closing tag
    # so the assertion cannot pass by falling short of the declaration.
    chat = src[src.index("dispatch(toggleChat())") :]
    chat = chat[: chat.index("</Button>")]
    assert "'transparent'" not in chat, (
        "il pulsante Copilot torna a testo grigio su nulla finche' non viene "
        "aperto: e' il controllo piu' silenzioso della barra, e l'unico che "
        "offre aiuto a chi non sa da dove cominciare."
    )
    # Green is spoken for: the robot panel reserves it for "twin only, the arm
    # cannot move" and spends it on Start simulation a few centimetres away.
    assert "success" not in chat, (
        "il pulsante Copilot passa al verde, che in questa app significa "
        "'solo gemello, il braccio non si muove' e sta gia' sul pulsante di "
        "avvio simulazione accanto."
    )


# ── Follow-ups: the scan pose, and the palette's heights ────────────────────


def test_the_arm_goes_and_looks_before_a_simulated_detection():
    """A plain simulation has no detector — `launch_sim.sh` forwards no
    arguments — and the object camera is a fact of the physical cell. The step
    still has to resolve visibly, or the one block this system exists to teach
    reads as broken.

    The scan-pose move is the visible half of that: an operator who asked the
    robot to find something has to see it go and look.
    """
    src = _code(SIMULATE)
    fn = src[src.index("def _move_to_scan_pose") :]
    fn = fn[: fn.index("\ndef ", 1)]
    assert "smooth_move(SCAN_POSE" in fn, "sparito il movimento verso la posa di scansione"
    assert "return" not in fn.split("current_joints")[0], (
        "il movimento verso la posa di scansione torna condizionato: in "
        "simulazione e' meta' di cio' che rende leggibile il rilevamento."
    )
    assert "SIMULATED_DETECTION_DWELL_S" in src, (
        "sparita la pausa in cui il robot 'sta guardando': il passo si "
        "risolveva nello stesso respiro in cui il pannello annunciava l'attesa."
    )


def test_a_simulated_detection_reports_success_not_a_timeout():
    """It must not go down the timeout channel, and it must be announced ONCE.

    Every path that resolves a condition already sends its own completion
    afterwards, so a notify from inside the condition is overwritten by that
    one a moment later: the operator saw "Found tube" for a frame and then the
    generic "Step completed". The text is left for the handler to pick up
    instead.
    """
    src = _code(SIMULATE)
    branch = src[src.index('_mark_condition_bypass("vision_node_absent")') :][:900]
    assert "/api/human-step-timeout" not in branch, (
        "il rilevamento simulato torna ad annunciarsi sul canale della "
        "scadenza: il pannello direbbe 'oggetto non rilevato' mentre il passo "
        "e' passato e l'esecuzione prosegue."
    )
    assert "_set_completion_text" in branch, (
        "il testo non e' piu' lasciato al gestore: una seconda notifica di "
        "completamento lo sovrascriverebbe subito col generico 'Step "
        "completed'."
    )
    # Both handlers that announce a completion have to drain it, or the text
    # is stashed and never sent on one of the two paths.
    # The two CALL SITES; a plain count would also match the definition.
    assert src.count('"description": _take_completion_text()') == 2, (
        "uno dei due punti che annunciano il completamento non preleva piu' "
        "la descrizione: su quel percorso il messaggio non arriverebbe mai."
    )
    assert "simulated" in branch, (
        "il messaggio non dice piu' che il rilevamento e' simulato: un "
        "partecipante ne ricaverebbe una convinzione sulla telecamera che lo "
        "studio poi misura."
    )


def test_the_simulated_detection_never_reaches_a_measured_session():
    """The positive outcome is a teaching affordance, not a measurement.

    STRICT_CONDITIONS is what a study session runs, and Part B condition D is
    the one place find_object is measured — on the physical cell, with
    ENABLE_VISION=1, where a detector IS running and this branch cannot fire.
    Both guards stay: the abort above it, and the bypass mark that lets
    analisi.py tell a system-produced confirmation from an operator's.
    """
    src = _code(SIMULATE)
    branch = src[src.index('extra={"reason": "vision_node_absent"') :][:1400]
    assert "STRICT_CONDITIONS" in src[: src.index('_mark_condition_bypass("vision_node_absent")')][-2000:], (
        "il ramo STRICT non precede piu' il rilevamento simulato: una "
        "sessione di studio registrerebbe una conferma fabbricata come "
        "genuina."
    )
    assert '_mark_condition_bypass("vision_node_absent")' in branch, (
        "il rilevamento simulato non e' piu' marcato come bypass: nel log "
        "diventerebbe indistinguibile da una conferma dell'operatore."
    )


def test_a_completion_can_say_what_completed_it():
    flask_api = os.path.join(ROOT, "ros2_ws", "src", "cobotta_rest_api",
                             "cobotta_rest_api", "blueprints", "flask_api.py")
    published = _code(flask_api)
    # Bounded by the next route, not by a character count: two other handlers
    # in this file also read a "description", so a fixed-size window walks into
    # one of them and reports a stripped humanStepComplete as intact.
    published = published[published.index("def humanStepComplete") :]
    published = published[: published.index("@bp.route")]
    assert '"description"' in published, (
        "il ponte non inoltra piu' la descrizione di un passo completato: "
        "resterebbe solo il generico 'Step completed'."
    )
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "setStepCompleted(humanStep.description || 'Step completed')" in panel, (
        "il pannello torna al messaggio generico e perde cosa e' stato trovato"
    )
    assert "text: stepCompleted }" in panel, (
        "la pillola sul video non mostra piu' il testo del completamento"
    )


def test_only_a_database_backed_category_caps_its_height():
    """Robot Actions holds seven pills — 8+7*32+6*6+8 = 276px against a 260px
    cap — so the category open when the editor loads has always been clipping
    its last pill. With several categories open at once, capping each one also
    nests a scroll region inside the palette's own for every one of them."""
    css = _read(os.path.join(SRC, "features", "blockly", "toolbox",
                             "CustomToolbox.css"))
    body = css[css.index(".toolbox-category__body {") :]
    body = body[: body.index("}")]
    assert "max-height" not in body, (
        "il corpo di ogni categoria torna a un tetto fisso: Robot Actions "
        "ritaglia la sua ultima pillola, e con piu' categorie aperte ognuna "
        "diventa un'area di scorrimento dentro quella della palette."
    )
    assert ".toolbox-category--bounded .toolbox-category__body" in css, (
        "sparito il tetto per le categorie che pescano dal database: una "
        "libreria lunga spingerebbe fuori dalla palette tutte le altre."
    )
    tsx = _code(os.path.join(SRC, "features", "blockly", "toolbox",
                             "CustomToolbox.tsx"))
    assert "toolbox-category--bounded" in tsx, (
        "nessuna categoria riceve piu' la classe che le mette il tetto"
    )
    assert "category.blocks.some((b) => b.dynamic)" in tsx, (
        "il tetto non e' piu' deciso dal fatto che la categoria sia dinamica"
    )


def test_a_bypass_is_not_announced_as_a_timeout():
    """One status on the wire carries two opposite outcomes.

    A real timeout ends the step in failure. A bypass auto-satisfies a
    condition nothing could observe, and the run carries on. Both arrive as
    status "timeout", and the panel announced 'object "tube" not detected' for
    a step that had passed — the opposite of what happened, phrased as the
    operator's fault.
    """
    flask_api = os.path.join(ROOT, "ros2_ws", "src", "cobotta_rest_api",
                             "cobotta_rest_api", "blueprints", "flask_api.py")
    published = _code(flask_api)
    published = published[published.index("def humanStepTimeout") :][:700]
    assert '"bypass_reason"' in published, (
        "il ponte torna a scartare bypass_reason: il pannello non puo' piu' "
        "distinguere una scadenza da un passo risolto dal sistema."
    )
    hook = _code(os.path.join(SRC, "hooks", "useRosEvents.ts"))
    assert "bypass_reason" in hook, "il tipo dell'evento non porta piu' il motivo"
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "humanStep?.bypass_reason &&" in panel, (
        "il pannello torna ad annunciare 'non rilevato' per un passo che e' "
        "stato invece completato dal sistema."
    )
    # The banner has to come BEFORE the timeout one: the slot holds a single
    # entry chosen by array order, so a bypass listed after the timeout could
    # never be reached.
    assert panel.index("key: 'bypass'") < panel.index("key: 'timeout'"), (
        "il messaggio di bypass finisce dopo quello di scadenza: lo slot "
        "tiene una cosa sola e sceglie per ordine, quindi non comparirebbe mai."
    )


# ── A message must not push its own condition off the canvas ────────────────


def test_a_long_message_cannot_hide_the_resume_condition():
    """`human_action_block` is two rows: the operator's message, and
    "Resume when:" with the socket that says what ends the pause.

    TASK_DESC is a `field_input` — one line, grows with its text — and an
    external value input puts its socket at the RIGHT EDGE of the block. So a
    long message widens row one, the block widens with it, and the socket
    travels off the right of a canvas already sharing the screen with Copilot
    and the robot panel. The operator loses the one thing that makes the block
    a pause rather than a notice.
    """
    ext = _code(os.path.join(SRC, "features", "blockly", "blocks",
                             "messageFieldWidth.ts"))
    assert "maxDisplayLength" in ext, (
        "sparito il tetto alla larghezza del campo messaggio: un messaggio "
        "lungo torna a spingere il socket 'Resume when' fuori dalla tela."
    )
    # Truncation is on what is DRAWN. The stored value must stay whole, or a
    # message would be silently cut on save.
    assert "setValue" not in ext, (
        "l'estensione tocca il valore del campo invece della sola resa: il "
        "messaggio dell'operatore verrebbe troncato davvero."
    )
    defs = _code(os.path.join(SRC, "features", "blockly", "blocks",
                              "definitions.ts"))
    for block in ("human_action_block", "notify_action_block"):
        chunk = defs[defs.index(f"type: '{block}'") :][:200]
        assert "HUMAN_MESSAGE_FIELD_EXTENSION" in chunk, (
            f"{block} non applica piu' l'estensione che limita la larghezza"
        )


def test_the_full_message_stays_readable_without_editing():
    """Capping the drawn width hides text. The tooltip is what gives it back,
    and it has to be a function: the message changes as the operator types, so
    a string captured at definition time would describe whatever the block held
    when it was created."""
    ext = _code(os.path.join(SRC, "features", "blockly", "blocks",
                             "messageFieldWidth.ts"))
    assert "this.setTooltip(() =>" in ext, (
        "il messaggio completo non e' piu' leggibile senza entrare in "
        "modifica, oppure il tooltip e' stato fissato una volta sola."
    )
    assert "message.length > MAX_DISPLAYED_CHARS" in ext, (
        "il tooltip ripete il messaggio anche quando e' gia' tutto visibile"
    )


# ── Audible feedback for an operator step ───────────────────────────────────

SOUND = os.path.join(SRC, "hooks", "useRecognitionSound.ts")


def test_the_cue_is_the_same_for_every_channel():
    """The reason the sound exists is that the four channels are not equally
    close to the screen — the Confirm button is under your hand, an object has
    to be shown to the camera at the cell. A cue that DIFFERED per channel
    would put that asymmetry straight back, and a cue that differed per gesture
    or per word would hand the operator the answer Part B is measuring them
    finding on their own.
    """
    src = _code(SOUND)
    cues = src[src.index("const CUES") :]
    cues = cues[: cues.index("\n}")]
    for channel in ("gesture", "voice", "object", "human_feedback", "thumbs"):
        assert channel not in cues.lower(), (
            f"il repertorio dei suoni nomina il canale '{channel}': un tono "
            "diverso per canale reintroduce l'asimmetria che questo serve a "
            "togliere, e uno diverso per gesto direbbe la risposta."
        )
    # Three phases of a step, not four channels.
    assert "waiting" in cues and "accepted" in cues and "failed" in cues, (
        "sparita una delle tre fasi (attesa avviata / accettata / fallita)"
    )


def test_the_sound_is_driven_by_the_same_event_as_the_pills():
    """Same source of truth, so the two can never disagree about what
    happened."""
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "sound.play('waiting')" in panel, (
        "sparito il tono all'avvio del passo: e' quello che manca del tutto "
        "oggi, ed e' l'unico modo di sapere che l'esecuzione e' arrivata al "
        "punto che ti aspetta se non sei davanti allo schermo."
    )
    assert "sound.play('accepted')" in panel and "sound.play('failed')" in panel


def test_audio_is_unlocked_from_a_user_gesture():
    """A context created outside a click starts suspended, and every cue is
    then dropped in silence with nothing on screen saying so."""
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    run = panel[panel.index("const handleRun = () =>") :][:400]
    assert "sound.unlock()" in run, (
        "l'audio non viene piu' sbloccato dal click su Run: il browser lo "
        "lascia sospeso e i toni non suonano mai."
    )


def test_the_sound_never_replaces_what_was_already_on_screen():
    """An operator who cannot hear must lose nothing they had before."""
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "stepCompleted && { tone: 'success'" in panel, (
        "la pillola visiva del passo completato e' sparita: il suono era un "
        "canale in piu', non un sostituto."
    )
    assert 'aria-live="polite"' in panel, "sparita la regione live della riga STATUS"


def test_the_sound_can_be_turned_off_and_the_choice_sticks():
    src = _code(SOUND)
    assert "localStorage.setItem(STORAGE_KEY" in src, (
        "la scelta sul suono non viene piu' ricordata: cambierebbe da sessione "
        "a sessione senza che nessuno se ne accorga."
    )
    panel = _code(os.path.join(SRC, "components", "DigitalTwinPanel.tsx"))
    assert "sound.setEnabled(e.target.checked)" in panel, (
        "sparito l'interruttore dal pannello"
    )


def test_the_setup_checklist_tells_the_experimenter_to_check_it():
    """A setting that is remembered per browser is a setting that differs
    between workstations unless someone verifies it."""
    checklist = _read(os.path.join(ROOT, "studio-utenti", "09-checklist-setup.md"))
    assert "suono di riconoscimento" in checklist, (
        "la checklist di setup non chiede piu' di verificare il suono: acceso "
        "in una sessione e spento in un'altra e' una differenza fra "
        "partecipanti che l'analisi non puo' recuperare."
    )
