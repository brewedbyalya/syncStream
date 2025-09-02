from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.contrib.auth import get_user_model
from .forms import CustomUserCreationForm, ProfileEditForm
from rooms.models import Room, Message, Participant

User = get_user_model()

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
    return view_profile(request, request.user.username)

@login_required
def view_profile(request, username):
    target_user = get_object_or_404(User, username=username)
    
    created_rooms = Room.objects.filter(creator=target_user, is_active=True)
    
    participant_rooms = Room.objects.filter(
        participants__user=target_user,
        participants__is_online=True,
        is_active=True
    ).exclude(creator=target_user).distinct()
    
    total_messages = Message.objects.filter(user=target_user).count()
    
    context = {
        'target_user': target_user,
        'created_rooms': created_rooms,
        'participant_rooms': participant_rooms,
        'total_messages': total_messages,
        'is_own_profile': target_user == request.user,
    }
    
    return render(request, 'registration/profile.html', context)

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