from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponseForbidden
from django.views.decorators.http import require_http_methods
from django.contrib import messages
from .models import Room, Participant, Message
from .forms import RoomForm
import json
from django.views.decorators.csrf import csrf_exempt

def home(request):
    rooms = Room.objects.filter(is_active=True, is_private=False)
    return render(request, 'rooms/home.html', {'rooms': rooms})

@login_required
def room_detail(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    
    if not room.is_active:
        if room.creator == request.user:
            messages.warning(request, f'Room "{room.name}" has been deleted. You can restore it from your rooms page.')
            return redirect('rooms:user_rooms')
        else:
            messages.error(request, 'This room no longer exists.')
            return redirect('home')
    
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
    
    return render(request, 'rooms/room_detail.html', {
        'room': room,
        'messages': messages_list,
        'user': request.user,
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
            return redirect('rooms:room_detail', room_id=room.id)
    else:
        form = RoomForm()
    
    return render(request, 'rooms/room_form.html', {
        'form': form,
        'editing': False,
        })

@login_required
def edit_room(request, room_id):
    room = get_object_or_404(Room, id=room_id, creator=request.user)
    
    if request.method == 'POST':
        form = RoomForm(request.POST, instance=room)
        if form.is_valid():
            form.save()
            messages.success(request, f'Room "{room.name}" updated successfully!')
            return redirect('rooms:room_detail', room_id=room.id)
    else:
        form = RoomForm(instance=room)
    
    return render(request, 'rooms/room_form.html', {
        'form': form,
        'editing': True,
        })

@login_required
def delete_room(request, room_id):
    room = get_object_or_404(Room, id=room_id, creator=request.user)
    
    if request.method == 'POST':
        permanent = request.POST.get('permanent', False)
        if permanent:
            room_name = room.name
            room.hard_delete()
            messages.success(request, f'Room "{room_name}" has been permanently deleted!')
        else:
            room.soft_delete()
            messages.success(request, f'Room "{room.name}" has been deleted successfully!')
        
        return redirect('rooms:user_rooms')
    
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
    return redirect('rooms:room_detail', room_id=room.id)

@csrf_exempt
@require_http_methods(["GET"])
def room_state_api(request, room_id):
    try:
        room = Room.objects.get(id=room_id, is_active=True)
        
        if room.is_private and not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        
        if room.is_private and room.password and not request.user.is_authenticated:
            return JsonResponse({'error': 'Password required'}, status=403)
        
        data = {
            'room': {
                'id': str(room.id),
                'name': room.name,
                'creator': room.creator.username,
                'video_state': room.get_video_state(),
                'participants_count': room.participants.count(),
                'online_count': room.get_online_users_count(),
                'is_private': room.is_private
            },
            'participants': room.get_participants_info(),
            'messages': [
                {
                    'id': str(msg.id),
                    'user': msg.user.username,
                    'message': msg.message,
                    'type': msg.message_type,
                    'timestamp': msg.created_at.isoformat()
                }
                for msg in room.messages.all().order_by('-created_at')[:20]
            ]
        }
        
        return JsonResponse(data)
        
    except Room.DoesNotExist:
        return JsonResponse({'error': 'Room not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_http_methods(["POST"])
@login_required
def update_video_state_api(request, room_id):
    try:
        room = Room.objects.get(id=room_id, is_active=True)
        
        if not room.participants.filter(user=request.user, is_online=True).exists():
            return JsonResponse({'error': 'Not a participant'}, status=403)
        
        data = json.loads(request.body)
        action = data.get('action')
        timestamp = data.get('timestamp', 0)
        url = data.get('url')
        
        room.update_video_state(action, timestamp, url)
        
        return JsonResponse({'status': 'success', 'state': room.get_video_state()})
        
    except Room.DoesNotExist:
        return JsonResponse({'error': 'Room not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)