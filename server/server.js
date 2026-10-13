// WebGun server: Express (health + optional static client) and Socket.io (authoritative game loop).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { EVENTS, TICK_RATE } from '../shared/constants.js';
import { GameServer } from './game.js';

export function startServer({ port = Number(process.env.PORT) || 3000, clientOrigin = process.env.CLIENT_ORIGIN } = {}) {
  const app = express();
  const httpServer = createServer(app);
  // CLIENT_ORIGIN: comma-separated allowlist (e.g. your Vercel URL). Unset = allow any origin (dev).
  const origin = clientOrigin ? clientOrigin.split(',').map((s) => s.trim()) : true;
  const io = new Server(httpServer, { cors: { origin }, pingInterval: 5000, pingTimeout: 10000, maxHttpBufferSize: 1e4 });
  const game = new GameServer(io);

  app.get('/health', (_req, res) => res.json({ ok: true, ...game.stats() }));

  // Serve the built client when present so a single host can run everything.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  io.on('connection', (socket) => {
    socket.on(EVENTS.JOIN_MATCH, (data) => game.join(socket, data?.username));
    socket.on(EVENTS.PLAYER_MOVE, (data) => game.roomOf(socket)?.handleMove(socket, data));
    socket.on(EVENTS.FIRE_BULLET, (data) => game.roomOf(socket)?.handleFire(socket, data));
    socket.on(EVENTS.PING, (_clientTime, ack) => typeof ack === 'function' && ack(Date.now()));
    socket.on('disconnect', () => game.leave(socket));
  });

  const tickTimer = setInterval(() => game.tick(), 1000 / TICK_RATE);

  const ready = new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer.address().port)));

  const close = () => new Promise((resolve) => {
    clearInterval(tickTimer);
    for (const room of game.rooms.values()) room.destroy();
    io.close(() => resolve());
  });

  return { app, io, game, httpServer, ready, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = startServer();
  server.ready.then((port) => console.log(`WebGun server listening on :${port} (tick ${TICK_RATE}Hz)`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close().then(() => process.exit(0)));
}
