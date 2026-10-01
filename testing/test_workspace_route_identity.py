"""Saving a new task must not rebuild the workspace.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_workspace_route_identity.py -v

The first autosave of a task built from /task/new creates the row and then
navigates to /task/<id>. On screen that read as the page refreshing on its own:
the canvas rebuilt, undo history and zoom gone, the chat forgetting the
conversation, and a second proactive Copilot call.

It was not the route change. Verified with the real React Router: going from
/task/new to /task/<id> mounts the page once, not twice, even behind a layout, a
guard with state and a lazy wrapper. The page rebuilt itself, through three
things that all start when `id` appears:

  * the full-page spinner, shown while the freshly created task is fetched,
    which unmounts the canvas and the chat;
  * `editorDataTask`, filled in once the fetched task arrives, which
    BlocklyWorkspace treats as "dispose and inject again";
  * the on-load effect, which replaced the operator's blocks with the server's
    copy of them.

A task this page has just created is the case where the blocks on screen are
already the truth, so each of the three has to leave it alone.
"""
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PAGE = os.path.join(ROOT, "frontend", "src", "pages", "task-workspace", "index.tsx")


def _code(path):
    """Without comments — they quote what was removed, to record why."""
    with open(path, encoding="utf-8") as f:
        src = f.read()
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    return re.sub(r"(?<!:)//[^\n]*", "", src)


def test_page_remembers_that_it_created_the_task():
    page = _code(PAGE)
    assert "setCreatedHereId(String(res.id))" in page
    assert "const isCreatedHere = createdHereId !== null && createdHereId === id" in page, (
        "scoped to the id: a stale value must not block loading a different task"
    )


def test_spinner_does_not_replace_a_workspace_that_exists():
    assert re.search(r"isTaskLoading && !taskData && !isCreatedHere", _code(PAGE))


def test_editor_data_task_is_not_refilled_for_a_created_task():
    page = _code(PAGE)
    assert re.search(r"initialDataTask && !editorDataTask && !isCreatedHere", page), (
        "a changed dataTask makes BlocklyWorkspace dispose and re-inject the canvas"
    )


def test_server_copy_does_not_overwrite_the_blocks_on_screen():
    page = _code(PAGE)
    assert re.search(r"if \(taskData && isCreatedHere\)", page)
    early = page[page.index("if (taskData && isCreatedHere)"):]
    assert early.index("return") < early.index("setTaskStructure"), (
        "the early branch must return before the structure is re-derived"
    )


def test_discard_releases_the_guard():
    page = _code(PAGE)
    discard = page[page.index("discardDraft"):]
    assert discard.index("setCreatedHereId(null)") < discard.index("setEditorDataTask(null)"), (
        "after a discard the server copy is the truth; the guard would block the reload"
    )
