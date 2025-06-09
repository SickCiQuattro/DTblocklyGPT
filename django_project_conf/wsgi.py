from os import environ
from django.core.wsgi import get_wsgi_application

environ.setdefault("DJANGO_SETTINGS_MODULE", "django_project_conf.settings")

application = get_wsgi_application()
