from django.db import migrations
import json


def migrate_code_to_workspace(apps, schema_editor):
    Task = apps.get_model("backend", "Task")
    tasks_to_update = []

    for task in Task.objects.all():
        ws = None
        if task.code:
            try:
                ws = json.loads(task.code)
            except (json.JSONDecodeError, TypeError):
                ws = None

        task.workspace = ws
        task.status = "published" if ws is not None else "draft"
        task.task_type = "task"
        tasks_to_update.append(task)

    # bulk_update in batch per performance su DB grandi
    Task.objects.bulk_update(
        tasks_to_update,
        ["workspace", "status", "task_type"],
        batch_size=200,
    )


def reverse_migrate(apps, schema_editor):
    # Reversione: niente da fare, code è invariato
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0002_add_task_lifecycle_fields"),
    ]

    operations = [
        migrations.RunPython(migrate_code_to_workspace, reverse_migrate),
    ]