from django.contrib.auth.models import AbstractUser
from django.db import models

class CustomUser(AbstractUser):
    profile_picture = models.ImageField(upload_to='profile_pics/', blank=True, null=True)
    bio = models.TextField(max_length=500, blank=True)
    last_login = models.DateTimeField(auto_now=True)
    is_online = models.BooleanField(default=False)
    
    def __str__(self):
        return self.username