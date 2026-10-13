import { io } from 'socket.io-client';
import { EVENTS } from '../../shared/constants.js';

const PING_INTERVAL_MS = 2000;
const SNAPSHOT_KEEP_MS = 1000;
const OFFSET_SMOOTHING = 0.2;

export function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); // shortest path
  return a + d * t;
}

// Socket connection, server clock estimate and the snapshot buffer.
export function createNetwork() {
  const url = import.meta.env.VITE_SERVER_URL || window.location.origin;
  const socket = io(url, { transports: ['websocket'] });
  const snapshots = []; // { t, players }
  let offset = 0;
  let haveOffset = false;
  let pingMs = 0;
  let username = null;

  const serverNow = () => Date.now() + offset;

  function setOffset(value) {
    offset = haveOffset ? offset + (value - offset) * OFFSET_SMOOTHING : value;
    haveOffset = true;
  }

  function sendPing() {
    if (!socket.connected) return;
    const sent = Date.now();
    socket.emit(EVENTS.PING, sent, (serverTime) => {
      const now = Date.now();
      const rtt = now - sent;
      pingMs = rtt;
      setOffset(serverTime + rtt / 2 - now);
    });
  }

  function sendJoin() {
    if (username !== null && socket.connected) socket.emit(EVENTS.JOIN_MATCH, { username });
  }

  socket.on('connect', () => {
    sendPing();
    sendJoin(); // also re-joins after a reconnect
  });
  setInterval(sendPing, PING_INTERVAL_MS);

  socket.on(EVENTS.STATE_UPDATE, (data) => pushSnapshot(data.serverTime, data.players));

  function pushSnapshot(t, players) {
    snapshots.push({ t, players });
    while (snapshots.length > 2 && snapshots[0].t < t - SNAPSHOT_KEEP_MS) snapshots.shift();
  }

  function latest() {
    return snapshots.length ? snapshots[snapshots.length - 1].players : null;
  }

  // Interpolated pose for each player at renderTime. `exact` is false when no bracketing pair exists.
  function sample(renderTime) {
    const out = {};
    for (let i = snapshots.length - 1; i > 0; i--) {
      const a = snapshots[i - 1];
      const b = snapshots[i];
      if (a.t <= renderTime && renderTime <= b.t) {
        const k = b.t === a.t ? 1 : (renderTime - a.t) / (b.t - a.t);
        for (const id of Object.keys(b.players)) {
          const pb = b.players[id];
          const pa = a.players[id];
          out[id] = pa
            ? {
                x: pa.x + (pb.x - pa.x) * k,
                y: pa.y + (pb.y - pa.y) * k,
                z: pa.z + (pb.z - pa.z) * k,
                ry: lerpAngle(pa.ry, pb.ry, k),
                rx: pa.rx + (pb.rx - pa.rx) * k,
                exact: true,
              }
            : { x: pb.x, y: pb.y, z: pb.z, ry: pb.ry, rx: pb.rx, exact: false };
        }
        return out;
      }
    }
    const players = latest() || {};
    for (const id of Object.keys(players)) {
      const p = players[id];
      out[id] = { x: p.x, y: p.y, z: p.z, ry: p.ry, rx: p.rx, exact: false };
    }
    return out;
  }

  return {
    socket,
    serverNow,
    sample,
    latest,
    pushSnapshot,
    clearSnapshots: () => { snapshots.length = 0; },
    syncClock: (serverTime) => setOffset(serverTime - Date.now()),
    get pingMs() { return pingMs; },
    get connected() { return socket.connected; },
    on: (event, fn) => socket.on(event, fn),
    join(name) { username = name; sendJoin(); },
    emitMove: (p) => socket.volatile.emit(EVENTS.PLAYER_MOVE, p),
    emitFire(origin, direction) {
      socket.emit(EVENTS.FIRE_BULLET, {
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
        time: serverNow(),
      });
    },
  };
}
