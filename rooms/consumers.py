import json
import logging
import time
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from .models import Room, Participant, Message, ScreenSession
from django.utils import timezone

logger = logging.getLogger(__name__)
User = get_user_model()

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'room_{self.room_id}'
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close()
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        try:
            room = await self.get_room()
            if room and room.is_active:
                await self.add_participant(room)
                await self.accept()
                
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_joined',
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )
            else:
                await self.close(code=4001)
        except Exception as e:
            logger.error(f"Error connecting to room: {e}")
            await self.close(code=4002)

    async def disconnect(self, close_code):
        if self.user.is_authenticated:
            try:
                await self.remove_participant()
                
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_left',
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )
            except Exception as e:
                logger.error(f"Error during disconnect: {e}")

        try:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        except Exception as e:
            logger.error(f"Error leaving group: {e}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'video_control':
                await self.handle_video_control(data)
            elif message_type == 'screen_share':
                await self.handle_screen_share(data)
            else:
                logger.warning(f"Unknown message type: {message_type}")
                
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
        except Exception as e:
            logger.error(f"Error processing message: {e}")

    async def handle_chat_message(self, data):
        message = data.get('message', '').strip()
        
        if not message:
            return
            
        room = await self.get_room()
        if room and room.allow_chat:
            await self.save_message(room, message)
            
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message': message,
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'timestamp': timezone.now().isoformat(),
                }
            )

    async def handle_video_control(self, data):
        action = data.get('action')
        timestamp = data.get('timestamp', 0)
        url = data.get('url', '')
        
        room = await self.get_room()
        if room:
            server_timestamp = time.time()
            await self.update_video_state(room, action, timestamp, url, server_timestamp)
            
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'video_control',
                    'action': action,
                    'timestamp': timestamp,
                    'server_timestamp': server_timestamp,
                    'url': url,
                    'user_id': self.user.id,
                    'username': self.user.username,
                }
            )

    async def handle_screen_share(self, data):
        action = data.get('action')
        room = await self.get_room()
        
        if room and room.allow_screen_share:
            if action == 'start':
                session = await self.create_screen_session(room)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'screen_share_started',
                        'user_id': self.user.id,
                        'username': self.user.username,
                        'session_id': str(session.id),
                    }
                )
            elif action == 'stop':
                await self.end_screen_session()
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'screen_share_ended',
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'user_id': event['user_id'],
            'username': event['username'],
            'timestamp': event.get('timestamp', ''),
        }))

    async def video_control(self, event):
        client_timestamp = event['timestamp']
        server_timestamp = event.get('server_timestamp', 0)
        current_time = time.time()
        
        latency = current_time - server_timestamp if server_timestamp else 0
        
        await self.send(text_data=json.dumps({
            'type': 'video_control',
            'action': event['action'],
            'timestamp': event['timestamp'],
            'url': event['url'],
            'user_id': event['user_id'],
            'username': event['username'],
            'server_timestamp': server_timestamp,
            'latency': round(latency, 3)
        }))

    async def screen_share_started(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_share_started',
            'user_id': event['user_id'],
            'username': event['username'],
            'session_id': event['session_id'],
        }))

    async def screen_share_ended(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_share_ended',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def user_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    async def user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'user_id': event['user_id'],
            'username': event['username'],
        }))

    @database_sync_to_async
    def get_room(self):
        try:
            return Room.objects.get(id=self.room_id, is_active=True)
        except Room.DoesNotExist:
            return None

    @database_sync_to_async
    def add_participant(self, room):
        participant, created = Participant.objects.get_or_create(
            room=room, 
            user=self.user,
            defaults={'is_online': True}
        )
        if not created:
            participant.is_online = True
            participant.save()
        return participant

    @database_sync_to_async
    def remove_participant(self):
        try:
            participant = Participant.objects.get(room_id=self.room_id, user=self.user)
            participant.is_online = False
            participant.save()
        except Participant.DoesNotExist:
            pass

    @database_sync_to_async
    def save_message(self, room, message):
        return Message.objects.create(
            room=room,
            user=self.user,
            message=message,
            message_type='text'
        )

    @database_sync_to_async
    def update_video_state(self, room, action, timestamp, url):
        if url and url != room.current_video_url:
            room.current_video_url = url
        room.video_state = action
        room.video_timestamp = timestamp
        room.save()

    @database_sync_to_async
    def create_screen_session(self, room):
        ScreenSession.objects.filter(
            room=room, 
            user=self.user, 
            is_active=True
        ).update(is_active=False, ended_at=timezone.now())
        
        return ScreenSession.objects.create(
            room=room,
            user=self.user,
            is_active=True
        )

    @database_sync_to_async
    def end_screen_session(self):
        ScreenSession.objects.filter(
            room_id=self.room_id, 
            user=self.user, 
            is_active=True
        ).update(is_active=False, ended_at=timezone.now())

async def receive(self, text_data):
    try:
        data = json.loads(text_data)
        message_type = data.get('type')
        
        if message_type == 'chat_message':
            await self.handle_chat_message(data)
        elif message_type == 'video_control':
            await self.handle_video_control(data)
        elif message_type == 'screen_share':
            await self.handle_screen_share(data)
        elif message_type == 'ping':
            await self.send(text_data=json.dumps({
                'type': 'pong',
                'client_time': data.get('client_time'),
                'server_time': time.time()
            }))
        else:
            logger.warning(f"Unknown message type: {message_type}")
            
    except json.JSONDecodeError:
        logger.error("Invalid JSON received")
    except Exception as e:
        logger.error(f"Error processing message: {e}")