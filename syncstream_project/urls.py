from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rooms import views as room_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', room_views.home, name='home'),
    path('rooms/', include('rooms.urls', namespace='rooms')),
    path('accounts/', include('django.contrib.auth.urls')),
    path('accounts/', include('users.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)