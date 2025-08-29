from django.db import models
from django.conf import settings
import uuid
from django.utils import timezone


class Room(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
    is_private = models.BooleanField(default=False)
    password = models.CharField(max_length=50, blank=True, null=True)
    max_users = models.PositiveIntegerField(default=10)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    is_locked = models.BooleanField(default=False)
    allow_screen_share = models.BooleanField(default=True)
    allow_chat = models.BooleanField(default=True)
    current_video_url = models.URLField(blank=True, null=True)
    video_state = models.CharField(max_length=20, default='paused')
    video_timestamp = models.FloatField(default=0)
    
    def __str__(self):
        return self.name
    
    def get_online_users_count(self):
        return self.participants.filter(is_online=True).count()
    def get_online_users(self):
        return self.participants.filter(is_online=True)
    
    def user_is_online(self, user):
        try:
            participant = self.participants.get(user=user)
            return participant.is_online
        except Participant.DoesNotExist:
            return False
    
    def can_user_join(self, user, password=None):
        if not self.is_active:
            return False, "Room is not active"
        
        if self.is_locked:
            return False, "Room is locked"
        
        if self.is_private:
            if password != self.password:
                return False, "Incorrect password"
        
        if self.participants.filter(is_online=True).count() >= self.max_users:
            return False, "Room is full"
        
        return True, "Can join"

    def soft_delete(self):
        self.is_active = False
        self.deleted_at = timezone.now()
        self.save()
        
        self.participants.update(is_online=False)
        
        self.screen_sessions.filter(is_active=True).update(
            is_active=False, 
            ended_at=timezone.now()
        )
    
    def hard_delete(self):
        super().delete()
    
    def restore(self):
        self.is_active = True
        self.deleted_at = None
        self.save()

class Participant(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    is_online = models.BooleanField(default=True)
    is_moderator = models.BooleanField(default=False)
    
    class Meta:
        unique_together = ('room', 'user')
    
    def __str__(self):
        return f"{self.user.username} in {self.room.name}"

    def set_online(self):
        self.is_online = True
        self.save()
    
    def set_offline(self):
        self.is_online = False
        self.save()

class Message(models.Model):
    MESSAGE_TYPES = (
        ('text', 'Text Message'),
        ('system', 'System Message'),
        ('event', 'Room Event'),
    )
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='messages')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    message = models.TextField()
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['created_at']
    
    def __str__(self):
        return f"{self.user.username}: {self.message[:20]}..."

    def to_dict(self):
        return {
            'id': str(self.id),
            'user_id': self.user.id,
            'username': self.user.username,
            'message': self.message,
            'message_type': self.message_type,
            'created_at': self.created_at.isoformat(),
        }

class ScreenSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='screen_sessions')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    
    def __str__(self):
        return f"{self.user.username} screen share in {self.room.name}"

    def end_session(self):
        self.ended_at = timezone.now()
        self.is_active = False
        self.save()