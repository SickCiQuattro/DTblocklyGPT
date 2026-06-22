# ros2_ws/src

> **Full setup guide is in the project root [`README.md`](../../README.md).**
>
> This directory contains three ROS2 packages:
>
> | Package | Description |
> |---|---|
> | `cobotta_rest_api` | All ROS2 nodes: `flask_node`, `gazebo_command_node`, `gazebo_state_node`, `polling_socket_node`, `vision_node` |
> | `my_robot_interfaces` | Custom ROS2 message/service definitions |
> | `async_web_server_cpp` | C++ async HTTP server (dependency of `web_video_server`) — **clone separately** |
> | `web_video_server` | Camera stream server on `:8080` — **clone separately** |
>
> ## Cloning the streaming packages
>
> `async_web_server_cpp` and `web_video_server` are not tracked in this repository.
> Clone them into this directory before running `colcon build`:
>
> ```bash
> cd ros2_ws/src
> git clone https://github.com/fkie/async_web_server_cpp.git
> git clone https://github.com/RobotWebTools/web_video_server.git
> ```
>
> ## Node launch order
>
> When starting manually (not via `launch_sim.sh`):
>
> ```bash
> # Each in its own terminal, after sourcing:
> # source /opt/ros/jazzy/setup.bash && cd ros2_ws && source .venv/bin/activate && source install/setup.bash
>
> ros2 run cobotta_rest_api flask_node
> ros2 run cobotta_rest_api gazebo_command_node
> ros2 run cobotta_rest_api gazebo_state_node
> ros2 run cobotta_rest_api polling_socket_node
>
> # vision_node requires the Poetry environment:
> poetry run ros2 run cobotta_rest_api vision_node
> ```
>
> Or use `launch_sim.sh` (in `ros2_ws/Cobotta/`) to start everything at once.
