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
    is_locked = models.BooleanField(default=False)
    allow_screen_share = models.BooleanField(default=True)
    allow_chat = models.BooleanField(default=True)
    current_video_url = models.URLField(blank=True, null=True)
    video_state = models.CharField(max_length=20, default='paused')
    video_timestamp = models.FloatField(default=0)
    last_video_update = models.DateTimeField(blank=True, null=True)
    deleted_at = models.DateTimeField(blank=True, null=True)
    
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
        """Soft delete the room by marking it as inactive"""
        try:
            self.is_active = False
            self.deleted_at = timezone.now()
            self.save()
            
            self.participants.update(is_online=False)
            
            self.screen_sessions.filter(is_active=True).update(
                is_active=False, 
                ended_at=timezone.now()
            )
            return True
        except Exception as e:
            print(f"Error soft deleting room {self.id}: {e}")
            return False
    
    def hard_delete(self):
        """Permanently delete the room and all related data"""
        try:
            self.participants.all().delete()
            self.messages.all().delete()
            self.screen_sessions.all().delete()
            
            super().delete()
            return True
        except Exception as e:
            print(f"Error hard deleting room {self.id}: {e}")
            return False
    
    def restore(self):
        """Restore a soft-deleted room"""
        try:
            self.is_active = True
            self.deleted_at = None
            self.save()
            return True
        except Exception as e:
            print(f"Error restoring room {self.id}: {e}")
            return False
    
    def can_be_deleted_by(self, user):
        """Check if user has permission to delete this room"""
        return self.creator == user or user.is_staff
    
    def is_deleted(self):
        """Check if room is deleted"""
        return not self.is_active and self.deleted_at is not None
    
    def get_video_state(self):
        """Get current video state as dict"""
        return {
            'url': self.current_video_url,
            'state': self.video_state,
            'timestamp': self.video_timestamp,
            'last_update': self.last_video_update.isoformat() if self.last_video_update else None
        }
    
    def update_video_state(self, action, timestamp, url=None):
        """Update video state with validation"""
        if url and url != self.current_video_url:
            self.current_video_url = url
        
        valid_actions = ['play', 'pause', 'load', 'sync']
        if action in valid_actions:
            self.video_state = action
        
        if timestamp >= 0:
            self.video_timestamp = timestamp
        
        self.last_video_update = timezone.now()
        self.save()
    
    def get_participants_info(self):
        """Get detailed participants information"""
        return [
            {
                'id': participant.user.id,
                'username': participant.user.username,
                'is_online': participant.is_online,
                'is_moderator': participant.is_moderator,
                'joined_at': participant.joined_at.isoformat()
            }
            for participant in self.participants.select_related('user').all()
        ]

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

class VideoSyncData(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='sync_data')
    action = models.CharField(max_length=20)
    client_timestamp = models.FloatField()
    server_timestamp = models.FloatField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.user.username} {self.action} at {self.client_timestamp}"