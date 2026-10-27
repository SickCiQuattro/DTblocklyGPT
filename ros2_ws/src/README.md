# ros2_ws/src

Setup and run instructions are in the [root README](../../README.md).

| Package | Content |
|---|---|
| `cobotta_rest_api` | Nodes: `flask_node`, `cobotta_node`, `polling_socket_node`, `vision_node` |
| `my_robot_interfaces` | Custom messages and services |
| `async_web_server_cpp` | HTTP server used by `web_video_server`. **Not tracked: clone it.** |
| `web_video_server` | Camera stream on `:8080`. **Not tracked: clone it.** |

Clone the two untracked packages here before `colcon build`:

```bash
git clone https://github.com/fkie/async_web_server_cpp.git
git clone https://github.com/RobotWebTools/web_video_server.git
```
