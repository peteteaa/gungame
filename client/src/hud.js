import { WEAPON_TIERS, FINAL_TIER, MAX_HEALTH, getWeapon } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

// DOM overlay: bars, kill feed, scoreboard, banners.
export function createHud() {
  const el = {
    hud: $('hud'), start: $('start'), fill: $('health-fill'), hpText: $('health-text'),
    wName: $('weapon-name'), wTier: $('weapon-tier'), feed: $('feed'), toast: $('toast'),
    damage: $('damage'), death: $('death'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), disc: $('disconnected'), resume: $('resume'), ping: $('ping'), ammo: $('ammo'),
    board: $('scoreboard'), crosshair: $('crosshair'), scope: $('scope'), reddot: $('reddot'), burn: $('burn'),
    chat: $('chat'), chatLog: $('chat-log'), chatInput: $('chat-input'), killMsg: $('killmsg'), deathMsg: $('death-msg'),
  };
  let toastTimer = 0;
  let damageTimer = 0;
  let bannerInterval = 0;

  function pulse(node, cls, ms, timerRef) {
    node.classList.remove(cls);
    void node.offsetWidth; // restart transition
    node.classList.add(cls);
    clearTimeout(timerRef.id);
    timerRef.id = setTimeout(() => node.classList.remove(cls), ms);
  }
  const toastRef = { id: 0 };
  const damageRef = { id: 0 };
  const killMsgRef = { id: 0 };

  return {
    enterGame() { show(el.start, false); show(el.hud, true); },
    // 'cross' = hip crosshair, 'dot' = red-dot sight, 'scope' = full scope overlay, 'none' = mid-transition.
    setAim(mode) {
      el.crosshair.classList.toggle('off', mode !== 'cross');
      show(el.reddot, mode === 'dot');
      show(el.scope, mode === 'scope');
    },
    setBurning(on) { el.burn.classList.toggle('on', on); },
    setHealth(hp) {
      const pct = Math.max(0, Math.min(1, hp / MAX_HEALTH));
      el.fill.style.width = `${pct * 100}%`;
      el.fill.style.background = pct > 0.5 ? '#46d36a' : pct > 0.25 ? '#e6b83a' : '#e34a4a';
      el.hpText.textContent = String(Math.max(0, Math.round(hp)));
    },
    setWeapon(tier) {
      el.wName.textContent = getWeapon(tier).name;
      el.wTier.textContent = `Tier ${tier}/${FINAL_TIER} — ${getWeapon(tier).name}`;
    },
    setAmmo(ammo, magSize, reloading) {
      el.ammo.textContent = !magSize ? '' : reloading ? 'RELOADING' : `${ammo} / ${magSize}`;
      el.ammo.classList.toggle('reloading', reloading);
      el.ammo.classList.toggle('low', !reloading && magSize > 0 && ammo <= Math.ceil(magSize / 4));
    },
    setPing(ms) { el.ping.textContent = `${Math.round(ms)} ms`; },
    feed(parts) {
      const item = document.createElement('div');
      item.className = 'feed-item';
      for (const p of parts) {
        const s = document.createElement('span');
        s.className = p.cls || '';
        s.textContent = p.text;
        item.append(s);
        if (p.gap !== false) item.append(' ');
      }
      el.feed.append(item);
      while (el.feed.children.length > 6) el.feed.firstChild.remove();
      setTimeout(() => item.remove(), 5000);
    },
    // Chat lines fade out after a while; opening the input brings the recent history back.
    chatLine(username, text, { bot = false, self = false } = {}) {
      const line = document.createElement('div');
      line.className = `chat-line${bot ? ' bot' : ''}${self ? ' self' : ''}`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${username}: `;
      line.append(name, text);
      el.chatLog.append(line);
      while (el.chatLog.children.length > 8) el.chatLog.firstChild.remove();
      setTimeout(() => line.classList.add('old'), 10000);
    },
    get chatOpen() { return !el.chatInput.classList.contains('hidden'); },
    openChat() {
      el.chatInput.value = '';
      show(el.chatInput, true);
      el.chat.classList.add('open');
      el.chatInput.focus();
    },
    closeChat() {
      show(el.chatInput, false);
      el.chat.classList.remove('open');
      el.chatInput.blur();
    },
    get chatInput() { return el.chatInput; },
    toast(text) {
      el.toast.textContent = text;
      pulse(el.toast, 'on', 1800, toastRef);
    },
    flashDamage() { pulse(el.damage, 'on', 60, damageRef); },
    killMessage(text) {
      el.killMsg.textContent = text;
      pulse(el.killMsg, 'on', 2200, killMsgRef);
    },
    setDead(on, message = '') {
      el.deathMsg.textContent = message;
      show(el.death, on);
    },
    setDisconnected(on) { show(el.disc, on); },
    setResume(on) { show(el.resume, on); },
    showBanner(title, restartIn) {
      clearInterval(bannerInterval);
      el.bannerTitle.textContent = title;
      const end = Date.now() + restartIn;
      const tick = () => {
        el.bannerSub.textContent = `Next match in ${Math.max(0, Math.ceil((end - Date.now()) / 1000))}s`;
      };
      tick();
      bannerInterval = setInterval(tick, 250);
      show(el.banner, true);
    },
    hideBanner() { clearInterval(bannerInterval); show(el.banner, false); },
    setScoreboardVisible(on) { show(el.board, on); },
    renderScoreboard(players, myId) {
      const rows = Object.values(players).sort((a, b) => b.tier - a.tier || b.kills - a.kills);
      const body = el.board.tBodies[0];
      body.replaceChildren(...rows.map((p) => {
        const tr = document.createElement('tr');
        if (p.id === myId) tr.className = 'me';
        for (const v of [p.username, `${p.tier}/${WEAPON_TIERS.length}`, p.kills]) {
          const td = document.createElement('td');
          td.textContent = String(v);
          tr.append(td);
        }
        return tr;
      }));
    },
  };
}
