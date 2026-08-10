"""Create one account per user-study participant.

    poetry run python manage.py seed_study_users --count 12
    poetry run python manage.py seed_study_users --count 16 --dry-run

Why one account each, rather than reusing `study1`/`study2`: participants build
and publish their own tasks during Part A, and every account sees shared
content plus its own. With a shared login, participant 3 opens the editor and
finds participant 1's tasks sitting in the list — which both contaminates the
"build it yourself" measure and leaks one participant's work to another.
Separate accounts also make the data attributable after the fact.

Mirrors the shape of the existing `study1` account: `Operator` group, one
`UserRobot` named "My Cobotta" pointing at the Denso-Cobotta. Owns nothing —
the seeded objects, locations, skills and demo tasks all reach it through
`Q(owner=user) | Q(shared=True)`.

Idempotent: re-running adjusts existing accounts instead of duplicating them,
and never resets a password that is already correct.
"""

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from backend.models import Robot, UserRobot

# Matches study1/study2. Kept obvious rather than secure on purpose: these are
# throwaway logins typed by the experimenter in front of the participant, on a
# machine that is never exposed. Do not reuse this pattern for real accounts.
_PASSWORD_TEMPLATE = "Study_{n}!"
_ROBOT_NAME = "Denso-Cobotta"
_USER_ROBOT_LABEL = "My Cobotta"
_GROUP = "Operator"


class Command(BaseCommand):
    help = "Create study01..studyNN participant accounts for the user study"

    def add_arguments(self, parser):
        parser.add_argument(
            "--count",
            type=int,
            default=12,
            help="How many participant accounts (default 12)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change, write nothing",
        )

    def handle(self, *args, **options):
        count = options["count"]
        dry_run = options["dry_run"]

        if count < 1 or count > 99:
            raise CommandError("--count must be between 1 and 99")
        # Not a hard error: the counterbalancing constraint belongs to the
        # protocol, not to account creation, and a pilot legitimately needs a
        # single account.
        if count % 4 != 0:
            self.stdout.write(self.style.WARNING(
                f"  Note: {count} is not a multiple of 4. Part B uses a 4x4 Williams "
                f"square, so a non-multiple leaves the condition order unbalanced."
            ))

        try:
            group = Group.objects.get(name=_GROUP)
        except Group.DoesNotExist:
            raise CommandError(
                f"Group '{_GROUP}' does not exist — run the main seed first."
            )

        robot = Robot.objects.filter(name=_ROBOT_NAME).first()
        if robot is None:
            raise CommandError(
                f"Robot '{_ROBOT_NAME}' not found — run the main seed first."
            )

        created, updated, unchanged = 0, 0, 0

        for n in range(1, count + 1):
            username = f"study{n:02d}"
            password = _PASSWORD_TEMPLATE.format(n=n)

            if dry_run:
                exists = User.objects.filter(username=username).exists()
                self.stdout.write(
                    f"  would {'update' if exists else 'create'} {username}"
                )
                continue

            with transaction.atomic():
                user, was_created = User.objects.get_or_create(username=username)
                touched = was_created

                # Only reset the password when it is actually wrong: a rerun
                # mid-study must not invalidate a credential the experimenter
                # has already written on the session sheet.
                if not user.check_password(password):
                    user.set_password(password)
                    user.save(update_fields=["password"])
                    touched = True

                if not user.groups.filter(pk=group.pk).exists():
                    user.groups.add(group)
                    touched = True

                _, robot_created = UserRobot.objects.get_or_create(
                    user=user,
                    robot=robot,
                    defaults={"name": _USER_ROBOT_LABEL},
                )
                touched = touched or robot_created

            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"  created {username}"))
            elif touched:
                updated += 1
                self.stdout.write(f"  updated {username}")
            else:
                unchanged += 1

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — nothing written."))
            return

        self.stdout.write(self.style.SUCCESS(
            f"Done: {created} created, {updated} updated, {unchanged} already correct."
        ))
        self.stdout.write(
            f"  Passwords follow the pattern {_PASSWORD_TEMPLATE.format(n='<n>')} "
            f"(study01 -> {_PASSWORD_TEMPLATE.format(n=1)})."
        )
