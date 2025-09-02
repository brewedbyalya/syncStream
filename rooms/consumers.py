import json
import logging
import time
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from .models import Room, Participant, Message, ScreenSession
from django.utils import timezone
from asgiref.sync import sync_to_async
from django.core.cache import cache
import asyncio

logger = logging.getLogger(__name__)
User = get_user_model()

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'room_{self.room_id}'
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        try:
            room = await self.get_room()
            if not room:
                logger.warning(f"Room {self.room_id} not found")
                await self.close(code=4001)
                return
                
            if not room.is_active:
                logger.warning(f"Room {self.room_id} is not active")
                await self.close(code=4001)
                return

            is_banned = await self.check_if_banned(room)
            if is_banned:
                logger.warning(f"User {self.user.id} is banned from room {self.room_id}")
                await self.close(code=4005)
                return

            if room.is_private:
                has_access = await self.check_room_access(room)
                if not has_access:
                    logger.warning(f"User {self.user.id} denied access to private room {self.room_id}")
                    await self.close(code=4003)
                    return

            is_full = await self.is_room_full(room)
            if is_full:
                logger.warning(f"Room {self.room_id} is full")
                await self.close(code=4004)
                return

            participant_added = await self.add_participant(room)
            if not participant_added:
                logger.error(f"Failed to add participant {self.user.id} to room {self.room_id}")
                await self.close(code=4002)
                return
                
            await self.update_user_online_status(True)
            await self.update_participant_online_status(True)
            
            await self.accept()
            
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_joined',
                    'user_id': self.user.id,
                    'username': self.user.username,
                }
            )
            
            logger.info(f"User {self.user.username} connected to room {self.room_id}")
            
        except Exception as e:
            logger.error(f"Error connecting to room {self.room_id}: {str(e)}")
            await self.close(code=4002)

    async def disconnect(self, close_code):
        if self.user.is_authenticated:
            try:
                await self.remove_participant()
                await self.update_user_online_status(False)
                await self.update_participant_online_status(False)
                
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_left',
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )
                
                logger.info(f"User {self.user.username} disconnected from room {self.room_id}")
            except Exception as e:
                logger.error(f"Error during disconnect: {str(e)}")

        try:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        except Exception as e:
            logger.error(f"Error leaving group: {str(e)}")

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
                await self.handle_ping(data)
            elif message_type == 'webrtc_signal':
                await self.handle_webrtc_signal(data)
            elif message_type == 'typing_start':
                await self.handle_typing_start()
            elif message_type == 'typing_stop':
                await self.handle_typing_stop()
            else:
                logger.warning(f"Unknown message type: {message_type}")
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': f'Unknown message type: {message_type}'
                }))
                
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Invalid JSON format'
            }))
        except Exception as e:
            logger.error(f"Error processing message: {str(e)}")
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Internal server error'
            }))

    async def handle_typing_start(self):
        try:
            is_muted = await self.check_if_muted()
            if is_muted:
                return
            
            await self.add_user_to_typing_cache()
                
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'typing_indicator',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_typing': True
                }
            )
        except Exception as e:
            logger.error(f"Error handling typing start: {str(e)}")

    async def handle_typing_stop(self):
        try:
            await self.remove_user_from_typing_cache()
                
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'typing_indicator',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_typing': False
                }
            )
        except Exception as e:
            logger.error(f"Error handling typing stop: {str(e)}")

    async def typing_indicator(self, event):
        try:
            await self.send(text_data=json.dumps({
                'type': 'typing_indicator',
                'user_id': event['user_id'],
                'username': event['username'],
                'is_typing': event['is_typing']
            }))
        except Exception as e:
            logger.error(f"Error sending typing indicator: {str(e)}")

    async def handle_video_control(self, data):
        try:
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
        except Exception as e:
            logger.error(f"Error handling video control: {str(e)}")

    async def handle_screen_share(self, data):
        try:
            action = data.get('action')
            room = await self.get_room()
            
            if room and room.allow_screen_share:
                if action == 'start':
                    session = await self.create_screen_session(room)
                    if session:
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
        except Exception as e:
            logger.error(f"Error handling screen share: {str(e)}")

    async def handle_ping(self, data):
        try:
            client_time = data.get('client_time')
            await self.send(text_data=json.dumps({
                'type': 'pong',
                'client_time': client_time,
                'server_time': time.time()
            }))
        except Exception as e:
            logger.error(f"Error handling ping: {str(e)}")

    async def handle_webrtc_signal(self, data):
        try:
            webrtc_data = data.get('data', {})
            target_user_id = webrtc_data.get('toUserId')
            
            if target_user_id:
                await self.channel_layer.group_send(
                    f"user_{target_user_id}",
                    {
                        'type': 'webrtc_signal',
                        'data': webrtc_data,
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )
            else:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'webrtc_signal',
                        'data': webrtc_data,
                        'user_id': self.user.id,
                        'username': self.user.username,
                    }
                )
        except Exception as e:
            logger.error(f"Error handling WebRTC signal: {str(e)}")

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'user_id': event['user_id'],
            'username': event['username'],
            'timestamp': event.get('timestamp', ''),
            'message_id': event.get('message_id', ''),
        }))

    async def video_control(self, event):
        try:
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
        except Exception as e:
            logger.error(f"Error sending video control: {str(e)}")

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
            'is_online': True
        }))

    async def user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'user_id': event['user_id'],
            'username': event['username'],
            'is_online': False
        }))

    async def webrtc_signal(self, event):
        try:
            await self.send(text_data=json.dumps({
                'type': 'webrtc_signal',
                'data': event['data'],
                'user_id': event['user_id'],
                'username': event['username'],
            }))
        except Exception as e:
            logger.error(f"Error sending WebRTC signal: {str(e)}")

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id'],
            'deleted_by': event['deleted_by'],
            'message_content': event['message_content'],
            'message_author': event['message_author']
            }))

    async def banned_word_added(self, event):
        await self.send(text_data=json.dumps({
            'type': 'banned_word_added',
            'word': event['word'],
            'added_by': event['added_by']
    }))

    async def banned_word_removed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'banned_word_removed',
            'word': event['word'],
            'removed_by': event['removed_by']
        }))

    async def user_kicked(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_kicked',
            'user_id': event['user_id'],
            'username': event['username'],
            'kicked_by': event['kicked_by']
         }))

    async def you_were_kicked(self, event):
        await self.send(text_data=json.dumps({
            'type': 'you_were_kicked',
            'room_id': event['room_id'],
            'room_name': event['room_name'],
            'kicked_by': event['kicked_by'],
            'redirect_url': '/'
        }))
        await asyncio.sleep(1)
        await self.close(code=4006)

    async def user_muted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_muted',
            'user_id': event['user_id'],
            'username': event['username'],
            'muted_by': event['muted_by'],
            'duration': event['duration'],
            'muted_until': event['muted_until']
            }))

    async def user_unmuted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_unmuted',
            'user_id': event['user_id'],
            'username': event['username'],
            'unmuted_by': event['unmuted_by']
        }))

    async def user_banned(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_banned',
            'user_id': event['user_id'],
            'username': event['username'],
            'banned_by': event['banned_by']
        }))

    async def you_were_banned(self, event):
        await self.send(text_data=json.dumps({
            'type': 'you_were_banned',
            'room_id': event['room_id'],
            'room_name': event['room_name'],
            'banned_by': event['banned_by'],
            'redirect_url': '/youre-banned/'
        }))
        await asyncio.sleep(1)
        await self.close(code=4007)

    async def user_unbanned(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_unbanned',
            'user_id': event['user_id'],
            'username': event['username'],
            'unbanned_by': event['unbanned_by']
        }))

    async def handle_chat_message(self, data):
        try:

            is_muted = await self.check_if_muted()
            if is_muted:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'You are currently muted and cannot send messages'
                }))
                return
            message = data.get('message', '').strip()
            
            if not message:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Message cannot be empty'
                }))
                return

            if len(message) > 1000:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Message too long (max 1000 characters)'
                }))
                return

            room = await self.get_room()
            if room and room.contains_banned_words(message):
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Message contains banned words'
                }))
                return

            room = await self.get_room()
            if not room:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': 'Room not found'
                }))
                return
            
            if room and room.allow_chat:
                saved_message = await self.save_message(room, message)
                if saved_message:
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'chat_message',
                            'message': message,
                            'user_id': self.user.id,
                            'username': self.user.username,
                            'timestamp': timezone.now().isoformat(),
                            'message_id': str(saved_message.id),
                        }
                    )
            
        except Exception as e:
            logger.error(f"Error handling chat message: {str(e)}")
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': 'Error sending message'
            }))

    @database_sync_to_async
    def check_if_muted(self):
        try:
            participant = Participant.objects.get(room_id=self.room_id, user=self.user)
            return participant.is_currently_muted()
        except Participant.DoesNotExist:
            return False

    @database_sync_to_async
    def get_room(self):
        try:
            return Room.objects.get(id=self.room_id)
        except Room.DoesNotExist:
            return None
        except Exception as e:
            logger.error(f"Error getting room {self.room_id}: {str(e)}")
            return None

    @database_sync_to_async
    def check_if_banned(self, room):
        try:
            return Participant.objects.filter(
                room=room, 
                user=self.user, 
                is_banned=True
            ).exists()
        except Exception as e:
            logger.error(f"Error checking ban status: {str(e)}")
            return False

    @database_sync_to_async
    def check_room_access(self, room):
        try:
            is_banned = Participant.objects.filter(
                room=room, 
                user=self.user, 
                is_banned=True
            ).exists()
        
            if is_banned:
                logger.warning(f"User {self.user.id} is banned from room {self.room_id}")
                return False
                
            is_participant = Participant.objects.filter(
                room=room, 
                user=self.user, 
                is_online=True
            ).exists()
            
            is_creator = room.creator == self.user
            
            return is_participant or is_creator
            
        except Exception as e:
            logger.error(f"Error checking room access: {str(e)}")
            return False

    @database_sync_to_async
    def is_room_full(self, room):
        try:
            online_count = room.participants.filter(is_online=True).count()
            return online_count >= room.max_users
        except Exception as e:
            logger.error(f"Error checking room capacity: {str(e)}")
            return True

    @database_sync_to_async
    def add_participant(self, room):
        try:
            participant, created = Participant.objects.get_or_create(
                room=room, 
                user=self.user,
                defaults={'is_online': True}
            )
            if not created:
                participant.is_online = True
                participant.save()
            return participant
        except Exception as e:
            logger.error(f"Error adding participant: {str(e)}")
            return None

    @database_sync_to_async
    def remove_participant(self):
        try:
            participant = Participant.objects.get(room_id=self.room_id, user=self.user)
            participant.is_online = False
            participant.save()
            return True
        except Participant.DoesNotExist:
            logger.warning(f"Participant not found for user {self.user.id} in room {self.room_id}")
            return False
        except Exception as e:
            logger.error(f"Error removing participant: {str(e)}")
            return False

    @database_sync_to_async
    def update_user_online_status(self, is_online):
        try:
            if is_online:
                self.user.update_activity()
            else:
                self.user.set_offline()
            return True
        except Exception as e:
            logger.error(f"Error updating user online status: {str(e)}")
            return False

    @database_sync_to_async
    def update_participant_online_status(self, is_online):
        try:
            participant = Participant.objects.get(room_id=self.room_id, user=self.user)
            participant.is_online = is_online
            participant.save(update_fields=['is_online'])
            return True
        except Participant.DoesNotExist:
            logger.warning(f"Participant not found for user {self.user.id} in room {self.room_id}")
            return False
        except Exception as e:
            logger.error(f"Error updating participant online status: {str(e)}")
            return False

    @database_sync_to_async
    def save_message(self, room, message):
        try:
            participant = Participant.objects.get(room=room, user=self.user)
            if participant.is_currently_muted():
                return None
            
            return Message.objects.create(
                room=room,
                user=self.user,
                message=message,
                message_type='text'
            )

        except Participant.DoesNotExist:
            logger.warning(f"Participant not found for user {self.user.id} in room {room.id}")
            return None

        except Exception as e:
            logger.error(f"Error saving message: {str(e)}")
            return None

    @database_sync_to_async
    def update_video_state(self, room, action, timestamp, url, server_timestamp=None):
        try:
            if url and url != room.current_video_url:
                room.current_video_url = url
            
            valid_actions = ['play', 'pause', 'load', 'sync', 'seek']
            if action in valid_actions:
                room.video_state = action
            
            if timestamp >= 0:
                room.video_timestamp = timestamp
            
            room.last_video_update = timezone.now()
            room.save()
            return True
        except Exception as e:
            logger.error(f"Error updating video state: {str(e)}")
            return False

    @database_sync_to_async
    def create_screen_session(self, room):
        try:
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
        except Exception as e:
            logger.error(f"Error creating screen session: {str(e)}")
            return None

    @database_sync_to_async
    def end_screen_session(self):
        try:
            ScreenSession.objects.filter(
                room_id=self.room_id, 
                user=self.user, 
                is_active=True
            ).update(is_active=False, ended_at=timezone.now())
            return True
        except Exception as e:
            logger.error(f"Error ending screen session: {str(e)}")
            return False

    @database_sync_to_async
    def add_user_to_typing_cache(self):
        cache_key = f'room_{self.room_id}_typing_users'
        typing_users = cache.get(cache_key, {})
        typing_users[self.user.id] = {
            'username': self.user.username,
            'timestamp': time.time()
        }
        cache.set(cache_key, typing_users, timeout=5)

    @database_sync_to_async
    def remove_user_from_typing_cache(self):
        cache_key = f'room_{self.room_id}_typing_users'
        typing_users = cache.get(cache_key, {})
        if self.user.id in typing_users:
            del typing_users[self.user.id]
        cache.set(cache_key, typing_users, timeout=5)

    @database_sync_to_async
    def get_typing_users(self):
        cache_key = f'room_{self.room_id}_typing_users'
        typing_users = cache.get(cache_key, {})
        
        current_time = time.time()
        expired_users = [
            user_id for user_id, data in typing_users.items() 
            if current_time - data['timestamp'] > 5
        ]
        
        for user_id in expired_users:
            del typing_users[user_id]
        
        if expired_users:
            cache.set(cache_key, typing_users, timeout=10)
        
        return list(typing_users.values())