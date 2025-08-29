from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponseForbidden
from django.views.decorators.http import require_http_methods
from django.contrib import messages
from .models import Room, Participant, Message
from .forms import RoomForm

def home(request):
    rooms = Room.objects.filter(is_active=True, is_private=False)
    return render(request, 'rooms/home.html', {'rooms': rooms})

@login_required
def room_detail(request, room_id):
    room = get_object_or_404(Room, id=room_id, is_active=True)
    
    if room.is_private:
        if request.method == 'POST':
            password = request.POST.get('password')
            can_join, error_message = room.can_user_join(request.user, password)
            if not can_join:
                return render(request, 'rooms/room_password.html', {
                    'room': room,
                    'error': error_message
                })
        else:
            return render(request, 'rooms/room_password.html', {'room': room})
    
    can_join, error_message = room.can_user_join(request.user)
    if not can_join:
        messages.error(request, error_message)
        return redirect('home')
    
    participant, created = Participant.objects.get_or_create(
        room=room, 
        user=request.user,
        defaults={'is_online': True}
    )
    
    if not created:
        participant.is_online = True
        participant.save()
    
    messages_list = Message.objects.filter(room=room).order_by('created_at')[:50]
    

    if not room.is_active:
        if room.creator == request.user:
            messages.warning(request, f'Room "{room.name}" has been deleted. You can restore it from your rooms page.')
            return redirect('user_rooms')
        else:
            messages.error(request, 'This room no longer exists.')
            return redirect('home')
    
    return render(request, 'rooms/room_detail.html', {
        'room': room,
        'messages': messages_list,
    })

@login_required
def create_room(request):
    if request.method == 'POST':
        form = RoomForm(request.POST)
        if form.is_valid():
            room = form.save(commit=False)
            room.creator = request.user
            room.save()
            messages.success(request, f'Room "{room.name}" created successfully!')
            return redirect('room_detail', room_id=room.id)
    else:
        form = RoomForm()
    
    return render(request, 'rooms/room_form.html', {'form': form})

@login_required
def edit_room(request, room_id):
    room = get_object_or_404(Room, id=room_id, creator=request.user)
    
    if request.method == 'POST':
        form = RoomForm(request.POST, instance=room)
        if form.is_valid():
            form.save()
            messages.success(request, f'Room "{room.name}" updated successfully!')
            return redirect('room_detail', room_id=room.id)
    else:
        form = RoomForm(instance=room)
    
    return render(request, 'rooms/room_form.html', {'form': form})

@login_required
def delete_room(request, room_id):
    room = get_object_or_404(Room, id=room_id, creator=request.user)
    
    if request.method == 'POST':
        room.soft_delete()
        messages.success(request, f'Room "{room.name}" has been deleted successfully!')
        return redirect('user_rooms')
    
    return render(request, 'rooms/room_confirm_delete.html', {'room': room})

@login_required
@require_http_methods(['POST'])
def leave_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    
    try:
        participant = Participant.objects.get(room=room, user=request.user)
        participant.is_online = False
        participant.save()
        messages.info(request, f'You left the room "{room.name}"')
    except Participant.DoesNotExist:
        pass
    
    return redirect('home')

@login_required
def user_rooms(request):
    created_rooms = Room.objects.filter(creator=request.user)
    
    participant_rooms = Room.objects.filter(
        participants__user=request.user, 
        participants__is_online=True,
        is_active=True
    ).exclude(creator=request.user).distinct()
    
    return render(request, 'rooms/user_rooms.html', {
        'created_rooms': created_rooms,
        'participant_rooms': participant_rooms,
    })

@login_required
@require_http_methods(['POST'])
def restore_room(request, room_id):
    room = get_object_or_404(Room, id=room_id, creator=request.user, is_active=False)
    
    room.restore()
    messages.success(request, f'Room "{room.name}" has been restored successfully!')
    return redirect('room_detail', room_id=room.id)