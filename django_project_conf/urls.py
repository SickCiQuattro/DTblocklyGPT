from django.contrib import admin
from django.urls import include, path
from functions import graphic

urlpatterns = [
    path("admin/doc/", include("django.contrib.admindocs.urls")),
    path("admin/", admin.site.urls),
    path("", include("backend.endpoints")),
    path("graphic/macroList/", graphic.get_macro_list),

]
