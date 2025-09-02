import logging
from django.utils import timezone
from .models import CustomUser

logger = logging.getLogger(__name__)

class UpdateLastActivityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        
        if request.user.is_authenticated:
            updated = CustomUser.objects.filter(id=request.user.id).update(
                last_activity=timezone.now(),
                is_online=True
            )
            logger.debug(f"Updated user {request.user.username} activity. Rows updated: {updated}")
        
        return response