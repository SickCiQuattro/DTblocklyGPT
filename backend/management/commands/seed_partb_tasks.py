"""Create the Part-B comparison tasks for the user study.

    poetry run python manage.py seed_partb_tasks
    poetry run python manage.py seed_partb_tasks --dry-run

Part B asks how four confirmation channels compare while the operator's hands
are busy. The four measured tasks are **identical except for the block in the
human_action's CONFIRM_EVENT slot**: anything else that differed between them
would be a second explanation for any difference in the measurements. A fifth,
PB-FAM, is the familiarisation run.

They live on their own account and are not shared — see _OWNER_USERNAME for why
that is load-bearing rather than tidiness.

Why they are pre-built rather than edited live between conditions: swapping the
channel in the editor takes six to eight UI actions plus a re-publish, which
would drop an authoring episode into the middle of the comparison — between two
trials that are supposed to differ only in how the operator answers.

Deliberately minimal: no pick, no place, nothing but the human step. Robot
motion before the confirmation would add its own variance to a measurement
whose whole point is a few seconds of operator response time. (The find_object
condition is the exception and cannot avoid it: the arm travels to the scan
pose first. That move happens before the countdown starts — see
simulate.py::_h_human_action — so it is not charged to the channel.)

Idempotent: re-running rewrites the four workspaces in place.
"""

import json

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from backend.models import Object, Task, STATUS_PUBLISHED, TASK_TYPE_TASK
from backend.utils.date import getDateTimeNow
from backend.utils.signature import build_task_signature

# Read to the participant from 03-script-sessione.md; repeated verbatim on the
# panel so the instruction is identical in all four conditions.
_TASK_DESC = "Confronta le etichette delle due provette, poi conferma"

# Owned by the Part-B account and NOT shared, which is the whole point.
#
# These were originally seeded on operator1 with shared=True, reasoning that the
# study accounts own nothing so everything has to reach them through
# Q(owner=user) | Q(shared=True). True for the catalogue, wrong for these four:
# shared=True makes them visible to EVERY account, so a participant browsing
# their task list during Part A finds the four comparison tasks and can open one
# and read the construct they are supposed to build unaided. That invalidates
# RQ3, and no amount of switching accounts fixes it — the shared clause ignores
# ownership by construction.
#
# So the session runs on two accounts: the participant works on _PARTICIPANT (the
# overview and Part A), then the experimenter hands over _OWNER_USERNAME for Part
# B. The catalogue stays on operator1 and stays shared, so both accounts see the
# objects, locations, skills and context tasks they need. Only these five are
# fenced off. The same filter governs execution, not just listing (see
# simulate.py's Q(owner=request.user.id) | Q(shared=True) on the task lookup), so
# a task hidden this way is also one the other account cannot run.
_OWNER_USERNAME = "study2"
_PARTICIPANT_USERNAME = "study1"
_FIND_OBJECT_NAME = "tube"


def _channel_block(channel: str, obj: Object | None) -> dict:
    """The one block that differs between the four tasks."""
    if channel == "human_feedback":
        return {"type": "human_feedback_block", "id": "pbB0010"}
    if channel == "voice":
        # DONE rather than YES: "finished" is what the participant is actually
        # reporting, and its Italian synonyms ("fatto", "completato") are the
        # ones a hands-busy operator reaches for.
        return {
            "type": "voice_command_block",
            "id": "pbB0011",
            "fields": {"VOICE_WORD": "DONE"},
        }
    if channel == "gesture":
        return {
            "type": "gesture_block",
            "id": "pbB0012",
            "fields": {"GESTURE_TYPE": "THUMBS_UP"},
        }
    if channel == "object":
        return {
            "type": "find_object_block",
            "id": "pbB0013",
            "inputs": {
                "OBJECT": {
                    "block": {
                        "type": "object_block",
                        "id": "pbB0014",
                        "fields": {"name": obj.name},
                        "data": json.dumps(
                            {
                                "id": obj.id,
                                "name": obj.name,
                                "keywords": ",".join(obj.keywords or []),
                            }
                        ),
                    }
                }
            },
        }
    raise CommandError(f"unknown channel '{channel}'")


def _workspace(channel: str, obj: Object | None) -> list:
    return [
        {
            "type": "when_start",
            "id": "pbB0001",
            "x": 24,
            "y": 24,
            "deletable": False,
            "movable": False,
            "next": {
                "block": {
                    "type": "human_action_block",
                    "id": "pbB0002",
                    "fields": {"TASK_DESC": _TASK_DESC},
                    "inputs": {
                        "CONFIRM_EVENT": {"block": _channel_block(channel, obj)}
                    },
                }
            },
        }
    ]


# PB-FAM first, then the four measured conditions.
#
# PB-FAM is the familiarisation run and the one task whose channel is meant to be
# swapped live, so the participant answers through each of the four channels once
# before any of them is timed. It carries the button to start with — the channel
# that needs no camera, no microphone and no props, so a first attempt cannot fail
# for a reason that has nothing to do with the participant.
#
# It exists as a separate task rather than as a warm-up run of PB-A because the
# four measured tasks must not be opened in the editor at all: re-publishing one
# rewrites its signature and last_modified, and an accidental edit to a workspace
# that is supposed to be identical across conditions is exactly the confound the
# pre-building avoids. PB-FAM absorbs the editing.
#
# Order of the remaining four matches the A/B/C/D labels of the study's
# Williams square. Do not renumber without updating that table.
_TASKS = [
    ("PB-FAM-familiarizzazione", "human_feedback",
     "Parte B — prova di familiarizzazione, il canale si cambia dal vivo"),
    ("PB-A-pulsante", "human_feedback", "Parte B condizione A — conferma con il pulsante"),
    ("PB-B-voce", "voice", "Parte B condizione B — conferma vocale"),
    ("PB-C-gesto", "gesture", "Parte B condizione C — conferma con un gesto"),
    ("PB-D-oggetto", "object", "Parte B condizione D — rilevazione dell'oggetto"),
]


class Command(BaseCommand):
    help = "Create/refresh the Part-B familiarisation and confirmation-channel tasks"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true", help="Report only, write nothing"
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        owner = User.objects.filter(username=_OWNER_USERNAME).first()
        if owner is None:
            raise CommandError(
                f"Part-B account '{_OWNER_USERNAME}' not found — create it before "
                f"seeding, these tasks are deliberately not shared and have "
                f"nowhere else to live."
            )

        obj = Object.objects.filter(name=_FIND_OBJECT_NAME).first()
        if obj is None:
            raise CommandError(
                f"Object '{_FIND_OBJECT_NAME}' not found — run seed_library first "
                f"(without --reset)."
            )

        for name, channel, description in _TASKS:
            workspace = _workspace(channel, obj)

            if dry_run:
                exists = Task.objects.filter(name=name, owner=owner).exists()
                self.stdout.write(
                    f"  would {'refresh' if exists else 'create'} {name} ({channel})"
                )
                continue

            task, created = Task.objects.update_or_create(
                name=name,
                owner=owner,
                defaults={
                    "description": description,
                    # Never share these — see the note on _OWNER_USERNAME. A
                    # shared Part-B task is visible to the participant during
                    # Part A, and RQ3 depends on it not being.
                    "shared": False,
                    "task_type": TASK_TYPE_TASK,
                    "status": STATUS_PUBLISHED,
                    "published_workspace": workspace,
                    "draft_workspace": None,
                    "workspace": None,
                    "code": None,
                    "signature": build_task_signature(workspace),
                    "last_modified": getDateTimeNow(),
                },
            )
            verb = "created" if created else "refreshed"
            style = self.style.SUCCESS if created else (lambda s: s)
            self.stdout.write(style(f"  {verb} {name} (id {task.id}, {channel})"))

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — nothing written."))
            return

        self.stdout.write(self.style.SUCCESS("Part-B tasks ready."))
        self._check_hidden_from_participant()
        self.stdout.write(
            "  Reminder: condition D needs the tray empty and in frame at the start "
            "of the trial — with STRICT_CONDITIONS the camera must see the tube "
            "appear, not find it already there."
        )

    def _check_hidden_from_participant(self):
        """Ask the participant's own query whether it can see any Part-B task.

        Seeding correctly is not the same as the leak being closed. An earlier
        version of this command put these on operator1 with shared=True, and
        update_or_create keys on (name, owner) — so re-running it now writes a
        fresh set under the Part-B account and leaves every old shared row
        exactly where it was, still visible to everyone. The seed output would
        say "ready" while the thing it is supposed to prevent is still true.

        So the check is the app's own filter, not a re-reading of what was just
        written. Reported, never repaired: deleting a participant's tasks
        because their name starts with PB- is not a decision a seed command
        should take by itself.
        """
        participant = User.objects.filter(username=_PARTICIPANT_USERNAME).first()
        if participant is None:
            self.stdout.write(self.style.WARNING(
                f"  Participant account '{_PARTICIPANT_USERNAME}' does not exist — "
                f"could not verify the tasks are hidden from it."
            ))
            return

        visible = Task.objects.filter(
            Q(owner=participant) | Q(shared=True), name__startswith="PB-"
        )
        if not visible.exists():
            self.stdout.write(
                f"  Hidden from '{_PARTICIPANT_USERNAME}', as Part B requires."
            )
            return

        raise CommandError(
            f"{visible.count()} Part-B task(s) are still visible to "
            f"'{_PARTICIPANT_USERNAME}': "
            + ", ".join(f"{t.name} (id {t.id}, owner {t.owner}, shared {t.shared})"
                        for t in visible)
            + ". A participant can open these during Part A and read the construct "
            "they are meant to build unaided. Delete or unshare them before running "
            "a session."
        )
