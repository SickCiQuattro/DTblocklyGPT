"""Create the four Part-B comparison tasks for the user study.

    poetry run python manage.py seed_partb_tasks
    poetry run python manage.py seed_partb_tasks --dry-run

Part B asks how four confirmation channels compare while the operator's hands
are busy. The four tasks are **identical except for the block in the
human_action's CONFIRM_EVENT slot**: anything else that differed between them
would be a second explanation for any difference in the measurements.

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

from backend.models import Object, Task, STATUS_PUBLISHED, TASK_TYPE_TASK
from backend.utils.date import getDateTimeNow
from backend.utils.signature import build_task_signature

# Read to the participant from 03-script-sessione.md; repeated verbatim on the
# panel so the instruction is identical in all four conditions.
_TASK_DESC = "Confronta le etichette delle due provette, poi conferma"

_OWNER_USERNAME = "operator1"
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


# Order matches the A/B/C/D labels used by the Williams square in
# studio-utenti/07-parteB.md. Do not renumber without updating that table.
_TASKS = [
    ("PB-A-pulsante", "human_feedback", "Parte B condizione A — conferma con il pulsante"),
    ("PB-B-voce", "voice", "Parte B condizione B — conferma vocale"),
    ("PB-C-gesto", "gesture", "Parte B condizione C — conferma con un gesto"),
    ("PB-D-oggetto", "object", "Parte B condizione D — rilevazione dell'oggetto"),
]


class Command(BaseCommand):
    help = "Create/refresh the four Part-B confirmation-channel tasks"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run", action="store_true", help="Report only, write nothing"
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        owner = User.objects.filter(username=_OWNER_USERNAME).first()
        if owner is None:
            raise CommandError(
                f"User '{_OWNER_USERNAME}' not found — run the main seed first."
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
                    # shared: the study accounts own nothing, so everything
                    # reaches them through Q(owner=user) | Q(shared=True).
                    "shared": True,
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
        self.stdout.write(
            "  Reminder: condition D needs the tray empty and in frame at the start "
            "of the trial — with STRICT_CONDITIONS the camera must see the tube "
            "appear, not find it already there."
        )
