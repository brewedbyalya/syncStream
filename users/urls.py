from django.urls import path
from . import views

urlpatterns = [
    path('signup/', views.signup, name='signup'),
    path('profile/', views.profile, name='profile'),
    path('profile/edit/', views.profile_edit, name='profile_edit'),
    path('logout/', views.custom_logout, name='logout'),
    path('api/online-status/', views.online_status_api, name='online_status_api'),
]