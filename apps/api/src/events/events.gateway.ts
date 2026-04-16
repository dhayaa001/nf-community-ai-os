import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { WS_EVENT } from '@nf/shared';
import type {
  AgentStatsUpdatedEvent,
  LeadCapturedEvent,
  MessageAppendedEvent,
  TaskCompletedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from '@nf/shared';

/**
 * Single WebSocket gateway. Rooms are keyed by conversationId so the UI
 * can subscribe to one conversation at a time, and an optional `admin` room
 * receives every event for the dashboard.
 */
@WebSocketGateway({
  cors: { origin: process.env.API_CORS_ORIGIN?.split(',') ?? '*', credentials: true },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`WS connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:conversation')
  onSubscribeConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() conversationId: string,
  ) {
    if (typeof conversationId === 'string' && conversationId.length > 0) {
      client.join(`conv:${conversationId}`);
    }
  }

  @SubscribeMessage('subscribe:admin')
  onSubscribeAdmin(@ConnectedSocket() client: Socket) {
    client.join('admin');
  }

  // ---- Emitters used by the orchestrator ------------------------------------

  emitTaskCreated(conversationId: string, payload: TaskCreatedEvent) {
    this.emit(conversationId, WS_EVENT.TASK_CREATED, payload);
  }

  emitTaskUpdated(conversationId: string, payload: TaskUpdatedEvent) {
    this.emit(conversationId, WS_EVENT.TASK_UPDATED, payload);
  }

  emitTaskCompleted(conversationId: string, payload: TaskCompletedEvent) {
    this.emit(conversationId, WS_EVENT.TASK_COMPLETED, payload);
  }

  emitMessageAppended(conversationId: string, payload: MessageAppendedEvent) {
    this.emit(conversationId, WS_EVENT.MESSAGE_APPENDED, payload);
  }

  emitLeadCaptured(conversationId: string, payload: LeadCapturedEvent) {
    this.emit(conversationId, WS_EVENT.LEAD_CAPTURED, payload);
  }

  emitAgentStatsUpdated(payload: AgentStatsUpdatedEvent) {
    this.server?.to('admin').emit(WS_EVENT.AGENT_STATS_UPDATED, payload);
  }

  private emit(conversationId: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(`conv:${conversationId}`).to('admin').emit(event, payload);
  }
}
