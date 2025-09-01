from django.urls import path
from . import views

app_name = 'rooms'

urlpatterns = [
    path('create/', views.create_room, name='create_room'),
    path('my-rooms/', views.user_rooms, name='user_rooms'),
    path('join-by-password/', views.join_by_password, name='join_by_password'),
    path('<uuid:room_id>/', views.room_detail, name='room_detail'),
    path('<uuid:room_id>/edit/', views.edit_room, name='edit_room'),
    path('<uuid:room_id>/delete/', views.delete_room, name='delete_room'),
    path('<uuid:room_id>/leave/', views.leave_room, name='leave_room'),
    path('api/<uuid:room_id>/state/', views.room_state_api, name='room_state_api'),
    path('api/<uuid:room_id>/video-state/', views.update_video_state_api, name='update_video_state_api'),
    path('<uuid:room_id>/messages/<uuid:message_id>/delete/', views.delete_message, name='delete_message'),    
    path('<uuid:room_id>/users/<int:user_id>/mute/', views.mute_user, name='mute_user'),
    path('<uuid:room_id>/users/<int:user_id>/unmute/', views.unmute_user, name='unmute_user'),
    path('<uuid:room_id>/banned-words/add/', views.add_banned_word, name='add_banned_word'),
    path('<uuid:room_id>/banned-words/remove/', views.remove_banned_word, name='remove_banned_word'),
    path('<uuid:room_id>/banned-words/', views.get_banned_words, name='get_banned_words'),
]