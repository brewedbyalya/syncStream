from django.contrib import admin
from .models import Room, Participant, Message, ScreenSession

@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'creator', 'created_at', 'is_private', 'is_active')
    list_filter = ('is_private', 'is_active', 'created_at')
    search_fields = ('name', 'creator__username')
    readonly_fields = ('created_at',)

@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'joined_at', 'is_online')
    list_filter = ('is_online', 'joined_at')
    search_fields = ('user__username', 'room__name')

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'message_type', 'created_at')
    list_filter = ('message_type', 'created_at')
    search_fields = ('user__username', 'room__name', 'message')
    readonly_fields = ('created_at',)

@admin.register(ScreenSession)
class ScreenSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'started_at', 'ended_at', 'is_active')
    list_filter = ('is_active', 'started_at')
    search_fields = ('user__username', 'room__name')
    readonly_fields = ('started_at', 'ended_at')