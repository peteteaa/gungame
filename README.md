# WebGun

Browser-based low-poly multiplayer **Gun Game** FPS. Every kill upgrades your weapon
(Pistol → Shotgun → Assault Rifle → Sniper → Combat Knife); the first kill with the knife wins the match.

- **Client:** Three.js + Vite (vanilla ES modules), served from Vercel.
- **Server:** Node.js + Express + Socket.io, authoritative 30 Hz simulation (Railway / Render / Fly.io).
- **Shared contract:** `shared/constants.js` — weapon tiers, map, physics constants, event names, ray/AABB math.

## Run locally

```bash
npm install
npm run dev:server   # game server on :3000
npm run dev:client   # Vite on :5173 (proxies /socket.io to :3000)
```

Open http://localhost:5173 in two browser windows. `?autojoin=Name` skips the start screen.

Or build once and let the server host everything on one port: `npm run build && npm start` → http://localhost:3000.

## Controls

Click to lock the mouse · WASD move · Space jump · Left click fire (hold for the rifle) · Tab scoreboard

## Server authority

The client predicts its own movement and renders opponents ~100 ms in the past, interpolating
between snapshots. The server never trusts the client for outcomes:

| Check | Where |
|---|---|
| Movement: time-based speed budget (spamming moves buys no extra distance), map bounds, no clipping into boxes, no climbing higher than a jump — violations get a `positionCorrection` | `Room.handleMove` |
| Fire rate per weapon (jitter tolerance can't raise the sustained rate) | `Room.handleFire` |
| Shot origin must be within 2 units of the shooter's server-side eye position | `Room.handleFire` |
| Hit detection: ray vs. player hitboxes, occluded by map geometry, limited by weapon range | `Room.handleFire` |
| Shotgun spread is rolled server-side (clients can't send perfectly tight pellets) | `applySpread` |
| Lag compensation: targets rewound up to 300 ms using per-tick position history | `Room.positionAt` |
| Damage, deaths, tier upgrades, respawns, match win/restart | `applyDamage` / `handleKill` |

There is intentionally no client-sent "playerKill" event — kills are only ever derived from server hit detection.

## Tests

```bash
npm test
```

Integration tests run real Socket.io clients against a real server on a random port
(joining, movement correction, speed/fly/wall-clip exploits, 3-shot pistol kill + upgrade + respawn, fire-rate limit,
wall occlusion, spoofed origins, lag compensation, knife range, match win/restart, room cleanup).

## Deploy

**Server (Railway, Render or Fly.io):** start command `npm start`; set `CLIENT_ORIGIN` to your Vercel URL.
`GET /health` returns `{ ok, rooms, players }` for health checks. It must be a long-running process
(the 30 Hz tick loop and room state live in memory), so use a single instance.

**Client (Vercel):** `vercel.json` builds with `npm run build` and serves `client/dist`.
Set `VITE_SERVER_URL` to the server URL in the Vercel project's environment variables.

## Custom models

Drop `.glb` files into `client/public/models/` using the names in `WEAPON_TIERS`
(`pistol.glb`, `shotgun.glb`, `rifle.glb`, `sniper.glb`, `knife.glb`). Missing files fall back to
the built-in procedural low-poly models.
