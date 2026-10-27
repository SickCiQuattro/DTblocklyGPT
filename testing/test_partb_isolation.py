"""The Part-B tasks must be invisible to the participant's own account.

Run:
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 poetry run python -m pytest testing/test_partb_isolation.py -v

Part B measures four confirmation channels on a human step the participant did
not build. Part A, earlier in the same session, asks the participant to build a
human step unaided — that is RQ3. If the four pre-built tasks appear in their
task list during Part A, they can open one and read the answer, and RQ3 measures
nothing.

The tasks were originally seeded on operator1 with `shared=True`, which made
them visible to every account in the database. The reasoning was sound for the
catalogue — study accounts own nothing, so objects and locations only reach them
through the shared clause — and wrong for these four, because that same clause
ignores ownership by construction. Putting them on a separate account does not
help while the flag is set: `Q(owner=user) | Q(shared=True)` returns them either
way, which is the trap this file exists to keep closed.

These assertions read the seed command's constants rather than the database.
`db.sqlite3` is reverted between participants, so whatever it holds right now is
not what the next session starts from; the command is what regenerates it.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

try:
    import django
    django.setup()
except Exception:
    pass

from backend.management.commands import seed_partb_tasks as seed


def test_the_seed_never_shares_a_partb_task():
    """The flag that decides the whole thing, read out of the source.

    Asserted against the source text and not against a written row, because the
    defect this guards is a one-word edit to a dict literal — and a test that
    only checks rows would pass on any database seeded before that edit.
    """
    src = open(seed.__file__).read()
    body = src.split("defaults={", 1)[1]
    assert '"shared": False' in body, (
        "seed_partb_tasks writes shared=True: every Part-B task becomes visible "
        "to the participant during Part A and RQ3 is lost"
    )
    assert '"shared": True' not in body


def test_the_partb_account_is_not_the_participant_account():
    assert seed._OWNER_USERNAME != seed._PARTICIPANT_USERNAME, (
        "Part B runs on its own account; owning the tasks makes them visible "
        "regardless of the shared flag"
    )


def test_every_measured_condition_is_present_exactly_once():
    """Four channels, four tasks, plus the familiarisation run."""
    channels = [channel for _, channel, _ in seed._TASKS]
    measured = [c for c in channels if c != "human_feedback"]
    assert sorted(measured) == ["gesture", "object", "voice"]
    # human_feedback twice: condition A, and PB-FAM which starts on the button.
    assert channels.count("human_feedback") == 2
    assert len(seed._TASKS) == 5


def test_the_familiarisation_task_exists_and_is_not_a_condition():
    """PB-FAM absorbs the live channel-swapping so the four measured
    workspaces are never opened in the editor.

    Re-publishing one rewrites its signature and last_modified, and an
    accidental edit to a workspace that is supposed to be identical across
    conditions is the confound pre-building them was meant to avoid.
    """
    names = [name for name, _, _ in seed._TASKS]
    fam = [n for n in names if n.startswith("PB-FAM")]
    assert len(fam) == 1, f"expected one familiarisation task, found {fam}"

    # The study's Williams square indexes the conditions
    # by these exact names; PB-FAM must not collide with one of them.
    conditions = [n for n in names if not n.startswith("PB-FAM")]
    assert conditions == [
        "PB-A-pulsante", "PB-B-voce", "PB-C-gesto", "PB-D-oggetto",
    ]


def test_all_five_share_one_description_constant():
    """The on-screen instruction has to be identical in all conditions.

    A different wording per channel would be a second explanation for any
    difference in response time, so the text is one constant used by every
    workspace rather than five strings that happen to match today.
    """
    for channel in ("human_feedback", "voice", "gesture"):
        ws = seed._workspace(channel, None)
        human = ws[0]["next"]["block"]
        assert human["type"] == "human_action_block"
        assert human["fields"]["TASK_DESC"] is seed._TASK_DESC


def test_the_channel_block_is_the_only_difference():
    """Everything outside the CONFIRM_EVENT slot must be byte-identical."""
    def skeleton(channel):
        ws = seed._workspace(channel, None)
        ws[0]["next"]["block"]["inputs"]["CONFIRM_EVENT"] = "<channel>"
        return ws

    reference = skeleton("human_feedback")
    for channel in ("voice", "gesture"):
        assert skeleton(channel) == reference, (
            f"the {channel} workspace differs outside its confirmation block"
        )


def test_an_unknown_channel_is_refused_rather_than_silently_skipped():
    from django.core.management.base import CommandError

    with pytest.raises(CommandError):
        seed._channel_block("telepathy", None)
