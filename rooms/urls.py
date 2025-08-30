from django.urls import path
from . import views

app_name = 'rooms'

urlpatterns = [
    path('create/', views.create_room, name='create_room'),
    path('my-rooms/', views.user_rooms, name='user_rooms'),
    path('<uuid:room_id>/', views.room_detail, name='room_detail'),
    path('<uuid:room_id>/edit/', views.edit_room, name='edit_room'),
    path('<uuid:room_id>/delete/', views.delete_room, name='delete_room'),
    path('<uuid:room_id>/restore/', views.restore_room, name='restore_room'),
    path('<uuid:room_id>/leave/', views.leave_room, name='leave_room'),
    path('join-by-password/', views.join_by_password, name='join_by_password'),
    path('api/<uuid:room_id>/state/', views.room_state_api, name='room_state_api'),
    path('api/<uuid:room_id>/video-state/', views.update_video_state_api, name='update_video_state_api'),
]