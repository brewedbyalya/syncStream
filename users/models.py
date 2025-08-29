from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

class CustomUser(AbstractUser):
    profile_picture = models.ImageField(upload_to='profile_pics/', blank=True, null=True)
    bio = models.TextField(max_length=500, blank=True)
    last_activity = models.DateTimeField(default=timezone.now)
    is_online = models.BooleanField(default=False)
    
    def __str__(self):
        return self.username
    
    def update_activity(self):
        self.last_activity = timezone.now()
        self.is_online = True
        self.save(update_fields=['last_activity', 'is_online'])
    
    def set_offline(self):
        self.is_online = False
        self.save(update_fields=['is_online'])
    
    def check_online_status(self, threshold_minutes=5):
        if self.is_online:
            time_diff = timezone.now() - self.last_activity
            if time_diff.total_seconds() > threshold_minutes * 60:
                self.set_offline()
        return self.is_online