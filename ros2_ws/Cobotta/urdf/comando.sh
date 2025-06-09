#!/bin/bash
source /opt/ros/humble/setup.bash
ros2 launch launch/display.launch.py rvizconfig:=/home/thomas/git/Cobotta/urdf/launch/rviz/urdf.rviz model:=/home/thomas/git/Cobotta/urdf/Cobotta.urdf 
