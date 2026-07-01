from django.db import migrations
import json


OLD = "Select Routine"
NEW = "Select Skill"


def rename_routine_placeholder(apps, schema_editor):
    """Rewrite the serialized shadow-placeholder label in saved workspaces.

    The action shadow block stores its prompt text via ``field_label_serializable``,
    so tasks saved before the Routine->Skill rename keep the old
    ``"Select Routine..."`` text baked into their workspace JSON. This replaces it
    with ``"Select Skill..."`` across all workspace fields (and legacy ``code``),
    recomputing the published signature only when ``published_workspace`` changes.
    """
    Task = apps.get_model("backend", "Task")
    from backend.utils.signature import build_task_signature

    json_fields = ("workspace", "published_workspace", "draft_workspace")
    to_update = []

    for task in Task.objects.all():
        changed = False
        pub_changed = False

        for field in json_fields:
            value = getattr(task, field)
            if value is None:
                continue
            dumped = json.dumps(value)
            if OLD in dumped:
                setattr(task, field, json.loads(dumped.replace(OLD, NEW)))
                changed = True
                if field == "published_workspace":
                    pub_changed = True

        if task.code and OLD in task.code:
            task.code = task.code.replace(OLD, NEW)
            changed = True

        if pub_changed and task.published_workspace is not None:
            task.signature = build_task_signature(task.published_workspace)

        if changed:
            to_update.append(task)

    if to_update:
        Task.objects.bulk_update(
            to_update,
            ["workspace", "published_workspace", "draft_workspace", "code", "signature"],
            batch_size=200,
        )


def reverse(apps, schema_editor):
    # No-op: not worth reversing a cosmetic label rename.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0003_migrate_code_to_workspace"),
    ]

    operations = [
        migrations.RunPython(rename_routine_placeholder, reverse),
    ]
