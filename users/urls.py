from django.urls import path
from . import views

urlpatterns = [
    path('signup/', views.signup, name='signup'),
    path('profile/', views.profile, name='profile'),
    path('profile/<str:username>/', views.view_profile, name='view_profile'),
    path('profile/edit/', views.profile_edit, name='profile_edit'),
    path('logout/', views.custom_logout, name='logout'),
]