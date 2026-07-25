from django.db import models
from django.conf import settings
from django.db.models import CharField
from django_mysql.models import ListCharField
from django.utils.timezone import now
import json


# ─── Schema update workflow ─────────────────────
# poetry run python manage.py makemigrations backend --name <name>
# poetry run python manage.py migrate backend


class Action(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING)
    shared = models.BooleanField(default=False)
    speed = models.IntegerField(default=1)
    pattern = models.CharField(
        max_length=1,
        choices=(("C", "Circular"), ("X", "Cross"), ("L", "Linear")),
        default=None,
        null=True,
        blank=True,
    )
    points = models.TextField(default=None, null=True, editable=True, blank=True)
    keywords = ListCharField(
        base_field=CharField(max_length=50),
        size=20,
        max_length=1019,
        default=None,
        null=True,
        blank=True,
    )

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "owner":
                response_data[key] = self.owner
            elif key == "shared":
                response_data[key] = self.shared
            elif key == "speed":
                response_data[key] = self.speed
            elif key == "points":
                response_data[key] = self.points
            elif key == "pattern":
                response_data[key] = self.pattern
            elif key == "keywords":
                response_data[key] = self.keywords
        return response_data

    @property
    def points_array(self):
        if self.points:
            return json.loads(self.points)
        return []

    @points_array.setter
    def points_array(self, value):
        self.points = json.dumps(value)


class Object(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING)
    shared = models.BooleanField(default=False)
    photo = models.TextField(default=None, null=True, editable=True, blank=True)
    contour = models.TextField(default=None, null=True, editable=True, blank=True)
    shape = models.TextField(default=None, null=True, editable=True, blank=True)
    force = models.IntegerField(default=1)
    height = models.FloatField(default=0.00)
    keywords = ListCharField(
        base_field=CharField(max_length=50),
        size=20,
        max_length=1019,
        default=None,
        null=True,
        blank=True,
    )
    obj_length = models.IntegerField(default=None, null=True, blank=True)
    obj_width = models.IntegerField(default=None, null=True, blank=True)
    weight = models.IntegerField(default=None, null=True, blank=True)

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "owner":
                response_data[key] = self.owner
            elif key == "shared":
                response_data[key] = self.shared
            elif key == "photo":
                response_data[key] = self.photo
            elif key == "contour":
                response_data[key] = self.contour
            elif key == "shape":
                response_data[key] = self.shape
            elif key == "height":
                response_data[key] = self.height
            elif key == "force":
                response_data[key] = self.force
            elif key == "keywords":
                response_data[key] = self.keywords
            elif key == "obj_length":
                response_data[key] = self.obj_length
            elif key == "obj_width":
                response_data[key] = self.obj_width
            elif key == "weight":
                response_data[key] = self.weight
        return response_data


class Location(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING)
    shared = models.BooleanField(default=False)
    position = models.JSONField(default=dict, null=True, editable=True, blank=True)
    keywords = ListCharField(
        base_field=CharField(max_length=50),
        size=20,
        max_length=1019,
        default=None,
        null=True,
        blank=True,
    )

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "owner":
                response_data[key] = self.owner
            elif key == "shared":
                response_data[key] = self.shared
            elif key == "position":
                response_data[key] = self.position
            elif key == "keywords":
                response_data[key] = self.keywords
        return response_data


# ─── Constants lifecycle ───────────────────────────────────────────────────────

TASK_TYPE_TASK = "task"
TASK_TYPE_MACRO = "macro_task"

TASK_TYPE_CHOICES = [
    (TASK_TYPE_TASK, "Task"),
    (TASK_TYPE_MACRO, "Macro Task"),
]

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
STATUS_PUBLISHED_WITH_DRAFT = "published_with_draft"

STATUS_CHOICES = [
    (STATUS_DRAFT, "Draft"),
    (STATUS_PUBLISHED, "Published"),
    (STATUS_PUBLISHED_WITH_DRAFT, "Published with Draft"),
]


class Task(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=200)
    code = models.TextField(default=None, null=True, editable=True, blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING)
    description = models.CharField(max_length=200, default=None, null=True, blank=True)
    last_modified = models.DateTimeField(default=now)
    shared = models.BooleanField(default=False)

    task_type = models.CharField(
        max_length=20,
        choices=TASK_TYPE_CHOICES,
        default=TASK_TYPE_TASK,
    )
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
    )

    # Legacy workspace field (pre-lifecycle). Kept for backward compatibility.
    # Read path fallback only: draft_workspace > published_workspace > workspace > loads(code)
    workspace = models.JSONField(null=True, blank=True)

    # Immutable snapshot of the last published version (all task types)
    # Written by publish_task. Used as the stable source for toolbox preview
    # and block explosion (break-into-steps).
    published_workspace = models.JSONField(null=True, blank=True)

    # Isolated working draft (all task types)
    # Written by save_draft. Cleared on publish or discard.
    # When set, status transitions to published_with_draft.
    draft_workspace = models.JSONField(null=True, blank=True)

    # SHA-256 (16 char hex) of the serialized published_workspace.
    # Used to detect mismatches in referenced macro_task_block blocks.
    signature = models.CharField(max_length=64, blank=True, default="")

    # List of IDs (int) of the tasks this task directly depends on.
    # Verified 2026-07-24/25 (docs/analisi-sistema/p2-2-ciclo-vita-task.md): dead field.
    # publish_task() (task_lifecycle.py) never writes it — only seed_library.py
    # sets it, always to []. Nothing reads it except to_dict() echoing it back
    # to the API response. No DAG check exists anywhere (see the
    # accepted_response()/conflict_response() correction in CLAUDE.md); this
    # comment used to claim otherwise.
    dependencies = models.JSONField(default=list, blank=True)

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "code":
                response_data[key] = self.code
            elif key == "owner":
                response_data[key] = self.owner
            elif key == "description":
                response_data[key] = self.description
            elif key == "last_modified":
                response_data[key] = self.last_modified
            elif key == "shared":
                response_data[key] = self.shared
            elif key == "task_type":
                response_data[key] = self.task_type
            elif key == "status":
                response_data[key] = self.status
            elif key == "workspace":
                response_data[key] = self.workspace
            elif key == "published_workspace":
                response_data[key] = self.published_workspace
            elif key == "draft_workspace":
                response_data[key] = self.draft_workspace
            elif key == "signature":
                response_data[key] = self.signature
            elif key == "dependencies":
                response_data[key] = self.dependencies
        return response_data

    @property
    def effective_workspace(self):
        """
        Unified read path: returns the workspace as a dict.
        Uses workspace if set, otherwise deserializes code (legacy).
        """
        if self.workspace is not None:
            return self.workspace
        if self.code:
            try:
                return json.loads(self.code)
            except (json.JSONDecodeError, TypeError):
                return None
        return None

    @property
    def is_macro(self):
        return self.task_type == TASK_TYPE_MACRO

    @property
    def is_published(self):
        return self.status in (STATUS_PUBLISHED, STATUS_PUBLISHED_WITH_DRAFT)

    class Meta:
        ordering = ["-last_modified"]


class Robot(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=100)
    ip = models.GenericIPAddressField()
    model = models.CharField(max_length=1, choices=(("C", "Cobotta"), ("V", "VS-060")))
    port = models.IntegerField(default=0)
    cameraip = models.GenericIPAddressField(default=0)
    max_load = models.IntegerField(default=None, null=True, blank=True)
    max_open_tool = models.IntegerField(default=None, null=True, blank=True)

    class Meta:
        verbose_name_plural = "Robots"

    def __str__(self):
        return self.name

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "ip":
                response_data[key] = self.ip
            elif key == "model":
                response_data[key] = self.model
            elif key == "port":
                response_data[key] = self.port
            elif key == "cameraip":
                response_data[key] = self.cameraip
            elif key == "max_load":
                response_data[key] = self.max_load
            elif key == "max_open_tool":
                response_data[key] = self.max_open_tool
        return response_data


class UserRobot(models.Model):
    id = models.AutoField(primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    robot = models.ForeignKey(Robot, on_delete=models.CASCADE)

    class Meta:
        verbose_name_plural = "UserRobots"

    def __str__(self):
        return self.name

    def to_dict(self, keys):
        response_data = {}
        for key in keys:
            if key == "id":
                response_data[key] = self.id
            elif key == "name":
                response_data[key] = self.name
            elif key == "user":
                response_data[key] = self.user
            elif key == "robot":
                response_data[key] = self.robot.id
        return response_data
