from django.contrib import admin
from .models import Room, Participant, Message, ScreenSession

@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'creator', 'created_at', 'is_private', 'is_active', 'deleted_at')
    list_filter = ('is_private', 'is_active', 'created_at', 'deleted_at')
    search_fields = ('name', 'creator__username')
    readonly_fields = ('created_at', 'deleted_at')
    actions = ['restore_rooms', 'permanently_delete_rooms']
    
    def restore_rooms(self, request, queryset):
        for room in queryset:
            room.restore()
        self.message_user(request, f"{queryset.count()} rooms restored successfully.")
    restore_rooms.short_description = "Restore selected rooms"
    
    def permanently_delete_rooms(self, request, queryset):
        count = queryset.count()
        queryset.delete()
        self.message_user(request, f"{count} rooms permanently deleted.")
    permanently_delete_rooms.short_description = "Permanently delete selected rooms"

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