from django.db import models
from django.conf import settings
import uuid
import secrets
import string
from django.utils import timezone
from django.contrib.auth.hashers import make_password, check_password

class Room(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
    is_private = models.BooleanField(default=False)
    password = models.CharField(max_length=128, blank=True, null=True)
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
    banned_words = models.JSONField(default=list, blank=True)
    
    def __str__(self):
        return self.name
    
    def generate_random_password(self, length=8):
        alphabet = string.ascii_letters + string.digits
        return ''.join(secrets.choice(alphabet) for i in range(length))
    
    def set_password(self, raw_password=None):
        if not raw_password:
            raw_password = self.generate_random_password()
        
        self.password = make_password(raw_password)
        return raw_password
    
    def check_password(self, raw_password):
        if not self.password:
            return False
        return check_password(raw_password, self.password)
    
    def save(self, *args, **kwargs):
        if self.is_private and not self.password:
            plain_password = self.set_password()
            self._plain_password = plain_password
        
        super().save(*args, **kwargs)
    
    def get_invite_link(self, request=None):
        from django.urls import reverse
        
        if not request:
            return f"Room ID: {self.id}"
        
        base_url = f"{request.scheme}://{request.get_host()}"
        room_url = f"{base_url}{reverse('rooms:room_detail', args=[self.id])}"
        
        if hasattr(self, '_plain_password'):
            return f"{room_url}?password={self._plain_password}"
        return room_url
    
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
            if not self.check_password(password):
                return False, "Incorrect password"
        
        if self.participants.filter(is_online=True).count() >= self.max_users:
            return False, "Room is full"
        
        return True, "Can join"
    
    def hard_delete(self):
        try:
            self.participants.all().delete()
            self.messages.all().delete()
            self.screen_sessions.all().delete()
            
            super().delete()
            return True
        except Exception as e:
            print(f"Error hard deleting room {self.id}: {e}")
            return False

    
    def can_be_deleted_by(self, user):
        return self.creator == user or user.is_staff
    
    def is_deleted(self):
        return not self.is_active and self.deleted_at is not None
    
    def get_video_state(self):
        return {
            'url': self.current_video_url,
            'state': self.video_state,
            'timestamp': self.video_timestamp,
            'last_update': self.last_video_update.isoformat() if self.last_video_update else None
        }
    
    def update_video_state(self, action, timestamp, url=None):
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

    def add_banned_word(self, word):
        if word.lower() not in self.banned_words:
            self.banned_words.append(word.lower())
            self.save()
    
    def remove_banned_word(self, word):
        if word.lower() in self.banned_words:
            self.banned_words.remove(word.lower())
            self.save()
    
    def contains_banned_words(self, message):
        if not self.banned_words:
            return False
        
        message_lower = message.lower()
        return any(banned_word in message_lower for banned_word in self.banned_words)
    
    def get_banned_words(self):
        return sorted(self.banned_words)

class Participant(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    is_online = models.BooleanField(default=True)
    is_moderator = models.BooleanField(default=False)
    is_muted = models.BooleanField(default=False)
    muted_until = models.DateTimeField(null=True, blank=True)
    muted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='muted_users')
    
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

    def mute(self, duration_minutes, muted_by):
        self.is_muted = True
        self.muted_until = timezone.now() + timezone.timedelta(minutes=duration_minutes)
        self.muted_by = muted_by
        self.save()
    
    def unmute(self):
        self.is_muted = False
        self.muted_until = None
        self.muted_by = None
        self.save()
    
    def is_currently_muted(self):
        from django.utils import timezone
        if not self.is_muted:
            return False
        if self.muted_until and timezone.now() > self.muted_until:
            self.unmute()
            return False
        return True

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