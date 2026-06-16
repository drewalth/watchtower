"""Django settings for the Watchtower project.

All deployment-specific values (DB credentials, secret key, the FIRMS API key)
are read from environment variables so nothing secret lives in the repo.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get(
    "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0"
).split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # GeoDjango — gives us spatial model fields, spatial lookups and the
    # admin map widgets.
    "django.contrib.gis",
    # Frontend: serves the Vite-built React bundle (dev server in DEBUG,
    # hashed manifest assets in production).
    "django_vite",
    "towers",
]
if DEBUG:
    # Browser live-reload — dev only. Its AppConfig.ready() registers autoreload
    # signal receivers that are dead weight under gunicorn, so keep the app out
    # of production entirely (the matching middleware is gated below too).
    INSTALLED_APPS.append("django_browser_reload")

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves the collected static bundle when DEBUG=0. Must sit
    # directly after SecurityMiddleware and before everything else.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if DEBUG:
    # Reloads the browser when templates/static/Python change (dev only).
    MIDDLEWARE.append("django_browser_reload.middleware.BrowserReloadMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
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

WSGI_APPLICATION = "config.wsgi.application"

# PostGIS-backed database. The gis backend is what lets GeoDjango emit spatial
# SQL against PostGIS.
DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": os.environ.get("POSTGRES_DB", "watchtower"),
        "USER": os.environ.get("POSTGRES_USER", "watchtower"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "watchtower"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

# NASA FIRMS satellite fire data API key. Read from env only; the Phase 2
# ingest command fails with a friendly message if it's missing.
FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "")

# This is a single-user learning/portfolio project with no public sign-up, so
# we keep the auth machinery minimal.
AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# collectstatic target — what WhiteNoise serves in production (DEBUG=0).
# Must be distinct from STATICFILES_DIRS below.
STATIC_ROOT = BASE_DIR / "staticfiles"
# Vite writes its built bundle + manifest here; also where collectstatic looks.
STATICFILES_DIRS = [BASE_DIR / "static"]

# Django 5.2 STORAGES dict (do NOT also set the legacy STATICFILES_STORAGE).
# Use WhiteNoise's COMPRESSED (non-manifest) backend: Vite already
# content-hashes filenames, and the Manifest variant's reference-rewriting
# crashes collectstatic on Vite's source-map references.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

# django-vite: in DEBUG, assets load from the Vite dev server (with HMR) on
# :5173; otherwise they're resolved from the hashed build manifest.
DJANGO_VITE = {
    "default": {
        "dev_mode": DEBUG,
        "manifest_path": BASE_DIR / "static" / ".vite" / "manifest.json",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
