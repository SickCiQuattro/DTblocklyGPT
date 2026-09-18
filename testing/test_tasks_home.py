"""The task list is the app's home page, and it has to behave like one.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_tasks_home.py -v

There is no separate dashboard: this grid is what an operator lands on. Four
things were true of it that are not true of a home screen —

  * a pager that could not page. Ten tasks at twelve per page rendered
    "1-10 of 10" with both arrows disabled and a size selector offering
    12/24/48, in a band across the bottom of the primary screen, above a grid
    that already scrolled;
  * the per-card primary action — Run, the thing this page exists for — was a
    17px ghost icon at the same weight as the overflow "..." beside it, while
    "New task" was a filled button;
  * "moves arm" was tagged on every card, so it separated nothing, while the
    one card worth a second look (no arm movement at all) carried no tag;
  * absolute DD/MM timestamps on a grid sorted by date, so the ordering had to
    be worked out rather than seen.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "frontend", "src")
LIST = os.path.join(SRC, "pages", "tasks", "listTasks.tsx")
DATE = os.path.join(SRC, "utils", "date.ts")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _code(path):
    """Without comments — they quote what was removed, to record why."""
    src = re.sub(r"/\*.*?\*/", "", _read(path), flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", src)


def test_the_list_offers_one_way_through_itself_not_two():
    """Replaces a test that hid the pager only when it could not page.

    That was half of this. It caught the ten-tasks case — a full band across
    the bottom with both arrows dead, above a grid that already scrolled — and
    its own message named the real problem: "sopra una griglia che gia'
    scorre". But it left the pager standing as soon as there were more tasks
    than fit a page, which is when both mechanisms are live at once: at fifteen
    tasks against a page size of twelve, three of them sat behind an arrow at
    the bottom of a scrolling area.

    Removed outright on 2026-09-11, against measured counts rather than a
    guess: 20 tasks in the whole database, 15 for the busiest owner. The
    fallback for a library that ever did grow is the search field above, which
    is already there and already answers to Cmd+K — paging through hundreds of
    cards was never the answer either.
    """
    src = _code(LIST)
    for gone in ("TablePagination", "rowsPerPage", "paginated"):
        assert gone not in src, (
            f"'{gone}' e' tornato: la griglia scorre, quindi le schede oltre "
            "la prima pagina finiscono dietro una freccia in fondo a un'area "
            "che scorre."
        )


def test_run_is_labelled_and_outweighs_the_overflow_menu():
    """It carried a tooltip and an aria-label all along, so this was never an
    accessibility bug — it was a hierarchy one, and only weight and a word fix
    that."""
    src = _code(LIST)
    end = src.index("id={`btn-run-task-")

    # Whichever opening tag is NEAREST the run id is the one carrying it. Not a
    # plain rindex("<"): the first version did that and landed on the `<Play`
    # inside startIcon, so it failed against the corrected file.
    # `<IconButton` does not contain `<Button`, so these two cannot collide.
    button = src.rfind("<Button", 0, end)
    icon_button = src.rfind("<IconButton", 0, end)
    assert button > icon_button, (
        "l'azione Run e' tornata una IconButton: sulla pagina il cui mestiere "
        "e' eseguire compiti, pesa meno del menu di overflow accanto."
    )
    assert "{UI_TEXT.simulate}" in src[end : end + 400], (
        "il pulsante Run ha perso l'etichetta visibile: resta distinguibile "
        "solo al passaggio del mouse."
    )


def test_the_arm_tag_marks_the_exception_not_the_rule():
    src = _code(LIST)
    assert "if (!uses.movesRobot)" in src, (
        "l'etichetta sul braccio torna a marcare il caso comune: presente su "
        "ogni scheda non distingue niente, mentre il compito che NON muove il "
        "braccio — messaggi e attese, il caso per cui questo sistema esiste — "
        "resterebbe senza alcun contrassegno."
    )


def test_dates_are_relative_with_the_exact_value_kept():
    date_src = _read(DATE)
    assert "formatRelativeFrontend" in date_src, (
        "sparita la formattazione relativa"
    )
    listing = _code(LIST)
    assert "formatRelativeFrontend(row.last_modified)" in listing, (
        "le schede tornano a mostrare la data assoluta: la griglia e' "
        "ordinata per quel campo e l'ordine deve vedersi senza leggere "
        "giorno e mese."
    )
    assert "formatDateTimeShortFrontend(row.last_modified)" in listing, (
        "il valore esatto non e' piu' disponibile: il relativo va bene per "
        "scorrere, non per sapere quando davvero."
    )


def test_the_home_says_when_nothing_can_run():
    """It counted how many tasks were ready and said nothing about whether any
    of them could actually run — the operator found that out one navigation
    later, in the robot panel."""
    src = _code(LIST)
    assert "hardwareStatus" in src, (
        "la home non controlla piu' se il ponte risponde"
    )
    assert "simulatorDown" in src, "sparito lo stato derivato"
    assert "warning.darker" in src, (
        "l'avviso torna a un tono che su bianco non supera AA: warning.dark "
        "misura 3.19:1, darker 5.02:1."
    )


def test_a_long_description_can_be_read_without_leaving_the_page():
    """One line, an ellipsis, and no tooltip.

    The seeded catalogue runs 38-132 characters against a card whose inner
    width is around 250px, so most of it was cut, with no way to read the rest
    short of opening Edit details — a separate page, reached from a menu, for
    text that was already on screen and merely too long for its box.
    """
    src = _code(LIST)
    block = src[src.index("const TaskDescription") :]
    block = block[: block.index("const TaskCard")]
    assert "WebkitLineClamp: 2" in block, (
        "la descrizione torna a una riga sola: 'nowrap' + text-overflow non "
        "sa tagliare oltre la prima riga, e la seconda riga ne porta intera "
        "la gran parte."
    )
    assert "title={clamped ? text : ''}" in block, (
        "il tooltip torna incondizionato: ripeterebbe una frase gia' "
        "interamente a schermo, sulla griglia che l'operatore attraversa col "
        "puntatore per cliccare una scheda."
    )
    assert "scrollHeight" in block and "ResizeObserver" in block, (
        "il troncamento non e' piu' misurato: la larghezza della scheda segue "
        "la griglia, che segue la finestra, e nulla ri-renderizza nel mezzo."
    )


def test_the_card_says_whose_task_it_is():
    """`owner__username` has been in the list payload all along, and the card
    never used it. The workspace header says "Shared by X - read-only" the
    moment you open one, so the only way to learn a task was not yours was to
    open it and find out you could not edit it."""
    src = _code(LIST)
    assert "row.owner__username" in src, (
        "la scheda non nomina piu' il proprietario: per sapere se un compito "
        "e' tuo bisogna di nuovo aprirlo."
    )
    assert "{!canManage && (" in src, (
        "la riga del proprietario non e' piu' condizionata a un compito che "
        "non e' tuo"
    )
    # The same sentence as the workspace header. Two screens describing one
    # fact should not need to be reconciled by the reader.
    header = _code(
        os.path.join(SRC, "layout", "MainLayout", "Header", "index.tsx")
    )
    assert "Shared by " in header and "Shared by " in src, (
        "la scheda e l'intestazione del workspace non usano piu' la stessa "
        "frase per lo stesso fatto."
    )


def test_the_sharing_icon_is_only_about_your_own_choice():
    """`shared` is the owner's decision about who may see a task. On someone
    else's it is a constant — being shared is the only reason it is in your
    list at all — so the icon carried no information there while occupying the
    place where "not yours" should have been said."""
    src = _code(LIST)
    assert "{canManage && (" in src, (
        "l'icona lucchetto/condivisione torna anche sui compiti altrui, dove "
        "e' sempre 'condiviso' e non dice niente."
    )


# ── The description, in the workspace ────────────────────────────────────────

HEADER = os.path.join(SRC, "layout", "MainLayout", "Header", "index.tsx")
WORKSPACE = os.path.join(SRC, "pages", "task-workspace", "index.tsx")
SLICE = os.path.join(SRC, "store", "reducers", "task.ts")


def test_a_description_can_be_written_where_the_task_is_built():
    """The gap was authoring, not reading.

    A description could only be written on the Edit details page, reached from
    the task list's overflow menu — so a task built from /task/new, which is
    how a task gets built, could not be given one without leaving the
    workspace, crossing to another screen and coming back. The place where you
    decide what a task does and the place where you say what it does were two
    navigations apart, in opposite directions.
    """
    header = _code(HEADER)
    # `dispatch(...)`, not the bare name: the import line carries the name too,
    # so matching that alone passes on a header that no longer writes anything.
    assert "dispatch(setTaskDescription(" in header, (
        "l'intestazione del workspace non scrive piu' la descrizione: torna "
        "componibile solo dalla pagina Edit details."
    )
    assert "setIsEditingDesc(true)" in header, (
        "non c'e' piu' modo di aprire l'editor della descrizione"
    )
    # triggerSave republishes the workspace whenever it happens to pass
    # conformance. Retitling a task must not have that side effect.
    save_desc = header[header.index("const handleSaveDesc") :]
    save_desc = save_desc[: save_desc.index("const handleCancelEditDesc")]
    assert "triggerRename(true)" in save_desc, (
        "la descrizione non passa piu' dal PUT dei metadati"
    )
    assert "triggerSave" not in save_desc, (
        "salvare una descrizione ripubblica il workspace: e' l'effetto "
        "collaterale che il percorso dei metadati esiste per evitare."
    )


def test_the_metadata_put_carries_the_description():
    src = _code(WORKSPACE)
    listener = src[src.index("if (renameTriggered) {") :]
    listener = listener[: listener.index(".catch(")]
    # The BODY, not just the listener: `activeTaskDescription` also appears in
    # the changed-guard a few lines above, so matching the slice as a whole
    # passes on a PUT that has stopped carrying the field.
    body = listener[listener.index("body: {") : listener.index("})")]
    assert "description: activeTaskDescription" in body, (
        "il PUT dei metadati non porta piu' la descrizione: l'intestazione la "
        "mostrerebbe modificata e il server non ne saprebbe nulla."
    )
    assert "activeTaskDescription" in listener[: listener.index("body: {")], (
        "il listener non confronta piu' la descrizione: una modifica alla sola "
        "descrizione non farebbe partire nessuna richiesta."
    )
    assert "description: taskData.description ?? ''" in src, (
        "la descrizione non viene piu' caricata in Redux all'apertura del "
        "compito: l'intestazione partirebbe vuota su ogni task che ne ha una."
    )


def test_a_partial_setActiveTask_cannot_blank_the_description():
    """`setActiveTask` is dispatched from seven places and only the two that
    load a task pass the whole record; the five that follow a save re-state
    just id/name/status. A defaulting `?? ''` would blank the header's
    description on every autosave — which is every two seconds while the
    operator types."""
    src = _code(SLICE)
    assert "if (action.payload.description !== undefined)" in src, (
        "la descrizione torna a un default: verrebbe cancellata "
        "dall'intestazione a ogni autosave."
    )
