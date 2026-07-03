#!/usr/bin/env python3
"""Bring-up for the Cobotta digital twin: Gazebo Harmonic + ros2_control.

gz sim + robot_state_publisher + ros_gz_bridge (clock/camera) + controller spawners
+ the Flask/SocketIO app nodes. Source /opt/ros/jazzy/setup.bash and the workspace
install/setup.bash, then: ros2 launch .../cobotta_ros2_control.launch.py
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

COB_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))  # ros2_ws/Cobotta


def _spawner(name, timeout=40):
    return Node(
        package="controller_manager",
        executable="spawner",
        arguments=[name, "--controller-manager", "/controller_manager",
                   "--controller-manager-timeout", str(timeout)],
        output="screen",
    )


def _setup(context, *args, **kwargs):
    ctrl_yaml = os.path.join(
        get_package_share_directory("cobotta_rest_api"), "config", "controllers.yaml")

    # Substitute the @CONTROLLERS_YAML@ token into a generated copy of the model.
    gen_dir = os.path.join(COB_DIR, ".gen")
    os.makedirs(gen_dir, exist_ok=True)
    with open(os.path.join(COB_DIR, "Cobotta.sdf")) as f:
        sdf = f.read()
    with open(os.path.join(gen_dir, "Cobotta.sdf"), "w") as f:
        f.write(sdf.replace("@CONTROLLERS_YAML@", ctrl_yaml))

    # .gen first (substituted model://Cobotta.sdf), then COB_DIR (meshes, world).
    res_path = os.pathsep.join(
        [gen_dir, COB_DIR, os.environ.get("GZ_SIM_RESOURCE_PATH", "")])
    plugin_path = os.pathsep.join(
        ["/opt/ros/jazzy/lib", os.environ.get("GZ_SIM_SYSTEM_PLUGIN_PATH", "")])
    gz_env = dict(os.environ,
                  GZ_SIM_RESOURCE_PATH=res_path,
                  GZ_SIM_SYSTEM_PLUGIN_PATH=plugin_path)

    with open(os.path.join(COB_DIR, "urdf", "cobotta_ik.urdf")) as f:
        robot_description = f.read()

    gz = ExecuteProcess(
        cmd=["gz", "sim", "-s", "-r", "--headless-rendering",
             os.path.join(COB_DIR, "worldCobotta.sdf")],
        additional_env=gz_env, output="screen")

    rsp = Node(
        package="robot_state_publisher", executable="robot_state_publisher",
        parameters=[{"use_sim_time": True, "robot_description": robot_description}],
        output="screen")

    bridge = Node(
        package="ros_gz_bridge", executable="parameter_bridge",
        arguments=["--ros-args", "-p",
                   "config_file:=" + os.path.join(COB_DIR, "map_ros2_control.yaml")],
        output="screen")

    # Flask REST bridge (:5000, holds BridgeNodeROS) + SocketIO (:5001) + camera
    # stream (:8080).
    flask = Node(package="cobotta_rest_api", executable="flask_node", output="screen")
    polling = Node(package="cobotta_rest_api", executable="polling_socket_node",
                   output="screen")
    web_video = Node(package="web_video_server", executable="web_video_server",
                     output="screen")

    nodes = [
        gz, rsp, bridge,
        _spawner("joint_state_broadcaster"),
        _spawner("arm_controller"),
        _spawner("gripper_controller"),
        flask, polling, web_video,
    ]

    # hardware:=true also drives the real Cobotta over b-CAP alongside the twin.
    if LaunchConfiguration("hardware").perform(context).lower() in ("1", "true", "yes"):
        nodes.append(Node(
            package="cobotta_rest_api", executable="cobotta_node", output="screen",
            parameters=[{
                "enable_hardware": True,
                "bcap_host": LaunchConfiguration("bcap_host").perform(context),
                "bcap_port": int(LaunchConfiguration("bcap_port").perform(context)),
                "bcap_provider": LaunchConfiguration("bcap_provider").perform(context),
                "ext_speed": int(LaunchConfiguration("ext_speed").perform(context)),
            }]))

    # vision:=true starts YOLO object detection. Run via `poetry run python <file>`,
    # NOT `ros2 run` / Node(executable=...): ultralytics + mediapipe live in the Poetry
    # env, so the ROS system python ImportErrors them (see CLAUDE.md).
    if LaunchConfiguration("vision").perform(context).lower() in ("1", "true", "yes"):
        proj_root = os.path.dirname(os.path.dirname(COB_DIR))  # ros2_ws/Cobotta -> repo root
        vision_py = os.path.join(
            proj_root, "ros2_ws", "src", "cobotta_rest_api", "cobotta_rest_api", "vision_node.py")
        nodes.append(ExecuteProcess(
            cmd=["poetry", "run", "python", vision_py, "--ros-args",
                 "-p", "camera_source:=" + LaunchConfiguration("camera_source").perform(context),
                 "-p", "camera_user:=" + LaunchConfiguration("camera_user").perform(context),
                 "-p", "camera_pass:=" + LaunchConfiguration("camera_pass").perform(context),
                 "-p", "camera_fallback:=" + LaunchConfiguration("camera_fallback").perform(context)],
            cwd=proj_root, output="screen"))
    return nodes


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument("hardware", default_value="false"),
        DeclareLaunchArgument("bcap_host", default_value="192.168.0.1"),
        DeclareLaunchArgument("bcap_port", default_value="5007"),
        # VRC works for the real RC8/COBOTTA over b-CAP; the RC8 provider errors
        # E_INVALIDARG at controller_connect (verified on hardware).
        DeclareLaunchArgument("bcap_provider", default_value="CaoProv.DENSO.VRC"),
        DeclareLaunchArgument("ext_speed", default_value="20"),
        DeclareLaunchArgument("vision", default_value="false"),
        DeclareLaunchArgument("camera_source",
                              default_value="http://192.168.0.90/-wvhttp-01-/image.cgi"),
        DeclareLaunchArgument("camera_user", default_value="admin"),
        DeclareLaunchArgument("camera_pass", default_value="password"),
        # Auto-fallback if the Canon keeps failing (e.g. USB webcam "0"); "" disables.
        DeclareLaunchArgument("camera_fallback", default_value="0"),
        OpaqueFunction(function=_setup),
    ])
