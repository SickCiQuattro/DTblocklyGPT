"""
Seed the object/location/skill/task library with a pharmaceutical catalog.

Usage:
    poetry run python manage.py seed_library                # idempotent upsert
    poetry run python manage.py seed_library --owner 3       # explicit owner (default: operator1)
    poetry run python manage.py seed_library --reset         # wipe tasks/objects, trim locations
                                                               # and skills to the pharma set, then seed

Catalog (owner-scoped, shared=True):
  Objects (5): tube + blue/green/yellow tube (glass cylinder, Ø15x100mm,
    10g — coloured cap classified by cap_color.py; that HSV bin set
    (red/yellow/green/blue) is hardcoded there and cannot be extended
    without touching cap_color.py too — it still supports red even though
    no catalog object has a red cap anymore, see below), medicine bottle
    (Ø22x80mm, YOLO 'bottle'). Renamed in place from
    'test tube'/'blue test tube'/etc — RENAME_OBJECTS keeps referencing
    task workspaces (they store the object id, name is a display fallback).
    `red tube`/`beaker`/`sample bowl` were removed 2026-07-29 (unused/
    redundant demo props, and `sample bowl` existed only to demonstrate an
    infeasible-width object — see REMOVED_OBJECTS for DB cleanup of rows
    seeded by an older version of this command).
  Locations (4): tube rack (3-slot rack), collection rack (taught pose,
    ex 'collector' — renamed in place on --reset to keep the pose),
    waste bin (ex 'box'), sample tray (ex 'plate').
  Skills (2): Inspect sample (ex 'reaction-checking', real taught waypoints
    that lift a held tube toward the camera), Shake sample (ex 'shaking',
    previously had zero waypoints — a no-op; --reset synthesizes an
    oscillating-wrist sequence from Inspect sample's first, already-taught,
    reachable pose).
  Tasks (7, published): Sort tubes by colour, Fill the tube rack,
    Shake and check sample, Dispose failed sample, Verify and store
    medicine, Restock the tube rack, Dispose after voice approval.
  Draft tasks (2, unpublished, private): Move tube to sample tray, Sort
    green tube by camera — exercise the Draft status chip / Save-vs-Publish
    distinction; not shown to other users (shared=False).

Every object/location name maps 1:1 to a Gazebo SDF folder under
ros2_ws/Cobotta/{objects,locations}/<name.replace(' ', '_').lower()>/ — keep
new catalog entries and SDF folder names in lockstep.
"""
import itertools
import json

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

from backend.models import Object, Location, Action, Task
from backend.utils.signature import build_task_signature

User = get_user_model()

# ─── Objects ────────────────────────────────────────────────────────────────

_TUBE_DIMS = {"height": 0.10, "obj_width": 15, "obj_length": 15, "weight": 10, "force": 1}

OBJECTS = [
    {"name": "tube", **_TUBE_DIMS,
     "keywords": ["provetta", "tube", "vial"]},
    {"name": "blue tube", **_TUBE_DIMS,
     "keywords": ["provetta blu", "blue tube", "blue cap"]},
    {"name": "green tube", **_TUBE_DIMS,
     "keywords": ["provetta verde", "green tube", "green cap"]},
    {"name": "yellow tube", **_TUBE_DIMS,
     "keywords": ["provetta gialla", "yellow tube", "yellow cap"]},
    # obj_width 23 matches object.meta.json's max_grasp_width (0.023) — the
    # value pick planning actually uses; was 22 (a stale, never-fixed
    # mismatch, predating the 2026-07-29 render change below).
    {"name": "medicine bottle", "height": 0.08, "obj_width": 23, "obj_length": 23,
     "weight": 20, "force": 1, "keywords": ["flacone", "bottle", "vial"]},
]

# Objects removed from the catalog 2026-07-29 (red tube: redundant demo prop
# once yellow tube covers the same "waits for a coloured tube" task; beaker:
# redundant demo prop, replaced by medicine bottle in "Dispose after voice
# approval"; sample bowl: existed only to demonstrate an infeasible-width
# object, and no other object in the catalog is wide enough to replace it —
# "Report oversized sample" was removed rather than reassigned). --reset
# deletes any owner row still seeded under these names by an older run of
# this command, and warns (does not silently drop) about tasks that
# referenced them.
REMOVED_OBJECTS = ["red tube", "beaker", "sample bowl"]

LOCATIONS = [
    {"name": "tube rack", "keywords": ["portaprovette", "rack", "tube rack"]},
    {"name": "collection rack", "keywords": ["collection", "output rack"]},
    {"name": "waste bin", "keywords": ["cestino", "bin", "trash"]},
    {"name": "sample tray", "keywords": ["vassoio", "tray"]},
]

# Old -> new name, applied on --reset by renaming rows in place (not
# delete+recreate) so taught data — e.g. collector's joint-angle position —
# survives the rename.
RENAME_LOCATIONS = {"collector": "collection rack", "box": "waste bin", "plate": "sample tray"}
RENAME_ACTIONS = {"reaction-checking": "Inspect sample", "shaking": "Shake sample"}
RENAME_OBJECTS = {
    "test tube": "tube",
    "blue test tube": "blue tube",
    "red test tube": "red tube",
    "green test tube": "green tube",
    "yellow test tube": "yellow tube",
}

# Shake sample has no taught waypoints of its own — synthesize a wrist (j6)
# oscillation around Inspect sample's first pose, which is already proven
# reachable (it's real taught data). Verify reachability again if re-taught
# on a different physical cell.
_SHAKE_J6_OFFSETS = [0, 45, -45, 45, -45, 0]


def _build_shake_points(base_point: dict) -> list:
    return [{**base_point, "j6": base_point["j6"] + offset} for offset in _SHAKE_J6_OFFSETS]


class Command(BaseCommand):
    help = "Seed the pharma object/location/skill/task library"

    def add_arguments(self, parser):
        parser.add_argument("--owner", type=int, default=None,
                             help="Owner user ID (default: operator1 or lowest-id user)")
        parser.add_argument("--reset", action="store_true",
                             help="Wipe tasks/objects and trim locations/skills to the pharma set before seeding")

    def handle(self, *args, **options):
        owner_id = options["owner"]
        owner = (
            User.objects.filter(id=owner_id).first() if owner_id
            else User.objects.filter(username="operator1").first() or User.objects.order_by("id").first()
        )
        if not owner:
            self.stderr.write("No users found — run migrations and create a user first.")
            return
        self.stdout.write(f"Seeding as owner: {owner.username} (id={owner.id})")

        if options["reset"]:
            self._reset(owner)

        self._cleanup_removed_objects(owner)
        self._rename_objects(owner)
        self._fix_double_encoded_positions(owner)
        objs = self._seed_objects(owner)
        locs = self._seed_locations(owner)
        acts = self._seed_actions(owner)
        self._seed_tasks(owner, objs, locs, acts)

        self.stdout.write(self.style.SUCCESS("Done."))

    # ── --reset ──────────────────────────────────────────────────────────

    def _reset(self, owner):
        Task.objects.filter(owner=owner).delete()
        Object.objects.filter(owner=owner).delete()

        for old, new in RENAME_LOCATIONS.items():
            row = Location.objects.filter(owner=owner, name=old).first()
            if row:
                row.name = new
                row.save(update_fields=["name"])
                self.stdout.write(f"  Renamed location: {old} -> {new}")
        keep_locations = [spec["name"] for spec in LOCATIONS]
        removed, _ = Location.objects.filter(owner=owner).exclude(name__in=keep_locations).delete()
        if removed:
            self.stdout.write(f"  Removed {removed} obsolete location row(s)")

        inspect_points = None
        for old, new in RENAME_ACTIONS.items():
            row = Action.objects.filter(owner=owner, name=old).first()
            if row:
                row.name = new
                row.save(update_fields=["name"])
                self.stdout.write(f"  Renamed skill: {old} -> {new}")
                if new == "Inspect sample" and row.points:
                    inspect_points = json.loads(row.points).get("points", [])

        shake_row = Action.objects.filter(owner=owner, name="Shake sample").first()
        if shake_row and inspect_points:
            shake_row.points = json.dumps({"points": _build_shake_points(inspect_points[0])})
            shake_row.save(update_fields=["points"])
            self.stdout.write("  Synthesized Shake sample waypoints from Inspect sample's base pose")
        elif not shake_row:
            self.stderr.write(
                "  WARNING: no 'shaking'/'Shake sample' row found — Shake sample skill "
                "will be missing taught waypoints; the 'Shake and check sample' task cannot be seeded."
            )

        keep_actions = list(RENAME_ACTIONS.values())
        removed, _ = Action.objects.filter(owner=owner).exclude(name__in=keep_actions).delete()
        if removed:
            self.stdout.write(f"  Removed {removed} obsolete skill row(s)")

    def _cleanup_removed_objects(self, owner):
        """Delete any owner row still seeded under a REMOVED_OBJECTS name by
        an older run of this command. --reset already wipes every owner
        object/task unconditionally, so this is a no-op there — it only
        matters for the idempotent (non-reset) upsert path, which otherwise
        never touches rows for names dropped from OBJECTS, leaving them in
        the DB forever with no warning. Warns about (does not silently hide)
        any task still referencing the object's id — a cheap substring check
        on the serialized workspace, not a structural block walk, since this
        only needs to flag the operator, not guarantee zero false negatives.
        """
        for name in REMOVED_OBJECTS:
            obj = Object.objects.filter(owner=owner, name=name).first()
            if not obj:
                continue
            needle = f'"id": {obj.id}'
            referencing = [
                t.name for t in Task.objects.filter(owner=owner)
                if needle in json.dumps(t.published_workspace or t.draft_workspace or {})
            ]
            if referencing:
                self.stderr.write(
                    f"  WARNING: removing object '{name}' (id={obj.id}) still referenced by "
                    f"task(s): {', '.join(referencing)} — those tasks will fail to resolve it."
                )
            obj.delete()
            self.stdout.write(f"  Removed obsolete object: {name}")

    def _rename_objects(self, owner):
        # In-place rename (not delete+recreate) so referencing task workspaces
        # keep resolving by id — the block JSON's embedded name is only a
        # display fallback, _h_pick looks up sdf_name from the DB row.
        for old, new in RENAME_OBJECTS.items():
            if Object.objects.filter(owner=owner, name=new).exists():
                continue
            row = Object.objects.filter(owner=owner, name=old).first()
            if row:
                row.name = new
                row.save(update_fields=["name"])
                self.stdout.write(f"  Renamed object: {old} -> {new}")

    def _fix_double_encoded_positions(self, owner):
        # A location's `position` should be a dict of joint angles
        # ({"j1": ..., ..., "hand": ...}); some rows were saved as a JSON
        # *string* of that dict (double-encoded) by an earlier UI bug, which
        # fails the `isinstance(position, dict)` check in _h_move_to.
        for loc in Location.objects.filter(owner=owner):
            pos = loc.position
            changed = False
            while isinstance(pos, str):
                pos = json.loads(pos)
                changed = True
            if changed:
                loc.position = pos
                loc.save(update_fields=["position"])
                self.stdout.write(f"  Fixed double-encoded position: {loc.name}")

    # ── Objects / Locations ─────────────────────────────────────────────

    def _seed_objects(self, owner):
        result = {}
        for spec in OBJECTS:
            obj, created = Object.objects.update_or_create(
                name=spec["name"], owner=owner,
                defaults={
                    "height": spec["height"], "obj_width": spec["obj_width"],
                    "obj_length": spec["obj_length"], "weight": spec["weight"],
                    "force": spec["force"], "shared": True, "keywords": spec["keywords"],
                },
            )
            self.stdout.write(f"  {'Created' if created else 'Updated'} object: {obj.name}")
            result[obj.name] = obj
        return result

    def _seed_locations(self, owner):
        result = {}
        for spec in LOCATIONS:
            loc, created = Location.objects.update_or_create(
                name=spec["name"], owner=owner,
                defaults={"shared": True, "keywords": spec["keywords"]},
            )
            self.stdout.write(f"  {'Created' if created else 'Updated'} location: {loc.name}")
            result[loc.name] = loc
        return result

    def _seed_actions(self, owner):
        """Mark the pharma-catalog skills shared. Unlike _seed_objects/
        _seed_locations, this never creates a row: a Skill's `points` are
        real taught waypoints this script can't synthesize, so an
        update_or_create here could silently create an empty, untaught skill
        on a database that never had these legacy manually-taught rows —
        worse than the gap it would fix. Only flips `shared` on rows that
        already exist."""
        result = {}
        for name in ("Inspect sample", "Shake sample"):
            action = Action.objects.filter(owner=owner, name=name).first()
            if action is None:
                continue
            if not action.shared:
                action.shared = True
                action.save(update_fields=["shared"])
                self.stdout.write(f"  Marked skill shared: {action.name}")
            result[action.name] = action
        return result

    # ── Tasks ────────────────────────────────────────────────────────────

    def _seed_tasks(self, owner, objs, locs, acts):
        if "Inspect sample" not in acts or "Shake sample" not in acts:
            self.stderr.write(
                "  Skipping task seeding — 'Inspect sample'/'Shake sample' skills not found "
                "(run with --reset against a database that still has the legacy "
                "'reaction-checking'/'shaking' rows)."
            )
            return

        counter = itertools.count(1)

        def bid():
            return f"seed{next(counter):04d}"

        def entity(block_type, row):
            return {
                "type": block_type, "id": bid(),
                "fields": {"name": row.name},
                "data": json.dumps({
                    "id": row.id, "name": row.name,
                    "keywords": ",".join(row.keywords or []),
                }),
            }

        def pick(obj):
            return {"type": "pick_block", "id": bid(),
                    "inputs": {"OBJECT": {"block": entity("object_block", obj)}}}

        def place(loc):
            return {"type": "place_block", "id": bid(),
                    "inputs": {"LOCATION": {"block": entity("location_block", loc)}}}

        def proc(action):
            return {"type": "processing_block", "id": bid(),
                    "inputs": {"ACTION": {"block": entity("action_block", action)}}}

        def find(obj):
            return {"type": "find_object_block", "id": bid(),
                    "inputs": {"OBJECT": {"block": entity("object_block", obj)}}}

        def notify(msg):
            return {"type": "notify_action_block", "id": bid(), "fields": {"TASK_DESC": msg}}

        def gesture(gesture_type="THUMBS_UP"):
            return {"type": "gesture_block", "id": bid(),
                    "fields": {"GESTURE_TYPE": gesture_type}}

        def voice(word="YES"):
            return {"type": "voice_command_block", "id": bid(),
                    "fields": {"VOICE_WORD": word}}

        def human(msg, confirm=None):
            blk = {"type": "human_action_block", "id": bid(),
                   "fields": {"TASK_DESC": msg}}
            if confirm is not None:
                blk["inputs"] = {"CONFIRM_EVENT": {"block": confirm}}
            return blk

        def chain(*steps):
            head = steps[0]
            node = head
            for nxt in steps[1:]:
                node["next"] = {"block": nxt}
                node = nxt
            return head

        def when(condition, *do_steps):
            return {"type": "when_block", "id": bid(),
                    "inputs": {"WHEN": {"block": condition}, "DO": {"block": chain(*do_steps)}}}

        def repeat(times, *do_steps):
            return {"type": "repeat_block", "id": bid(), "fields": {"times": times},
                    "inputs": {"DO": {"block": chain(*do_steps)}}}

        def workspace(*steps):
            return [{
                "type": "when_start", "id": bid(), "x": 24, "y": 24,
                "deletable": False, "movable": False,
                "next": {"block": chain(*steps)},
            }]

        tube = objs["tube"]
        blue_tt, yellow_tt, green_tt = objs["blue tube"], objs["yellow tube"], objs["green tube"]
        tube_rack, collection_rack, waste_bin = locs["tube rack"], locs["collection rack"], locs["waste bin"]
        inspect, shake = acts["Inspect sample"], acts["Shake sample"]
        medicine = objs["medicine bottle"]

        tasks = [
            {
                "name": "Sort tubes by colour",
                "description": "Watches the camera and sorts blue and green tubes into the tube rack.",
                "workspace": workspace(
                    when(find(blue_tt), pick(blue_tt), place(tube_rack)),
                    when(find(green_tt), pick(green_tt), place(tube_rack)),
                ),
            },
            {
                "name": "Fill the tube rack",
                "description": "Picks up three tubes one at a time and places each into the tube rack.",
                "workspace": workspace(repeat(3, pick(tube), place(tube_rack))),
            },
            {
                "name": "Shake and check sample",
                "description": "Picks up a tube, shakes it, holds it up to the camera for inspection, then sets it in the collection rack.",
                "workspace": workspace(
                    pick(tube), proc(shake), proc(inspect), place(collection_rack),
                ),
            },
            {
                "name": "Dispose failed sample",
                "description": "Waits for a yellow tube, moves it to the waste bin and notifies the operator.",
                "workspace": workspace(
                    when(
                        find(yellow_tt), pick(yellow_tt), place(waste_bin),
                        notify("Failed sample moved to the waste bin — load a fresh tube."),
                    ),
                ),
            },
            {
                "name": "Verify and store medicine",
                "description": "Picks up the medicine bottle, waits for the operator to check the label and give a thumbs up, then places it in the collection rack.",
                "workspace": workspace(
                    pick(medicine),
                    human("Check the label and give a thumbs up", confirm=gesture("THUMBS_UP")),
                    place(collection_rack),
                ),
            },
            {
                "name": "Restock the tube rack",
                "description": "Asks the operator to load a new tube on the tray, then picks and places it into the tube rack — repeated three times.",
                "workspace": workspace(
                    repeat(3,
                           human("Load a new tube on the tray"),
                           pick(tube),
                           place(tube_rack)),
                ),
            },
            {
                "name": "Dispose after voice approval",
                "description": "Picks up the medicine bottle and waits for a spoken 'yes' before placing it in the waste bin.",
                "workspace": workspace(
                    pick(medicine),
                    when(voice("YES"), place(waste_bin)),
                ),
            },
        ]

        for spec in tasks:
            ws = spec["workspace"]
            task, created = Task.objects.update_or_create(
                name=spec["name"], owner=owner,
                defaults={
                    "task_type": "task", "status": "published", "shared": True,
                    "description": spec["description"],
                    "published_workspace": ws, "draft_workspace": None, "workspace": None,
                    "code": None, "signature": build_task_signature(ws), "dependencies": [],
                },
            )
            self.stdout.write(f"  {'Created' if created else 'Updated'} task: {task.name}")

        sample_tray = locs["sample tray"]

        draft_tasks = [
            {
                "name": "Move tube to sample tray",
                "description": "Picks up a tube and sets it on the sample tray.",
                "workspace": workspace(pick(tube), place(sample_tray)),
            },
            {
                "name": "Sort green tube by camera",
                "description": "Waits for a green tube in view, then moves it to the collection rack.",
                "workspace": workspace(when(find(green_tt), pick(green_tt), place(collection_rack))),
            },
        ]

        for spec in draft_tasks:
            ws = spec["workspace"]
            task, created = Task.objects.update_or_create(
                name=spec["name"], owner=owner,
                defaults={
                    "task_type": "task", "status": "draft", "shared": False,
                    "description": spec["description"],
                    # Matches a real never-published task's shape (see
                    # libraries.py's task-create view + task_lifecycle.py's
                    # save_draft): no published_workspace, signature stays at
                    # the model default "" since build_task_signature only
                    # ever runs on publish.
                    "published_workspace": None, "draft_workspace": ws, "workspace": None,
                    "code": None, "signature": "", "dependencies": [],
                },
            )
            self.stdout.write(f"  {'Created' if created else 'Updated'} draft task: {task.name}")
