import subprocess


def start():
    cmd = ["poetry", "run", "python", "manage.py", "runserver", "0.0.0.0:8000"]
    subprocess.run(cmd)


def collectstatic():
    cmd = ["poetry", "run", "python", "manage.py", "collectstatic"]
    subprocess.run(cmd)


def poetryup():
    cmd = ["poetry", "run", "poetry", "up", "--latest"]
    subprocess.run(cmd)


def migrate():
    cmd = ["poetry", "run", "python", "manage.py", "migrate"]
    subprocess.run(cmd)


def makemigrations():
    cmd = ["poetry", "run", "python", "manage.py", "makemigrations"]
    subprocess.run(cmd)
