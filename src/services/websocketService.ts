import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

interface WhatsAppEvent {
  type: string;
  [key: string]: any;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws/whatsapp'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔌 WebSocket client connected');
      this.clients.add(ws);

      // Send initial status
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket connected successfully'
      }));

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    console.log('✅ WebSocket server initialized');
  }

  private handleMessage(ws: WebSocket, message: any) {
    switch (message.type) {
      case 'send_message':
        // Handle sending WhatsApp message
        console.log('📤 WebSocket message request:', message);
        // You can emit this to the WhatsApp service
        break;
      
      default:
        console.log('Unknown WebSocket message type:', message.type);
    }
  }

  broadcast(event: WhatsAppEvent) {
    const message = JSON.stringify(event);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Specific broadcast methods for WhatsApp events
  broadcastQR(qr: string) {
    this.broadcast({
      type: 'qr',
      qr: qr
    });
  }

  broadcastReady() {
    this.broadcast({
      type: 'ready',
      message: 'WhatsApp is ready'
    });
  }

  broadcastLoading(percent: number, message: string) {
    this.broadcast({
      type: 'loading',
      percent: percent,
      message: message
    });
  }

  broadcastAuthFailure(message: string) {
    this.broadcast({
      type: 'auth_failure',
      message: message
    });
  }

  broadcastDisconnected(reason: string) {
    this.broadcast({
      type: 'disconnected',
      reason: reason
    });
  }

  broadcastMessage(from: string, body: string) {
    this.broadcast({
      type: 'message',
      from: from,
      body: body
    });
  }
}

export const webSocketService = new WebSocketService(); 