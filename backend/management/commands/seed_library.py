"""
Seed the object/location library with COCO-class objects and the tube_rack location.
Idempotent: uses get_or_create keyed on (name, owner).

Usage:
    poetry run python manage.py seed_library
    poetry run python manage.py seed_library --owner 3   # default: operator1
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

from backend.models import Object, Location

User = get_user_model()

OBJECTS = [
    {
        "name": "bottle",
        "height": 0.08,   # m
        "obj_width": 22,  # mm
        "obj_length": 22,
        "weight": 20,     # g
        "force": 1,
        "keywords": ["bottiglia", "flacone", "bottle"],
    },
    {
        "name": "cup",
        "height": 0.035,
        "obj_width": 26,
        "obj_length": 26,
        "weight": 15,
        "force": 1,
        "keywords": ["tazza", "bicchiere", "cup"],
    },
    {
        "name": "apple",
        "height": 0.024,
        "obj_width": 24,
        "obj_length": 24,
        "weight": 20,
        "force": 1,
        "keywords": ["mela", "apple"],
    },
    {
        "name": "banana",
        "height": 0.020,
        "obj_width": 20,
        "obj_length": 110,
        "weight": 15,
        "force": 1,
        "keywords": ["banana"],
    },
    {
        "name": "scissors",
        "height": 0.016,
        "obj_width": 8,
        "obj_length": 90,
        "weight": 10,
        "force": 1,
        "keywords": ["forbici", "scissors"],
    },
    {
        "name": "book",
        "height": 0.018,
        "obj_width": 70,
        "obj_length": 100,
        "weight": 50,
        "force": 1,
        "keywords": ["libro", "book"],
    },
    # Fix test tube height (previously 0.12 m, SDF is 0.10 m)
    {
        "name": "test tube",
        "height": 0.10,
        "obj_width": 15,
        "obj_length": 15,
        "weight": 10,
        "force": 1,
        "keywords": ["provetta", "test tube"],
        "_update_only": True,  # only update existing row, don't create
    },
    # Add green pill if missing
    {
        "name": "green_pill",
        "height": 0.015,
        "obj_width": 15,
        "obj_length": 15,
        "weight": 5,
        "force": 1,
        "keywords": ["pillola", "pill"],
    },
]

LOCATIONS = [
    {
        "name": "tube_rack",
        "keywords": ["portaprovette", "rack", "tube rack"],
    },
]


class Command(BaseCommand):
    help = "Seed object/location library with COCO-class entries and tube_rack"

    def add_arguments(self, parser):
        parser.add_argument(
            "--owner",
            type=int,
            default=None,
            help="Owner user ID (default: first operator1 or lowest-id user)",
        )

    def handle(self, *args, **options):
        owner_id = options["owner"]
        if owner_id:
            owner = User.objects.filter(id=owner_id).first()
        else:
            owner = (
                User.objects.filter(username="operator1").first()
                or User.objects.order_by("id").first()
            )

        if not owner:
            self.stderr.write("No users found — run migrations and create a user first.")
            return

        self.stdout.write(f"Seeding as owner: {owner.username} (id={owner.id})")

        # Objects
        created_count = 0
        updated_count = 0
        for spec in OBJECTS:
            update_only = spec.pop("_update_only", False)
            keywords = spec.pop("keywords", [])

            if update_only:
                obj = Object.objects.filter(name=spec["name"], owner=owner).first()
                if obj:
                    for k, v in spec.items():
                        if k != "name":
                            setattr(obj, k, v)
                    obj.keywords = keywords
                    obj.save()
                    updated_count += 1
                    self.stdout.write(f"  Updated object: {spec['name']}")
                else:
                    self.stdout.write(f"  Skipped (not found): {spec['name']}")
                continue

            obj, created = Object.objects.get_or_create(
                name=spec["name"],
                owner=owner,
                defaults={
                    "height": spec.get("height", 0.0),
                    "obj_width": spec.get("obj_width"),
                    "obj_length": spec.get("obj_length"),
                    "weight": spec.get("weight"),
                    "force": spec.get("force", 1),
                    "shared": True,
                    "keywords": keywords,
                },
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created object: {spec['name']}")
            else:
                self.stdout.write(f"  Already exists: {spec['name']}")

        # Locations
        for spec in LOCATIONS:
            keywords = spec.pop("keywords", [])
            loc, created = Location.objects.get_or_create(
                name=spec["name"],
                owner=owner,
                defaults={"shared": True, "keywords": keywords},
            )
            if created:
                created_count += 1
                self.stdout.write(f"  Created location: {spec['name']}")
            else:
                self.stdout.write(f"  Already exists: {spec['name']}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Created {created_count}, updated {updated_count}."
            )
        )
