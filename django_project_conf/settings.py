from os import path, getenv
from dotenv import load_dotenv

load_dotenv("./frontend/.env")
load_dotenv("./backend/.env")

FRONTEND = (
    getenv("VITE_FRONTEND_PROTOCOL", "")
    + getenv("VITE_FRONTEND_HOST", "")
    + getenv("VITE_FRONTEND_PORT", "")
)

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
BASE_DIR = path.dirname(path.dirname(path.abspath(__file__)))

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = "pe=ipw6q4g-2d+*7n76g70c#ps+!n=i3-d91i^l9adjh@o)8+!"

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",  # Core authentication framework and its default models.
    "django.contrib.contenttypes",  # Django content type system (allows permissions to be associated with models).
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.admindocs",
    "corsheaders",
    "django_mysql",
    "backend.apps.ConfigApp",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",  # Manages sessions across requests
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",  # Protection against Cross Site Request Forgeries attack
    "django.contrib.auth.middleware.AuthenticationMiddleware",  # Associates users with requests using sessions.
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "django_project_conf.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [path.join(BASE_DIR, "frontend/dist")],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "django_project_conf.wsgi.application"

# Database

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": path.join(BASE_DIR, "db.sqlite3"),
    }
}

# Password validation

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

# Redirect to home URL after login (Default redirects to /accounts/profile/)
LOGIN_REDIRECT_URL = "/"

LOGIN_URL = "/"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
}

# These are the settings you should have for everything to work properly.
# Add these to your main settings.py file, or modify it accordingly.

# Needed for production. Avoid using '*'.
ALLOWED_HOSTS = ["*"]

# Needed for 'debug' to be available inside templates.
# https://docs.djangoproject.com/en/3.2/ref/templates/api/#django-template-context-processors-debug
INTERNAL_IPS = ["127.0.0.1"]

# Vite App Dir: point it to the folder your vite App is in.
VITE_APP_DIR = path.join(BASE_DIR, "frontend")

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/3.1/howto/static-files/

# You may change these, but it's important that the dist folder is includedself.
# If it's not, collectstatic won't copy your bundle to production.

STATIC_URL = "/static/"
STATICFILES_DIRS = [
    path.join(VITE_APP_DIR, "dist"),
]
STATIC_ROOT = path.join(BASE_DIR, "staticfiles")

# Add the following lines at the end of the settings.py file
CORS_ALLOW_ALL_ORIGINS = True
# CORS_ALLOWED_ORIGINS = [
#     REMOTE_MACHINE,  # Replace with the actual origin of your frontend application
# ]

# CORS_ORIGIN_WHITELIST = [
#     REMOTE_MACHINE, # Replace with the actual origin of your frontend application
# ]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    "content-type",
    "X-CSRFToken",
    # Add any other headers you need to allow
]


CSRF_TRUSTED_ORIGINS = [FRONTEND]

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    # Add any additional authentication backends here
]

USE_TZ = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024 * 50  # 50MB
