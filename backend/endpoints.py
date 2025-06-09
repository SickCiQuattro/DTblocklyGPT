from django.urls import path, re_path
from django.conf import settings
from django.views.static import serve
from django.views.generic import TemplateView
from .functions.auth import login_func, logout_func, verify_token, change_password

from .functions.libraries import (
    get_task_list,
    task_detail,
    get_object_list,
    object_detail,
    get_location_list,
    location_detail,
    get_action_list,
    action_detail,
    get_my_robot_list,
    my_robot_detail,
)

from .functions.management import (
    get_robot_list,
    robot_detail,
    get_user_list,
    user_detail,
    get_group_list,
    reset_password,
)
from .functions.robot import (
    get_cartesian_position,
    get_joint_position,
    ping_ip,
    get_photo,
)

from .functions.chat import (
    new_message,
    save_chat_task,
)

from .functions.graphic import (
    save_graphic_task,
    get_graphic_task,
    get_action_graphic_list,
    get_location_graphic_list,
    get_object_graphic_list,
)

from .functions.task import run_task
from .functions.simulate import simulate_task


API = "api/"
AUTH = API + "auth/"
HOME = API + "home/"
GRAPHIC = API + "graphic/"
CHAT = API + "chat/"
TASK = API + "task/"


urlpatterns = [
    # AUTH
    path(AUTH + "login/", login_func, name="login_func"),
    path(AUTH + "logout/", logout_func, name="logout_func"),
    path(AUTH + "verifyToken/", verify_token, name="verify_token"),
    path(HOME + "changePassword/", change_password, name="change_password"),
    # LIBRARIES
    path(HOME + "tasks/", get_task_list, name="get_task_list"),
    path(HOME + "task/", task_detail, name="task_detail"),
    path(HOME + "objects/", get_object_list, name="get_object_list"),
    path(HOME + "object/", object_detail, name="object_detail"),
    path(HOME + "locations/", get_location_list, name="get_location_list"),
    path(HOME + "location/", location_detail, name="location_detail"),
    path(HOME + "actions/", get_action_list, name="get_action_list"),
    path(HOME + "action/", action_detail, name="action_detail"),
    path(HOME + "myRobots/", get_my_robot_list, name="get_my_robot_list"),
    path(HOME + "myRobot/", my_robot_detail, name="my_robot_detail"),
    path(
        HOME + "getCartesianPosition/",
        get_cartesian_position,
        name="get_cartesian_position",
    ),
    path(
        HOME + "getJointPosition/",
        get_joint_position,
        name="get_joint_position",
    ),
    path(HOME + "getPhoto/", get_photo, name="get_photo"),
    path(HOME + "pingIp/", ping_ip, name="ping_ip"),
    # MANAGEMENT
    path(HOME + "robots/", get_robot_list, name="get_robot_list"),
    path(HOME + "robot/", robot_detail, name="robot_detail"),
    path(HOME + "users/", get_user_list, name="get_user_list"),
    path(HOME + "user/", user_detail, name="user_detail"),
    path(HOME + "resetPassword/", reset_password, name="reset_password"),
    path(HOME + "groups/", get_group_list, name="get_group_list"),
    # CHAT
    path(CHAT + "newMessage/", new_message, name="new_message"),
    path(
        CHAT + "saveChatTask/",
        save_chat_task,
        name="save_chat_task",
    ),
    # GRAPHIC
    path(
        GRAPHIC + "saveGraphicTask/",
        save_graphic_task,
        name="save_graphic_task",
    ),
    path(
        GRAPHIC + "getGraphicTask/",
        get_graphic_task,
        name="get_graphic_task",
    ),
    path(
        GRAPHIC + "objectsGraphic/",
        get_object_graphic_list,
        name="get_object_graphic_list",
    ),
    path(
        GRAPHIC + "locationsGraphic/",
        get_location_graphic_list,
        name="get_location_graphic_list",
    ),
    path(
        GRAPHIC + "actionsGraphic/",
        get_action_graphic_list,
        name="get_action_graphic_list",
    ),
    # TASK
    path(TASK + "run/", run_task, name="run_task"),
    path(TASK + "simulate/", simulate_task, name="simulate_task"),
    # Views
    re_path(r"^static/(?P<path>.*)$", serve, {"document_root": settings.STATIC_ROOT}),
    re_path(r"^.*$", TemplateView.as_view(template_name="base.html")),
]
