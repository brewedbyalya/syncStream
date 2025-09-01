from django.shortcuts import render, redirect
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from .forms import CustomUserCreationForm, ProfileEditForm
from rooms.models import Room, Message

def signup(request):
    if request.method == 'POST':
        form = CustomUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('home')
    else:
        form = CustomUserCreationForm()
    return render(request, 'registration/signup.html', {'form': form})

@login_required
def profile(request):
    participant_rooms = request.user.participant_set.filter(
        is_online=True
    ).select_related('room').values_list('room', flat=True)
    
    rooms_participating = Room.objects.filter(
        id__in=participant_rooms
    ).exclude(creator=request.user).distinct()
    
    total_messages = Message.objects.filter(user=request.user).count()
    
    is_online = request.user.is_online
    
    return render(request, 'registration/profile.html', {
        'participant_rooms': rooms_participating,
        'total_messages': total_messages,
        'is_online': is_online,
    })

@login_required
def profile_edit(request):
    if request.method == 'POST':
        form = ProfileEditForm(request.POST, request.FILES, instance=request.user)
        if form.is_valid():
            form.save()
            return redirect('profile')
    else:
        form = ProfileEditForm(instance=request.user)
    
    return render(request, 'registration/profile_edit.html', {'form': form})

from django.http import JsonResponse

@login_required
def online_status_api(request):
    return JsonResponse({
        'is_online': request.user.is_online,
        'last_activity': request.user.last_activity.isoformat() if request.user.last_activity else None
    })

@login_required
def custom_logout(request):
    logout(request)
    return render(request, 'registration/logged_out.html')