import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import type { RedisService } from '../redis/redis.service';

/**
 * Closes D-031 (Socket.IO single-instance limitation): with this adapter attached, `server.to(room)`
 * broadcasts through Redis pub/sub to every API instance's sockets, not just this process's — so
 * scaling to more than one instance no longer drops realtime events for clients connected elsewhere.
 *
 * Redis is an accelerator, not the source of truth (D-006): if it can't be reached at boot, this
 * falls back to Socket.IO's default in-memory adapter (today's single-instance behaviour) rather
 * than failing to start — running one instance without Redis has always worked and must keep working.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = this.redis.client.duplicate();
    const subClient = this.redis.client.duplicate();
    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Socket.IO Redis adapter attached (multi-instance realtime enabled)');
    } catch (err) {
      pubClient.disconnect();
      subClient.disconnect();
      this.logger.warn(
        `Socket.IO Redis adapter unavailable (${String(err)}); falling back to the single-instance in-memory adapter`,
      );
    }
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
