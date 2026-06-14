from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # Browser live-reload endpoint (no-op outside DEBUG).
    path("__reload__/", include("django_browser_reload.urls")),
    path("", include("towers.urls")),
]
