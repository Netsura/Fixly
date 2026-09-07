import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Namespace, Socket } from 'socket.io';
import { env } from '@fixly/config';
import { ConversationsService } from './conversations.service';
import { PresenceService } from './presence.service';
import type { AuthTokenPayload, AuthenticatedUser } from '../auth/auth.types';

@WebSocketGateway({ namespace: '/realtime', cors: { origin: env.WEB_URL, credentials: true } })
export class ConversationsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly conversationsService: ConversationsService,
    private readonly presenceService: PresenceService,
  ) {}

  async afterInit(server: Namespace) {
    const publisher = createClient({ url: env.REDIS_URL });
    const subscriber = publisher.duplicate();
    await Promise.all([publisher.connect(), subscriber.connect()]);
    server.server.adapter(createAdapter(publisher, subscriber));
  }

  async handleConnection(client: Socket) {
    const user = await this.authenticate(client);
    if (!user) {
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    await client.join(`user:${user.id}`);
    const count = await this.presenceService.connect(user.id);
    this.server.emit('presence:update', { userId: user.id, online: count > 0 });
  }

  async handleDisconnect(client: Socket) {
    const user = client.data.user as AuthenticatedUser | undefined;
    if (!user) return;
    const count = await this.presenceService.disconnect(user.id);
    this.server.emit('presence:update', { userId: user.id, online: count > 0 });
  }

  @SubscribeMessage('conversation:join')
  async join(client: Socket, payload: { conversationId?: string }) {
    const user = this.getUser(client);
    if (!payload?.conversationId) return { ok: false, message: 'conversationId is required' };
    await this.conversationsService.assertParticipant(user.id, payload.conversationId);
    await client.join(`conversation:${payload.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async sendMessage(client: Socket, payload: { conversationId?: string; body?: string }) {
    const user = this.getUser(client);
    if (!payload?.conversationId || typeof payload.body !== 'string') return { ok: false, message: 'Invalid message payload' };
    const result = await this.conversationsService.sendMessage(user.id, payload.conversationId, payload.body);
    this.server.to(`conversation:${payload.conversationId}`).emit('message:new', result.message);
    for (const recipientId of result.recipientIds) {
      this.server.to(`user:${recipientId}`).emit('notification:new', { type: 'NEW_MESSAGE', messageId: result.message.id, conversationId: payload.conversationId });
    }
    return { ok: true, messageId: result.message.id };
  }

  @SubscribeMessage('message:typing')
  async typing(client: Socket, payload: { conversationId?: string; isTyping?: boolean }) {
    const user = this.getUser(client);
    if (!payload?.conversationId) return;
    await this.conversationsService.assertParticipant(user.id, payload.conversationId);
    client.to(`conversation:${payload.conversationId}`).emit('message:typing', { userId: user.id, isTyping: Boolean(payload.isTyping) });
  }

  @SubscribeMessage('message:read')
  async read(client: Socket, payload: { conversationId?: string }) {
    const user = this.getUser(client);
    if (!payload?.conversationId) return { ok: false };
    await this.conversationsService.markRead(user.id, payload.conversationId);
    this.server.to(`conversation:${payload.conversationId}`).emit('message:read', { userId: user.id, conversationId: payload.conversationId });
    return { ok: true };
  }

  private async authenticate(client: Socket): Promise<AuthenticatedUser | null> {
    const token = this.readCookie(client.handshake.headers.cookie, 'fixly_access_token') ?? this.readBearer(client.handshake.headers.authorization);
    if (!token) return null;
    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token, { secret: env.JWT_ACCESS_SECRET });
      const user = await this.conversationsService.getAuthenticatedUser(payload.sub);
      return user && user.role === payload.role ? user : null;
    } catch {
      return null;
    }
  }

  private getUser(client: Socket) {
    const user = client.data.user as AuthenticatedUser | undefined;
    if (!user) throw new Error('Authentication required');
    return user;
  }

  private readCookie(header: string | undefined, name: string) {
    return header?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  }

  private readBearer(header: string | undefined) {
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }
}
