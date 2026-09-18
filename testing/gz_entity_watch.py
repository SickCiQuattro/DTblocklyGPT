"""Name the Gazebo entity behind a `Physics.cc:2967 ... ID of [N]` storm.

Run (needs the sim up; read-only, safe during a run):

    # 1. while the error is NOT yet happening
    poetry run python testing/gz_entity_watch.py snapshot before

    # 2. do the thing that triggers it (one pick + one place into the cup)

    # 3. once the error starts
    poetry run python testing/gz_entity_watch.py snapshot after
    poetry run python testing/gz_entity_watch.py diff before after

    # and, directly:
    poetry run python testing/gz_entity_watch.py find 50

Why this exists rather than a fix.

`Physics.cc:2967` says an entity id, and nothing else. The id is the one fact
that identifies the fault, and it is the one fact the message does not
translate: gz-sim assigns ids sequentially at world load, so [50] is some
specific link, collision or joint that was there and then was not. Whether it
is the reusable "object" model, a link inside it, or the *joint* the
DetachableJoint system creates and removes on every attach/detach changes the
fix completely — and guessing between those three is exactly how the last
version of this bug ate a day.

The world-state topic carries every entity's id together with its name, which
is the mapping the error message is missing. A snapshot taken while the entity
still exists therefore answers "what is 50", and a diff across the triggering
step answers "when did it go".

Read-only. It publishes nothing and removes nothing, so it is safe to run
against a live cell with the physical arm connected.
"""
import json
import os
import re
import subprocess
import sys

WORLD = os.environ.get("GZ_WORLD", "worldCobotta")
OUT_DIR = os.path.join(os.path.dirname(__file__), "out", "gz_entities")


def _run(cmd: str, timeout: int = 15) -> str:
    try:
        return subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        ).stdout
    except subprocess.TimeoutExpired:
        return ""


def read_entities() -> dict:
    """entity id -> name, for every entity in the world.

    Uses the world's own state topic, which carries id and name together. The
    `gz model` CLI can only be asked about one model at a time and never lists
    the joints the DetachableJoint system creates, which are the entities most
    likely to be the answer here.
    """
    raw = _run(
        f"gz topic -e -t /world/{WORLD}/state --json-output -n 1", timeout=20
    )
    entities: dict[str, str] = {}
    if raw.strip().startswith("{"):
        try:
            state = json.loads(raw)
        except json.JSONDecodeError:
            state = None
        if state:
            for entity in _walk_entities(state):
                ent_id = str(entity.get("id", ""))
                name = _name_of(entity)
                if ent_id:
                    entities[ent_id] = name or "(unnamed)"
            if entities:
                return entities

    # Text fallback: the same topic without --json-output prints
    # `entity { id: 50 ... components { ... name ... } }` blocks.
    raw = raw or _run(f"gz topic -e -t /world/{WORLD}/state -n 1", timeout=20)
    for block in re.split(r"\bentity\s*\{", raw)[1:]:
        ent_id = re.search(r"\bid:\s*(\d+)", block)
        name = re.search(r'name:\s*"([^"]*)"', block)
        if ent_id:
            entities[ent_id.group(1)] = name.group(1) if name else "(unnamed)"
    return entities


def _walk_entities(node):
    """Every dict carrying an `id`, at any depth — the JSON shape of the state
    message nests entities under keys that differ between gz versions."""
    if isinstance(node, list):
        for child in node:
            yield from _walk_entities(child)
        return
    if not isinstance(node, dict):
        return
    if "id" in node:
        yield node
    for child in node.values():
        yield from _walk_entities(child)


def _name_of(entity: dict) -> str:
    for component in _walk_entities(entity):
        for key in ("name", "component"):
            value = component.get(key)
            if isinstance(value, str) and value:
                return value
    return ""


def snapshot(label: str) -> None:
    entities = read_entities()
    if not entities:
        sys.exit(
            f"Nessuna entita' letta da /world/{WORLD}/state.\n"
            "La simulazione e' avviata? Serve l'ambiente ROS sorgato:\n"
            "  source /opt/ros/jazzy/setup.bash\n"
            "Se il mondo ha un altro nome: GZ_WORLD=<nome> ..."
        )
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{label}.json")
    with open(path, "w") as handle:
        json.dump(entities, handle, indent=2, sort_keys=True)
    print(f"{len(entities)} entita' -> {path}")


def find(entity_id: str) -> None:
    entities = read_entities()
    name = entities.get(str(entity_id))
    if name:
        print(f"entita' {entity_id} = {name!r} (ESISTE ancora)")
    else:
        print(f"entita' {entity_id}: NON esiste piu' nel mondo.")
        print("Cercala in uno snapshot precedente:")
        for label in sorted(os.listdir(OUT_DIR)) if os.path.isdir(OUT_DIR) else []:
            with open(os.path.join(OUT_DIR, label)) as handle:
                was = json.load(handle).get(str(entity_id))
            if was:
                print(f"  {label}: era {was!r}")


def diff(before_label: str, after_label: str) -> None:
    def _load(label):
        with open(os.path.join(OUT_DIR, f"{label}.json")) as handle:
            return json.load(handle)

    before, after = _load(before_label), _load(after_label)
    gone = {k: v for k, v in before.items() if k not in after}
    new = {k: v for k, v in after.items() if k not in before}

    print(f"\nSPARITE ({len(gone)}) — una di queste e' l'id nell'errore:")
    for ent_id, name in sorted(gone.items(), key=lambda kv: int(kv[0])):
        print(f"  {ent_id:>6}  {name}")
    print(f"\nNUOVE ({len(new)}):")
    for ent_id, name in sorted(new.items(), key=lambda kv: int(kv[0])):
        print(f"  {ent_id:>6}  {name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    command = sys.argv[1]
    if command == "snapshot" and len(sys.argv) == 3:
        snapshot(sys.argv[2])
    elif command == "find" and len(sys.argv) == 3:
        find(sys.argv[2])
    elif command == "diff" and len(sys.argv) == 4:
        diff(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
