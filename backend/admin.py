from django.contrib import admin
from .models import Action, Task, Object, Robot, UserRobot, Location


class ActionOption(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "owner",
        "speed",
        "shared",
        "pattern",
        "keywords",
        "points",
    )


class TaskOption(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "code",
        "owner",
        "description",
        "last_modified",
        "shared",
    )


class ObjectOption(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "owner",
        "shared",
        "photo",
        "contour",
        "shape",
        "force",
        "height",
        "keywords",
    )


class RobotOption(admin.ModelAdmin):
    list_display = ("id", "name", "ip", "model", "port", "cameraip")


class UserRobotOption(admin.ModelAdmin):
    list_display = ("id", "user", "name", "robot")


class LocationOption(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "owner",
        "position",
        "shared",
        "keywords",
    )


admin.site.register(Action, ActionOption)
admin.site.register(Task, TaskOption)
admin.site.register(Object, ObjectOption)
admin.site.register(Robot, RobotOption)
admin.site.register(UserRobot, UserRobotOption)
admin.site.register(Location, LocationOption)
