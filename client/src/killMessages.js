import { WEAPON_TIERS } from '../../shared/constants.js';

// Funny kill lines. {k} = killer, {v} = victim. Each line must still read right with "You" as the killer
// (shown to the killer) and "you" as the victim (shown on the death screen).
const GENERIC = [
  '{k} uninstalled {v}',
  '{k} sent {v} to the shadow realm',
  '{k} deleted {v}',
  '{k} turned {v} into a loading screen',
  '{k} returned {v} to sender',
  '{k} sent {v} back to the lobby',
  '{k} unsubscribed {v}',
  '{k} put {v} on the respawn timer',
  '{k} gave {v} a free trip to spectator mode',
  '{k} ended {v}\'s free trial',
  '{k} filed {v} under "L"',
  '{k} made {v} rage quit (almost)',
  '{k} ctrl+z\'d {v}',
  '{k} evicted {v}',
  '{v} got cooked by {k}',
  '{v} got clapped by {k}',
  '{v} got absolutely bodied by {k}',
  '{v} touched grass, courtesy of {k}',
];
const HEADSHOT = [
  '{k} rearranged {v}\'s face',
  '{k} gave {v} a free haircut',
  '{k} booped {v} right on the noggin',
  '{k} found {v}\'s last brain cell',
  '{k} knocked the thoughts out of {v}',
  '{v} took one straight to the dome from {k}',
];
const BY_KIND = {
  shotgun: [
    '{k} turned {v} into confetti',
    '{k} gave {v} a close-up',
    '{k} spread {v} across the map',
    '{v} got hole-punched by {k}',
  ],
  sniper: [
    '{k} sniped {v} from another time zone',
    '{k} said hi to {v} from across the map',
    '{v} never saw {k} coming',
    '{k} pinged {v}. permanently',
  ],
  knife: [
    '{k} shanked {v}',
    '{k} served {v} with a side of knife',
    '{k} sliced {v} like deli meat',
    '{v} brought a gun to {k}\'s knife fight',
  ],
};
const FLAME = [
  '{k} roasted {v}',
  '{k} turned {v} into a crispy snack',
  '{k} cooked {v} well done',
  '{k} made a campfire out of {v}',
  '{v} got toasted by {k}',
];

const byName = new Map(WEAPON_TIERS.map((w) => [w.name, w]));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function pool(weaponName, headshot) {
  const w = byName.get(weaponName);
  if (headshot && Math.random() < 0.6) return HEADSHOT;
  if (w?.effect === 'flame') return FLAME;
  const special = BY_KIND[w?.kind];
  return special && Math.random() < 0.7 ? special : GENERIC;
}

// One kill's line, split into parts so the HUD can color the names: [{ role: 'k'|'v'|'text', text }].
export function killMessage(weaponName, headshot) {
  return pick(pool(weaponName, headshot)).split(/(\{[kv]\})/).filter(Boolean)
    .map((s) => (s === '{k}' ? { role: 'k' } : s === '{v}' ? { role: 'v' } : { role: 'text', text: s }));
}

// The same line as plain text with the names filled in; `me` ('k' or 'v') says which one is the local player,
// written as "you" (and "your" for "{v}'s"). Capitalized.
export function killText(parts, killer, victim, me) {
  let s = parts.map((p) => (p.role === me ? '\0' : p.role === 'k' ? killer : p.role === 'v' ? victim : p.text)).join('');
  s = s.replace(/\0's/g, 'your').replace(/\0/g, 'you');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
