from pytz import timezone
from datetime import datetime


def getDateTimeNow():
    tmz = timezone("Europe/Rome")
    date = tmz.localize(datetime.now())
    date.strftime("%H:%M %d-%m-%Y")
    return date
