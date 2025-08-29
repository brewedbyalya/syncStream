from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.create_room, name='create_room'),
    path('my-rooms/', views.user_rooms, name='user_rooms'),
    path('<uuid:room_id>/', views.room_detail, name='room_detail'),
    path('<uuid:room_id>/edit/', views.edit_room, name='edit_room'),
    path('<uuid:room_id>/delete/', views.delete_room, name='delete_room'),
    path('<uuid:room_id>/restore/', views.restore_room, name='restore_room'),
    path('<uuid:room_id>/leave/', views.leave_room, name='leave_room'),
]