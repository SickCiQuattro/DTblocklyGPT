# RunCobottaBridge.ps1
# Questo script esegue il nodo ros_gz_bridge del robot Cobotta dentro WSL

# Percorso del setup ROS2 (modifica se la tua distro è diversa da jazzy)
$rosSetup = "/opt/ros/jazzy/setup.bash"

# Percorso del workspace Cobotta dentro WSL
$workspacePath = "/mnt/c/repos/DTblocklyGPT-jazzy-harmonic/ros2_ws/cobotta"

# Percorso del file di configurazione
$configFile = "../Cobotta/map.yaml"

# Comando completo da eseguire dentro WSL
$wslCommand = "source $rosSetup && cd $workspacePath && source ../install/setup.bash && ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=$configFile"

Write-Host "Avvio del nodo ros_gz_bridge dentro WSL..." -ForegroundColor Cyan

# Esegui il comando dentro WSL usando bash
wsl bash -c "$wslCommand"
