# WebGun

Browser-based low-poly multiplayer **Gun Game** FPS. Every kill moves you up a 13-weapon ladder
(Pistol → Heavy Pistol → SMG → Shotgun → Machine Pistol → Assault Rifle → Auto Shotgun → Battle Rifle →
LMG → Marksman Rifle → Sniper → Flamethrower → Combat Knife); the first kill with the knife wins the match.
Weapon stats, order and models all live in `WEAPON_TIERS` in `shared/constants.js`.

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

Click to lock the mouse · WASD move · Space jump · Left click fire (hold for the rifle) · R reload · Tab scoreboard

## Server authority

The client predicts its own movement and renders opponents ~100 ms in the past, interpolating
between snapshots. The server never trusts the client for outcomes:

| Check | Where |
|---|---|
| Movement: time-based speed budget (spamming moves buys no extra distance), map bounds, no clipping into boxes, no climbing higher than a jump — violations get a `positionCorrection` | `Room.handleMove` |
| Fire rate per weapon (jitter tolerance can't raise the sustained rate) | `Room.handleFire` |
| Ammo and reloads: magazine counts and reload timers live on the server; empty or reloading guns can't fire; a kill upgrade or respawn refills | `startReload` / `updateReload` |
| Shot origin must be within 2 units of the shooter's server-side eye position | `Room.handleFire` |
| Hit detection: ray vs. player hitboxes, occluded by map geometry, limited by weapon range | `Room.handleFire` |
| Headshots (2× damage, per-weapon `headshot` override): decided from where the ray meets the rewound hitbox, not claimed by the client | `Room.handleFire` |
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
wall occlusion, magazines and reloads, spoofed origins, lag compensation, knife range, match win/restart, room cleanup).

## Deploy

The game server runs on **Render** and the client on **Vercel**. The server must be one long-running process
(the 30 Hz tick loop and room state live in memory), so it can't be a serverless function.

**Server (Render):** `render.yaml` is a Blueprint. In the Render dashboard choose **New → Blueprint**, pick this repo,
and it creates `webgun-server` (build `npm ci && npm run build`, start `npm start`, health check `GET /health`).
It also serves the built client, so its `https://….onrender.com` URL is playable on its own.
On the free plan the service sleeps after ~15 minutes idle and takes about a minute to wake on the next visit.

**Client (Vercel):** `vercel.json` builds with `npm run build` and serves `client/dist`. The server URL is baked in
at build time, so set it before deploying:

```bash
vercel link
vercel env add VITE_SERVER_URL production   # paste the Render URL
vercel deploy --prod
```

Then set `CLIENT_ORIGIN` on Render to the Vercel URL and the Render URL, comma-separated.
Deploy both from the same commit: a client whose map/weapon settings differ from the server's reloads itself.

## Maps

The first map is inspired by Valorant's **Ascent**. Attackers spawn south and defenders north. A site (west) has the
generator, a stepped Heaven platform, and the A Main / Rafters entrances. B site (east) has the Boathouse, B Main and
B Back. The open Mid courtyard links to A via Catwalk, to B via Market, and to defender spawn via Mid Top.

Maps live in `MAPS` in `shared/constants.js`. Ascent is drawn as ASCII, one character per 2x2-unit cell with north
on the top row: `#` building, `X` big crate, `x` climbable crate, `G` generator, `a`/`b`/`c` steps up to a raised
platform, `D`/`A`/`s` spawn points. Edit the grid and both client and server pick it up.
The integration tests pin the server to the old `arena` layout (`test/use-arena-map.js`), so their positions stay valid.

## Weapon models

Gun models come from [Low poly guns](https://sketchfab.com/3d-models/low-poly-guns-68cbd757dacb4d0e82cf8f06fcde0a46)
by [Cosmo](https://sketchfab.com/cosmoart) (Sketchfab Standard license). The pack ships as one GLB with every gun on a wall;
`scripts/split-guns.mjs` splits it into one GLB per gun in `client/public/models/guns/` (29 guns, listed in `index.json`):
each is a single mesh, centered, barrel down -Z, with a `muzzle` node at the barrel tip.

```bash
node scripts/split-guns.mjs ~/Downloads/low_poly_guns.glb
```

To use a different model for a tier, point its `model` in `WEAPON_TIERS` at any GLB under `client/public/models/`
(barrel along -Z; it's scaled to the weapon's `viewLength`). Missing files fall back to the built-in procedural
low-poly models — the Combat Knife uses one, since the pack has no knife.
