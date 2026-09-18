"""The workspace must reserve exactly the width the robot panel takes.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_workspace_reserves_panel_width.py -v

Three surfaces sit in this row and only one of them ever yielded: Copilot has
flexShrink 0, the robot panel is `position: fixed`, and the workspace between
them is `flex: 1, minWidth: 0`. So the workspace absorbed every request until
it was a 31px stripe of half-drawn blocks.

This file pins what came out of fixing that: the room is reserved where flex
cannot ignore it, the panel never takes the workspace below its floor, and the
two panels are now resized the same way instead of one being dragged and the
other snapped.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PANEL = os.path.join(ROOT, "frontend", "src", "components", "DigitalTwinPanel.tsx")
WORKSPACE = os.path.join(
    ROOT, "frontend", "src", "pages", "task-workspace", "index.tsx"
)


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


CHAT = os.path.join(ROOT, "frontend", "src", "components", "ChatThread.tsx")


def test_the_two_panels_are_resized_the_same_way():
    """Copilot and the robot panel are peers and were resized in two different
    ways: one dragged freely between 320 and 600, the other snapped between two
    fixed vw values by an icon. Three surfaces, three width models, of which the
    workspace's was "whatever is left".

    Both now carry the WAI-ARIA Window Splitter: a focusable role=separator on
    the edge, arrow keys, aria-valuenow/min/max. The icon survives as a
    shortcut between the default and the maximum, which is where the old
    two-state control's two positions went.
    """
    for name, path in (("Copilot", CHAT), ("pannello robot", PANEL)):
        src = _read(path)
        assert 'role="separator"' in src, (
            f"{name} non ha piu' una maniglia di ridimensionamento: i due "
            "pannelli tornano a comportarsi in modo diverso."
        )
        assert "aria-orientation=\"vertical\"" in src, (
            f"{name}: la maniglia non dichiara piu' il proprio orientamento"
        )
        assert "aria-valuenow" in src, (
            f"{name}: la maniglia non espone piu' la larghezza corrente, "
            "quindi da tastiera non si sa cosa si sta cambiando."
        )


def test_the_panel_width_is_a_number_not_a_snap():
    """A two-state enum cannot be dragged. The width is px, persisted, and
    floored in the reducer; the ceiling depends on the viewport and on
    Copilot's footprint, so it lives in the panel's CSS clamp."""
    store = _read(os.path.join(ROOT, "frontend", "src", "store", "reducers", "task.ts"))
    assert "robotPanelWidth: number" in store, (
        "la larghezza del pannello torna a essere un enum a due valori: non "
        "e' trascinabile, e Copilot accanto lo e'."
    )
    assert "ROBOT_PANEL_MIN_PX" in store, (
        "sparito il minimo del pannello: sotto una certa larghezza il readout "
        "va a capo e il video diventa una miniatura."
    )


def test_the_panel_never_takes_the_workspace_below_its_floor():
    """Copilot has flexShrink 0, this panel is fixed, and the workspace between
    them is `flex: 1, minWidth: 0` — the only one that yields, and it yields to
    nothing. With Copilot at 600px and the panel at 50vw a 1470px viewport left
    the workspace 31px: a stripe of half-drawn blocks that reads as broken.

    So the panel's width is clamped by what remains over WORKSPACE_MIN_PX, and
    Copilot publishes its footprint through a custom property because the fixed
    panel can learn it no other way.
    """
    src = _read(PANEL)
    assert "WORKSPACE_MIN_PX" in src, (
        "il pannello non tiene piu' conto di un minimo per il workspace: puo' "
        "tornare a ridurlo a una scheggia."
    )
    assert "var(--copilot-width" in src, (
        "il pannello non legge piu' l'ingombro di Copilot: essendo fixed non "
        "puo' scoprirlo da flex, e senza quel dato il clamp e' cieco."
    )

    chat = _read(os.path.join(ROOT, "frontend", "src", "components", "ChatThread.tsx"))
    assert "'--copilot-width'" in chat, (
        "Copilot non pubblica piu' la propria larghezza: la proprieta' che il "
        "pannello legge non viene piu' scritta da nessuno."
    )


def test_the_panel_is_not_dressed_as_a_floating_overlay():
    """Shadow and backdrop blur said "above the page". Once the workspace
    started reserving room for it, the panel became a column beside its peers —
    and the only one of the three wearing an elevation."""
    src = _read(PANEL)
    head = src[src.index("position: 'fixed'"):]
    head = head[: head.index("transform:")]
    assert "boxShadow" not in head, (
        "il pannello torna ad avere un'ombra: e' una colonna accanto alle "
        "altre due, non un livello sopra di esse."
    )
    assert "backdropFilter" not in head, (
        "torna la sfocatura di sfondo: non c'e' piu' niente sotto il pannello "
        "che possa trasparire, quindi e' costo senza effetto."
    )


def test_the_room_is_reserved_where_flex_cannot_ignore_it():
    """On the CONTAINER, as padding — not as a width on the flex child.

    It was a width on the child for a long time and it never did anything. The
    child is `flex: 1`, which sets flex-basis 0 and grow 1, and in a flex row
    the flex sizing wins over `width` on the main axis. So the canvas always
    spanned the whole row and everything anchored to its right edge sat under
    the panel — the zoom and fit-to-screen controls among them. The giveaway,
    reported by the operator: the controls moved when Copilot opened (a real
    flex sibling) and never when the robot panel did.

    Padding on the container shrinks the content box before flex distributes
    anything, and stays correct whichever side Copilot is on and whatever width
    it has been dragged to.
    """
    src = _read(WORKSPACE)

    reserved = re.search(
        r"paddingRight: simOpen\s*\?(.*?):\s*'var\(--layout-gutter\)'", src, re.DOTALL
    )
    assert reserved, (
        "la stanza per il pannello non e' piu' riservata come padding del "
        "contenitore: se e' tornata a essere una width sul figlio flex, non "
        "sta facendo niente."
    )
    expr = reserved.group(1)
    # Two gutters, not one. The panel's own inset is its distance from the
    # VIEWPORT EDGE, not from whatever sits to its left — reserving only
    # `width + inset` put the row's content boundary exactly on the panel's
    # left edge and the two cards touched, with no space between Copilot and
    # the robot panel at all.
    assert "var(--layout-gutter) * 2" in expr, (
        "la riserva torna a contare una sola grondaia: il contenuto della riga "
        "finisce esattamente sul bordo sinistro del pannello e le due schede "
        "si toccano."
    )
    assert "var(--robot-panel-width" in expr, (
        "la riserva non legge piu' la stessa proprieta' da cui il pannello si "
        "dimensiona: leggendo lo store, che viene scritto solo al rilascio, il "
        "pannello si muove durante il trascinamento e il workspace no."
    )
    assert "--copilot-width" in expr, (
        "la riserva ignora l'ingombro di Copilot: con tutti e tre aperti "
        "torna a non combaciare con il pannello."
    )


def test_the_synthesised_gap_does_not_animate_during_a_drag():
    """Copilot is a flex sibling, so the gap beside it is a real `gap`: its
    width changes and the workspace re-lays out in the same pass, constant by
    construction. The robot panel is `position: fixed` — nothing links it to the
    workspace, and the gap is synthesised by the row's padding computing the
    same number the panel computes for its width.

    A 300ms tween on that padding broke the agreement on every drag frame: the
    panel followed the pointer instantly while the padding eased towards it, so
    the gap visibly grew and shrank and the workspace arrived late. Reported as
    "con la chat questo non succede mai".

    The panel flags the drag on the document element; the row suspends its
    tween while the flag is present.
    """
    panel = _read(PANEL)
    assert "dataset.panelResizing" in panel, (
        "il pannello non segnala piu' il trascinamento: il resto del layout "
        "non ha modo di sospendere le proprie animazioni."
    )
    assert "delete document.documentElement.dataset.panelResizing" in panel, (
        "il flag di trascinamento non viene piu' rimosso: le transizioni "
        "resterebbero spente per sempre dopo il primo trascinamento."
    )

    workspace = _read(WORKSPACE)
    assert "html[data-panel-resizing] &" in workspace, (
        "la riga non sospende piu' la transizione del padding durante il "
        "trascinamento: il divario torna a crescere e calare a ogni frame."
    )


def test_every_gutter_comes_from_one_number():
    """Three surfaces in a row, and the spacing between them was written out by
    hand in five places as `12px` — plus a `+24` that was later "corrected" to
    `+12`, which is what removed the gap between Copilot and the robot panel.

    `LAYOUT.gutter` existed the whole time, with a comment claiming the CSS
    custom properties "propagate automatically". Nothing ever set them, so every
    `var(--layout-appbar-height, 56px)` in a fixed panel was silently using its
    literal fallback: correct by coincidence, and a trap the moment a height
    changed. MainLayout publishes them now.
    """
    layout = _read(
        os.path.join(ROOT, "frontend", "src", "layout", "MainLayout", "index.tsx")
    )
    for prop in (
        "'--layout-appbar-height'",
        "'--layout-statusbar-height'",
        "'--layout-gutter'",
    ):
        assert prop in layout, (
            f"{prop} non viene piu' pubblicata: i pannelli fixed tornano a "
            "usare i propri valori di ripiego, che nessuno aggiorna."
        )

    for name, path in (("workspace", WORKSPACE), ("pannello robot", PANEL)):
        src = _read(path)
        assert "var(--layout-gutter)" in src, (
            f"{name} non usa piu' la grondaia condivisa: le spaziature "
            "tornano a essere numeri scritti a mano che divergono."
        )


def test_a_collapsed_copilot_leaves_nothing_behind():
    """`width: 0` is not enough: with box-sizing border-box the 1px border on
    each side still draws, so the closed Copilot rendered as a 2px vertical
    rule between the workspace and the robot panel — read as a third surface,
    or as a seam.

    Asserted on the BASE declaration, because the first fix put `border: 'none'`
    in a conditional spread placed above `border: '1px solid …'` and the later
    key won: the rule was still on screen and the code looked fixed.
    """
    src = _read(CHAT)
    assert re.search(
        r"border: chatOpen \? `1px solid \$\{[^}]+\}` : 'none'", src
    ), (
        "il bordo di Copilot non e' piu' condizionale nella sua dichiarazione "
        "di base: se la condizione e' tornata in uno spread sopra, viene "
        "sovrascritta e la riga verticale resta a schermo."
    )


def test_the_panel_stops_growing_where_its_video_does():
    """Past the width at which the live view stops growing, a wider panel buys
    nothing: the stream stays the same size while the workspace shrinks to pay
    for it. Reported as "oltre non c'è un guadagno per lo stream".

    So the ceiling is not a taste number — it is the video's own cap plus the
    panel's horizontal padding, and it moves with it.
    """
    src = _read(PANEL)
    assert "PANEL_MAX_CSS" in src, (
        "il pannello non ha piu' un tetto proprio: puo' crescere oltre il "
        "punto in cui il video smette di guadagnare, rubando larghezza al "
        "workspace senza dare niente in cambio."
    )
    m = re.search(r"const PANEL_MAX_CSS = 'calc\((\d+)vh \+ \d+px\)'", src)
    assert m, "il tetto del pannello non e' piu' derivato da un'altezza"
    video_cap = re.search(r"maxWidth: 'min\(100%, (\d+)vh\)'", src)
    assert video_cap, "il tetto del video e' cambiato forma"
    assert m.group(1) == video_cap.group(1), (
        f"il tetto del pannello ({m.group(1)}vh) non segue piu' quello del "
        f"video ({video_cap.group(1)}vh): tornano a poter divergere, e il "
        "pannello a crescere a vuoto."
    )


def test_there_is_one_way_to_resize_the_panel():
    """The icon and the edge handle were two controls for one property, and
    Copilot beside it has only the handle. A button that jumps to fixed sizes
    competes with a handle that does not, which is the inconsistency the handle
    was added to close."""
    src = _read(PANEL)
    assert "Maximize2" not in src and "Minimize2" not in src, (
        "e' tornato il pulsante di ingrandimento: due modi per cambiare la "
        "stessa larghezza, e uno solo dei due esiste su Copilot."
    )


def test_dragging_the_panel_does_not_write_through_the_store():
    """Sixty store updates and sixty localStorage writes a second is what made
    this handle feel heavier than Copilot's, which is plain useState. The
    persisted value is a preference: it only has to be right when the drag
    ends."""
    src = _read(PANEL)
    resize = src[src.index("const startPanelResize"):]
    resize = resize[: resize.index("\n  }")]
    assert "setProperty(" in resize, (
        "il trascinamento non scrive piu' la custom property: e' l'unico "
        "canale che pannello e riserva leggono entrambi, quindi senza di essa "
        "i due si muovono in momenti diversi."
    )
    assert resize.count("dispatch(setRobotPanelWidth") == 1, (
        "il trascinamento torna a scrivere nello store a ogni frame: store, "
        "re-render e localStorage sessanta volte al secondo."
    )
    assert "isResizing" in src[: src.index("transition: isResizing")] , (
        "manca lo stato di trascinamento"
    )
    tween = src[src.index("transition: isResizing"):]
    tween = tween[: tween.index("',") + 2]
    assert "'none'" in tween, (
        "l'animazione della larghezza non viene piu' disattivata durante il "
        "trascinamento: ogni pointermove avvia un tween da 250ms e il pannello "
        "insegue il cursore con un quarto di secondo di ritardo."
    )


def test_the_flex_child_does_not_carry_a_width_again():
    """The trap this file exists for: a `width` on the flex child reads like a
    fix, computes correctly, and does nothing."""
    src = _read(WORKSPACE)
    child = src[src.index("{/* Blockly visual workspace */}"):]
    child = child[: child.index("order: chatPosition")]
    assert "width:" not in child, (
        "il figlio flex ha di nuovo una width: con flex:1 non ha effetto, e "
        "chi la legge crede che lo spazio sia riservato quando non lo e'."
    )


def test_the_closed_panel_clears_the_viewport():
    """The panel is inset 12px from the right edge, so sliding it out by 100%
    of its own width left a 12px strip of dark surface parked against the edge.
    It read as a collapsed drawer and did nothing when clicked — the only
    control that opens the panel is Run."""
    src = _read(PANEL)
    m = re.search(r"transform: simOpen\s*\?\s*'translateX\(0\)'\s*:\s*'([^']+)'", src)
    assert m, "l'espressione di chiusura del pannello e' cambiata"
    assert "--layout-gutter" in m.group(1), (
        "il pannello chiuso torna a sporgere della propria rientranza: una "
        "striscia che suggerisce un'affordance che non ha."
    )
