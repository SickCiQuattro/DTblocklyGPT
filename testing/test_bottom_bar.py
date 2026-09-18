"""The bottom of the workspace: the task-code drawer and the status bar.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_bottom_bar.py -v

Four things were true down here that stopped being true elsewhere in the app:

  * the code panel snapped between 24vh and 55vh from a Maximize/Minimize icon
    — the exact two-state model Copilot and the robot panel were just moved off,
    so the app was back to two resize idioms in three panels;
  * it was the only surface in the layout that was not a rounded card inside the
    12px gutter, and it painted `panelTokens.bg` while the robot panel painted
    `panelTokens.surface` — the same dark declared twice, 1.06:1 apart;
  * the robot panel is `position: fixed` with its own bottom offset, and that
    offset knew nothing about the code panel, so one covered the other;
  * the status bar centred its save state with `space-between` across three
    flex children of unequal width, so the timestamp slid sideways whenever the
    run label changed.

The closed state is deliberately NOT zero-height: the dark rail along the bottom
edge is the affordance that the code view exists, and it is the thing the user
asked to keep.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "frontend", "src")
BOTTOM = os.path.join(SRC, "components", "BottomPanel.tsx")
STATUS = os.path.join(SRC, "components", "StatusBar.tsx")
TWIN = os.path.join(SRC, "components", "DigitalTwinPanel.tsx")
SLICE = os.path.join(SRC, "store", "reducers", "task.ts")
VOCAB = os.path.join(SRC, "constants", "uiVocabulary.ts")
WORKSPACE = os.path.join(SRC, "pages", "task-workspace", "index.tsx")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _code(path):
    """Without comments.

    Every comment in these files quotes what it replaced, to record why — so a
    test matching raw text finds "Maximize2" and "HH:mm:ss" inside the very
    explanation of their removal and reports a file that is already fixed.
    """
    src = re.sub(r"/\*.*?\*/", "", _read(path), flags=re.DOTALL)
    src = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", src)


def test_the_code_panel_is_dragged_like_its_two_peers():
    src = _code(BOTTOM)
    assert "Maximize2" not in src and "Minimize2" not in src, (
        "il pannello del codice torna al toggle a due stati: e' esattamente il "
        "modello appena tolto dal pannello robot, quindi l'app tornerebbe ad "
        "avere due modi di ridimensionare tre pannelli."
    )
    assert 'role="separator"' in src, "sparita la maniglia di trascinamento"
    assert 'aria-orientation="horizontal"' in src, (
        "la maniglia non dichiara piu' l'orientamento: e' un Window Splitter "
        "orizzontale, non verticale come quelle dei due pannelli laterali."
    )
    # The keyboard half of the pattern. A separator that only answers the
    # pointer is not the pattern, it is a draggable div.
    assert "ArrowUp" in src and "ArrowDown" in src, (
        "la maniglia non risponde piu' ai tasti freccia"
    )


def test_the_closed_rail_survives():
    """The dark line along the bottom edge when the code view is hidden.

    It began as an accident — a semi-transparent border-top on a `height: 0`
    box, showing the panel's own background through it — and it reads as a
    closed drawer, which is what it is. Making the panel a card must not
    silently delete it, and it must not go back to being a side effect of a
    border that any restyle could remove.
    """
    slice_src = _code(SLICE)
    assert "CODE_PANEL_RAIL_PX" in slice_src, (
        "sparita la riga scura del pannello chiuso: e' l'unico indizio che la "
        "vista del codice esiste, e l'utente ha chiesto di tenerla."
    )
    assert not re.search(r"CODE_PANEL_RAIL_PX\s*=\s*0\b", slice_src), (
        "la riga del pannello chiuso e' tornata a zero: il pannello chiuso "
        "diventa invisibile."
    )
    bottom = _code(BOTTOM)
    assert "toggleCode" in bottom and 'aria-label="Show task code"' in bottom, (
        "la riga chiusa non apre piu' il pannello: una striscia che suggerisce "
        "un'affordance che non ha e' peggio di nessuna striscia."
    )


def test_the_code_panel_is_a_card_like_everything_else():
    src = _code(BOTTOM)
    assert "borderRadius: '16px 16px 0 0'" in src, (
        "il pannello del codice torna a spigoli vivi a tutta larghezza: e' "
        "l'unica superficie del layout che non e' una scheda arrotondata."
    )
    assert "marginInline: 'var(--layout-gutter)'" in src, (
        "il pannello torna a toccare i bordi laterali della finestra invece di "
        "rispettare la stessa grondaia di tutti gli altri riquadri."
    )


def test_the_two_dark_surfaces_are_the_same_dark():
    src = _code(BOTTOM)
    assert "panelTokens.surface" in src, (
        "il pannello del codice torna a dipingere panelTokens.bg mentre il "
        "pannello robot dipinge .surface: lo stesso scuro dichiarato due volte "
        "con due valori, 1.06:1 di distanza."
    )
    assert "#A9B2C3" not in src, (
        "torna il grigio scritto a mano al posto di panelTokens.textDim"
    )


def test_the_robot_panel_makes_room_for_the_code_panel():
    """The robot panel is `position: fixed`; nothing links it to a flex sibling
    unless it is told. Without this it sat on top of the code view — drag the
    code taller and watch the robot panel cover it."""
    twin = _code(TWIN)
    assert "--layout-codepanel-height" in twin, (
        "il pannello robot non tiene piu' conto dell'altezza del pannello del "
        "codice e torna a coprirlo."
    )
    bottom = _code(BOTTOM)
    assert "'--layout-codepanel-height'" in bottom, (
        "nessuno pubblica piu' la variabile che i due pannelli condividono"
    )
    # Published pre-clamped on purpose: a `max-height` here would cap the
    # rendered panel while the robot panel kept lifting itself by the uncapped
    # number, opening a gap between them on short viewports.
    assert "clampedHeightCss" in bottom, (
        "il valore pubblicato non e' piu' limitato: su una finestra bassa il "
        "pannello robot si solleverebbe di piu' di quanto il pannello del "
        "codice occupa davvero."
    )


def test_the_run_indicator_keeps_its_subject():
    vocab = _code(VOCAB)
    assert "idle: 'Idle'" not in vocab, (
        "l'indicatore torna a 'Idle': parola da sistemista, e l'unico dei tre "
        "stati che non nomina il proprio soggetto — l'indicatore cambiava "
        "grammatica, non solo valore, a ogni avvio."
    )
    status = _code(STATUS)
    assert "statusPulse" in status, (
        "il pallino torna statico: una corsa in corso e una finita si "
        "distinguono solo dal colore, in periferia dello sguardo."
    )
    assert "prefers-reduced-motion" in status, (
        "l'animazione non rispetta piu' la preferenza di moto ridotto"
    )


def test_the_save_state_stays_in_the_centre():
    src = _code(STATUS)
    assert "gridTemplateColumns: '1fr auto 1fr'" in src, (
        "la barra torna a space-between: con tre figli di larghezza diversa "
        "l'elemento centrale non e' centrato, e scivola di lato ogni volta che "
        "l'etichetta di esecuzione cambia."
    )
    assert "UI_TEXT.notSavedYet" in src, (
        "un compito aperto e non toccato torna a dire 'Unsaved changes': "
        "nomina una modifica che l'operatore non ha fatto, sulla schermata il "
        "cui unico mestiere e' dirgli se il lavoro e' al sicuro."
    )


def test_the_saved_time_does_not_tick():
    """Autosave fires about every two seconds; with seconds precision each one
    rewrote a digit in the corner of the screen, carrying a figure nobody acts
    on."""
    src = _code(WORKSPACE)
    assert "HH:mm:ss" not in src, (
        "torna la precisione al secondo sull'ora di salvataggio"
    )
    assert src.count("format('HH:mm')") == 3, (
        "i tre punti che scrivono lastSaved non concordano piu' sul formato"
    )
