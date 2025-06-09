from json import loads


def get_or_default(value: any, default: any = ""):
    return default if value is None else value


def is_json(myjson):
    try:
        loads(myjson)
    except ValueError:
        return False
    return True
