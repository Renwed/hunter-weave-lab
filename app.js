const $ = id => document.getElementById(id);
const seek = $('seek');
const start = Number(seek.min);

// Range boundaries used by the sim export (centre-to-centre yards).
const MELEE_RANGE = 5;
const SHOOT_RANGE = 11.67;

const explanations = {
  move: 'Your hunter moves between shooting range and melee range.',
  melee: 'Your melee weapon swings at the target.',
  ranged: 'Your ranged weapon fires automatically.',
  cast: 'An ability fires from your action priority list.',
  cooldown: 'Your setup uses an offensive cooldown or consumable.',
};

/* ---------- Formatting helpers ---------- */

function timeText(seconds) {
  const hundredths = Math.round(Math.abs(seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const remainder = ((hundredths % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${seconds < 0 && hundredths > 0 ? '−' : ''}${minutes}:${remainder}`;
}

/** Parses WoWSims duration strings such as "-20s", "-1700ms" or "400ms" into seconds. */
function durationSeconds(value) {
  const number = Number.parseFloat(value);
  return String(value).trim().endsWith('ms') ? number / 1000 : number;
}

function secondsLabel(seconds) {
  return `${seconds < 0 ? '−' : ''}${Math.abs(seconds).toFixed(2)} s`;
}

/** Binary search: index of the last record at or before `time` (ties broken by log order). */
function lastAt(records, time, order = [], line = Infinity) {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const at = records[mid][0];
    if (at < time || (at === time && (order[mid] ?? 0) <= line)) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function plainWords(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

/** Reads a colour token from the stylesheet so the canvases follow light/dark mode. */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/* ---------- APL list ---------- */

function actionName(action, catalog) {
  const [kind, value] = Object.entries(action).find(([key]) => key !== 'condition') ?? ['', {}];
  const id = value.spellId;
  if (id) {
    const name = catalog[`s${id.spellId}`]?.[0] ?? catalog[`i${id.itemId}`]?.[0] ??
      (id.otherId === 'OtherActionResourcePotion' ? 'Resource potion' : 'Spell ' + (id.spellId ?? id.itemId));
    if (id.tag === 1 && id.spellId === 14266) return 'Queue ' + name;
    if (kind === 'multidot') return `${name} (up to ${value.maxDots} targets)`;
    return name;
  }
  if (kind === 'autocastOtherCooldowns') return 'Use other cooldowns';
  if (kind === 'groupReference') return `Run ${value.groupName} group`;
  if (kind === 'move' && value.rangeFromTarget?.const) return `Move to ${value.rangeFromTarget.const.val} yd`;
  if (kind === 'move' && value.rangeFromTarget?.variableRef) return `Move to ${value.rangeFromTarget.variableRef.name}`;
  if (kind === 'move') return 'Move to calculated range';
  if (kind === 'wait' && value.duration?.const) return `Wait ${secondsLabel(durationSeconds(value.duration.const.val))}`;
  if (kind === 'wait' && value.duration?.gcdTimeToReady) return 'Wait for the global cooldown';
  if (kind === 'wait') return 'Wait (calculated)';
  return plainWords(kind);
}

function prepullTime(item) {
  return durationSeconds(item.doAtValue.const.val);
}

/** rows: [{item, label, id}] */
function addApl(rows, title, catalog, expanded = false) {
  const section = document.createElement('details');
  section.open = expanded;
  const heading = document.createElement('summary');
  heading.textContent = `${title} · ${rows.length}`;
  const list = document.createElement('ol');
  list.className = 'apl-list';
  for (const {item, label, id} of rows) {
    const row = document.createElement('li');
    row.className = 'apl-row' + (item.hide ? ' is-disabled' : '');
    if (id) row.id = id;
    const order = document.createElement('span');
    order.textContent = label;
    const name = document.createElement('span');
    name.textContent = actionName(item.action, catalog) + (item.hide ? ' (disabled)' : '');
    const details = document.createElement('details');
    const caption = document.createElement('summary');
    caption.textContent = item.action.condition ? 'Conditions and settings' : 'Action settings';
    const raw = document.createElement('pre');
    raw.textContent = JSON.stringify(item.action, null, 2);
    details.append(caption);
    if (item.notes) {
      const notes = document.createElement('p');
      notes.textContent = item.notes;
      details.append(notes);
    }
    details.append(raw);
    row.append(order, name, details);
    list.append(row);
  }
  section.append(heading, list);
  $('apl').append(section);
}

/** Opens any collapsed <details> around an APL row, then scrolls it into view. */
function revealAplRow(id) {
  const row = $(id);
  if (!row) return;
  for (let node = row.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
  }
  document.querySelectorAll('.apl-row.is-current').forEach(el => el.classList.remove('is-current'));
  row.classList.add('is-current');
  row.scrollIntoView({block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

/* ---------- Canvases ---------- */

/** Sizes a canvas backing store to its CSS box at the device pixel ratio. */
function prepareCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return {ctx, width, height};
}

function drawArena(distance, zone) {
  const prepared = prepareCanvas($('arena-map'));
  if (!prepared) return;
  const {ctx, width, height} = prepared;
  const colors = {
    melee: token('--melee'), ranged: token('--ranged'), dead: token('--dead'),
    text: token('--text'), muted: token('--muted'), panel: token('--panel'), cd: token('--cd'),
  };
  // Fit 0–13 yd to the right of the target and keep the rings inside the canvas height.
  const scale = Math.min((height / 2 - 8) / SHOOT_RANGE, (width * 0.6) / 13.5);
  const x = Math.min(width / 2, width - 13.5 * scale - 10);
  const y = height / 2;
  const ring = (radius, fill, alpha, stroke, dashed = false) => {
    ctx.beginPath();
    ctx.arc(x, y, radius * scale, 0, Math.PI * 2);
    if (fill) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash(dashed ? [4, 5] : []);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // Ranged zone (everything beyond the shoot spot), dead zone, then melee.
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = colors.ranged;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ring(SHOOT_RANGE, colors.panel, 1, colors.ranged);
  ring(SHOOT_RANGE, colors.dead, 0.12, colors.ranged);
  ring(MELEE_RANGE, colors.melee, 0.22, colors.melee);

  // Yard ruler along the line to the hunter.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 13.5 * scale, y);
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.muted;
  for (const [yards, label] of [[MELEE_RANGE, '5'], [SHOOT_RANGE, '11.67']]) {
    const tickX = x + yards * scale;
    ctx.fillRect(tickX - 0.5, y - 5, 1, 10);
    ctx.fillText(label, tickX, y + 20);
  }

  // Target.
  ctx.beginPath();
  ctx.arc(x, y, Math.max(9, 1.3 * scale), 0, Math.PI * 2);
  ctx.fillStyle = colors.melee;
  ctx.fill();
  ctx.font = '700 13px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = colors.panel;
  ctx.fillText('B', x, y + 4.5);
  ctx.fillStyle = colors.muted;
  ctx.font = '500 11px "DM Sans", system-ui, sans-serif';
  ctx.fillText('Target', x, y - Math.max(9, 1.3 * scale) - 6);

  // Hunter.
  const playerX = x + distance * scale;
  const zoneColor = zone === 'Melee' ? colors.melee : zone === 'Ranged' ? colors.ranged : colors.dead;
  ctx.beginPath();
  ctx.arc(playerX, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = colors.ranged;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.panel;
  ctx.stroke();
  ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = colors.panel;
  ctx.fillText('H', playerX, y + 4.5);
  ctx.font = '600 12px "DM Sans", system-ui, sans-serif';
  ctx.fillStyle = zoneColor;
  ctx.fillText(zone, playerX, y - 19);
}

function positionAt(move, time) {
  if (!move) return 12;
  if (!(move[3] > 0)) return move[2];
  return move[1] + (move[2] - move[1]) * Math.min(1, Math.max(0, (time - move[0]) / move[3]));
}

function drawDistance(moves, from, to) {
  const prepared = prepareCanvas($('distance-chart'));
  if (!prepared) return;
  const {ctx, width, height} = prepared;
  const y = distance => height - 6 - distance / 13 * (height - 12);
  // Dead zone band and boundary lines.
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = token('--dead');
  ctx.fillRect(0, y(SHOOT_RANGE), width, y(MELEE_RANGE) - y(SHOOT_RANGE));
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (const [yards, color] of [[MELEE_RANGE, token('--melee')], [SHOOT_RANGE, token('--ranged')]]) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(yards)) + 0.5);
    ctx.lineTo(width, Math.round(y(yards)) + 0.5);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = 0; x <= width; x++) {
    const sample = from + x / width * (to - from);
    const sampleY = y(positionAt(moves[lastAt(moves, sample)], sample));
    if (x === 0) ctx.moveTo(x, sampleY);
    else ctx.lineTo(x, sampleY);
  }
  ctx.strokeStyle = token('--move');
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/* ---------- Guided tours ---------- */
// [event index, title, copy, optional stop time]. Indices point into trace.json events.

const openerTour = [
  [0, 'Set up before the pull', 'Your hunter puts up Aspect of the Hawk and settles at 11.67 yd. (Your sim does this at −20 s; the replay starts at −5 s to skip the wait, and Aspect lasts until cancelled.) Hunter’s Mark goes on at −3.30 s.'],
  [3, 'Pre-cast Aimed Shot', 'Aimed Shot starts casting at −1.70 s. The sim uses Major Frenzy Potion at −1.50 s while the cast is underway. Aimed Shot completes at 0.01 s and its damage lands at 0.30 s.'],
  [7, 'Apply Serpent Sting at range', 'At 0.01 s the log records Aimed Shot completing, then Rapid Fire, then Serpent Sting, all at the same displayed timestamp. You are still at 11.67 yd.'],
  [8, 'Watch for the Auto Shot', 'The first Auto Shot fires at 0.43 s and hits at 0.72 s. In this run you stay at range until 0.99 s. Use the Auto Shot timer to follow the recorded shot timing.'],
  [11, 'Queue Raptor Strike and walk in', 'At 0.99 s the sim uses Dense Dynamite and queues Raptor Strike, and the walk toward 4.60 yd begins at the same displayed time. Queueing Raptor Strike is separate from the swing that delivers it.'],
  [12, 'Swing as you reach melee', 'At 1.94 s, at the 5 yd melee boundary, the queued Raptor Strike lands as the melee attack. Strider Kick follows at the same displayed timestamp. The next weave may use a different melee action.'],
  [14, 'Walk back to shooting range', 'At 2.34 s you start back out from 4.60 yd. The walk takes about 0.78 s. Wait until you are back at shooting range before using a ranged attack.'],
  [15, 'Resume ranged attacks', 'Arcane Shot fires at 3.44 s, followed by Auto Shot at 3.95 s. The next walk-in starts at 4.07 s and produces a normal melee swing in this run. Your APL re-checks every weave as the fight goes on.'],
];

const clipStart = 23.4;
const clipEnd = 35.44;
const combatTour = [
  [53, 'Begin at shooting range', 'At 23.40 s your hunter is at 11.67 yd and starts casting Aimed Shot. The two timer bars follow the next recorded Auto Shot and melee swing.'],
  [54, 'Watch Auto Shot fire', 'Auto Shot fires at 24.72 s while Aimed Shot is still casting, and its hit is logged at 25.01 s. Stay at range until the cast finishes.'],
  [55, 'Finish Aimed Shot', 'Aimed Shot completes at 25.11 s and hits at 25.40 s. The log also records the Raptor Strike queue and the start of the walk in at this same timestamp.'],
  [56, 'Queue Raptor Strike', 'Queueing sets Raptor Strike up to replace your next melee swing. This entry is the queue; the strike itself appears later.'],
  [57, 'Cross the dead zone', 'The walk starts at 11.67 yd and heads toward 4.60 yd. Watch the marker cross the gap between shooting range and melee range.'],
  [59, 'Swing and use Strider Kick', 'At 26.06 s Raptor Strike lands as you reach the 5 yd melee boundary. Strider Kick follows at the same displayed time.'],
  [60, 'Head back out', 'At 26.46 s you turn around. The walk from 4.60 yd back to 11.67 yd takes about 0.78 s.'],
  [60, 'Back at shooting range', 'You reach shooting range at about 27.24 s. The next recorded ranged action is Arcane Shot at 27.56 s.', 27.24],
];

/* ---------- Spell bar ---------- */

function buildSpellBar(events, catalog) {
  const tiles = new Map();
  const eventIcons = new Map(events.map(([, , name, icon]) => [name, icon]));
  const groups = [
    ['At range', [['Auto Shot'], ['Aimed Shot'], ['Serpent Sting', 'Sting', 's13555'], ['Arcane Shot'], ['Multi-Shot', null, 's2643']]],
    ['In melee', [['Melee swing', 'Swing'], ['Raptor Strike'], ['Strider Kick'], ['Mongoose Bite', 'Bite'], ['Immolation Trap', 'Trap'], ['Wing Clip', null, 's14268']]],
    ['Movement', [['Move in', 'Walk in'], ['Move out', 'Walk out']]],
  ];
  for (const [heading, spells] of groups) {
    const section = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = heading;
    const row = document.createElement('ul');
    for (const [name, label, id] of spells) {
      const tile = document.createElement('li');
      tile.title = name;
      const icon = eventIcons.get(name) || catalog[id]?.[1];
      const picture = icon ? document.createElement('img') : document.createElement('span');
      if (icon) {
        picture.src = `icons/${icon}.jpg`;
        picture.alt = '';
        picture.width = picture.height = 42;
      } else {
        picture.className = 'move-symbol';
        picture.textContent = name === 'Move in' ? '↘' : '↖';
        picture.setAttribute('aria-hidden', 'true');
      }
      const caption = document.createElement('small');
      caption.textContent = label || name;
      tile.append(picture, caption);
      row.append(tile);
      tiles.set(name, tile);
    }
    section.append(title, row);
    $('spell-bar').append(section);
  }
  return tiles;
}

/* ---------- Replay ---------- */

function startReplay({events, moves, mana, duration, catalog, damage, logOrder}, apl, source) {
  const simUrl = source.trim();
  if (/^https:\/\//.test(simUrl)) $('sim-link').href = simUrl;
  else $('sim-link').hidden = true;

  const spellTiles = buildSpellBar(events, catalog);
  const phases = Array.from(document.querySelectorAll('.weave-phases li'));
  let tourIndex = 0;

  // Event details say "prepull N" / "priority N" (1-based positions in the export).
  const prepullRows = apl.prepullActions
    .map((item, index) => ({item, id: `apl-prepull-${index + 1}`, label: secondsLabel(prepullTime(item))}))
    .sort((a, b) => prepullTime(a.item) - prepullTime(b.item));
  addApl(prepullRows, 'Before the pull', catalog);
  addApl(apl.priorityList.map((item, index) => ({item, id: `apl-priority-${index + 1}`, label: String(index + 1).padStart(2, '0')})),
    'Combat priority', catalog, true);
  for (const group of apl.groups) {
    addApl(group.actions.map((item, index) => ({item, label: String(index + 1).padStart(2, '0')})), `${group.name} group`, catalog);
  }

  const attackTrack = kind => {
    const records = [];
    const order = [];
    for (const [index, event] of events.entries()) {
      if (event[1] !== kind) continue;
      records.push(event);
      order.push(logOrder.events[index]);
    }
    return {records, order};
  };
  const autos = attackTrack('ranged');
  const swings = attackTrack('melee');
  let from = clipStart;
  let to = clipEnd;
  let first = 53;
  let last = 75;
  let time = from;
  let eventLine = Infinity;
  let eventIndex = first;
  let pendingStop = null;
  let tourSteps = combatTour;
  let renderedIndex = -1;
  let frame = null;
  let previousTime = null;

  let damageStart = 0;
  let damageCursor = -1;
  let totalDamage = 0;
  const damageFormat = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0});
  const dpsFormat = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1});

  function updateDamage() {
    // Damage immediately following a selected cast belongs to that step, up to
    // the next visible action at the same logged timestamp.
    const next = events[eventIndex + 1];
    const damageLine = eventLine !== Infinity && next?.[0] === time
      ? logOrder.events[eventIndex + 1] - 1
      : Infinity;
    const cursor = lastAt(damage, time, logOrder.damage, damageLine);
    if (cursor !== damageCursor) {
      damageCursor = cursor;
      const byAbility = new Map();
      totalDamage = 0;
      for (let index = damageStart; index <= cursor; index++) {
        const [, name, amount] = damage[index];
        byAbility.set(name, (byAbility.get(name) ?? 0) + amount);
        totalDamage += amount;
      }
      const rows = [...byAbility].sort((a, b) => b[1] - a[1]).map(([name, amount]) => {
        const row = document.createElement('li');
        const share = amount / totalDamage;
        row.style.setProperty('--share', `${share * 100}%`);
        const label = document.createElement('span');
        label.textContent = name;
        const value = document.createElement('span');
        value.textContent = `${damageFormat.format(amount)} · ${Math.round(share * 100)}%`;
        row.append(label, value);
        return row;
      });
      $('damage-breakdown').replaceChildren(...rows);
      $('no-damage').hidden = rows.length > 0;
      $('damage-total').textContent = damageFormat.format(totalDamage);
    }
    const elapsed = time - Math.max(0, from);
    $('damage-dps').textContent = elapsed >= 1 ? dpsFormat.format(totalDamage / elapsed) : '—';
  }

  function setScope() {
    const full = $('scope').value === 'full';
    from = full ? start : clipStart;
    to = full ? duration : clipEnd;
    first = lastAt(events, from, logOrder.events, -1) + 1;
    last = lastAt(events, to);
    tourSteps = full ? openerTour : combatTour;
    damageStart = lastAt(damage, Math.max(0, from), logOrder.damage, -1) + 1;
    damageCursor = null;
    $('damage-scope').textContent = full ? 'Since the pull' : 'This loop';
    seek.min = from;
    seek.max = to.toFixed(2);
    $('clip-summary').textContent = full
      ? 'Follow your recorded opener, or explore the whole sim run.'
      : `Three recorded weaves from your APL. The clip loops from ${clipStart.toFixed(2)} s to ${clipEnd.toFixed(2)} s.`;
    $('window-label').textContent = full ? `Full fight · ${timeText(from)} to ${timeText(to)}` : `Weave loop · ${timeText(from)} to ${timeText(to)}`;
    $('markers').replaceChildren();
    for (let i = first; i <= last; i++) {
      const [at, kind] = events[i];
      const marker = document.createElement('span');
      marker.className = 'marker';
      marker.dataset.kind = kind;
      marker.style.left = `${100 * (at - from) / (to - from)}%`;
      $('markers').append(marker);
    }
    $('axis').replaceChildren();
    for (let i = 0; i <= 4; i++) {
      const label = document.createElement('span');
      label.textContent = timeText(from + i / 4 * (to - from));
      label.style.left = `${i * 25}%`;
      $('axis').append(label);
    }
    drawDistance(moves, from, to);
    jump(first);
  }

  function countdown({records, order}, bar) {
    const index = lastAt(records, time, order, eventLine);
    const next = records[index + 1];
    const previous = records[index];
    $(bar).value = previous && next ? (time - previous[0]) / (next[0] - previous[0]) : 0;
    return next ? `${(next[0] - time).toFixed(2)} s` : '—';
  }

  function describeEvent(kind, detail) {
    const box = $('event-description');
    box.replaceChildren(explanations[kind] ?? '');
    if (!detail) return;
    const apl = /^(prepull|priority) (\d+)$/.exec(detail);
    if (apl) {
      const [, list, number] = apl;
      const link = document.createElement('a');
      link.href = `#apl-${list}-${number}`;
      link.textContent = list === 'priority' ? `APL priority #${number}` : `pre-pull action #${number}`;
      link.addEventListener('click', event => {
        event.preventDefault();
        revealAplRow(`apl-${list}-${number}`);
      });
      box.append(' From ', link, '.');
      return;
    }
    const move = /^([\d.]+) to ([\d.]+) yd · ([\d.]+)s$/.exec(detail);
    if (move) {
      box.append(` ${move[1]} → ${move[2]} yd over ${move[3]} s.`);
      return;
    }
    box.append(` ${detail}`);
  }

  function renderEvent() {
    const [, kind, name, icon, detail] = events[eventIndex];
    const baseName = name.replace(/^(Start|Queue) /, '');
    for (const [spell, tile] of spellTiles) tile.classList.toggle('active', spell === baseName);
    $('event-name').textContent = name;
    describeEvent(kind, detail);
    const nextEvent = eventIndex < last ? events[eventIndex + 1] : null;
    $('next-event').textContent = nextEvent
      ? `Up next: ${nextEvent[2]} at ${timeText(nextEvent[0])}`
      : $('scope').value === 'clip'
        ? `Loop restarts at ${timeText(from)}`
        : 'Last event in this run';
    const iconBox = $('event-icon');
    iconBox.replaceChildren();
    if (icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.width = img.height = 38;
      img.src = `icons/${icon}.jpg`;
      img.addEventListener('error', () => img.remove());
      iconBox.append(img);
    }

    const log = $('event-log');
    const feedStart = Math.max(first, eventIndex - 4);
    const rows = events.slice(feedStart, eventIndex + 1).reverse().map(([at, type, title, , note], offset) => {
      const index = eventIndex - offset;
      const li = document.createElement('li');
      const button = document.createElement('button');
      const timestamp = document.createElement('time');
      timestamp.textContent = timeText(at);
      button.type = 'button';
      if (index === eventIndex) button.setAttribute('aria-current', 'true');
      li.dataset.kind = type;
      const moveNote = type === 'move' ? /^([\d.]+) to ([\d.]+) yd/.exec(note ?? '') : null;
      button.append(timestamp, document.createTextNode(moveNote ? `${title} · ${moveNote[1]} → ${moveNote[2]} yd` : title));
      button.addEventListener('click', () => {
        jump(index);
        log.querySelector('[aria-current]')?.focus();
      });
      li.append(button);
      return li;
    });
    log.replaceChildren(...rows);
    renderedIndex = eventIndex;
  }

  function render() {
    const move = moves[lastAt(moves, time, logOrder.moves, eventLine)];
    let distance = positionAt(move, time);
    // Log timestamps are rounded to 0.01 s, so interpolating a walk-in to the
    // moment of a swing can land a few hundredths of a yard short of melee
    // range (e.g. 5.02 yd). A logged swing proves the hunter was in range, so
    // snap to the boundary when the gap is within that rounding error.
    if (distance > MELEE_RANGE && distance - MELEE_RANGE < 0.1) {
      const swing = lastAt(swings.records, time, swings.order, eventLine);
      if (swings.records[swing]?.[0] === time) distance = MELEE_RANGE;
    }
    const walking = time >= 0 && move && time < move[0] + move[3] && Math.abs(move[1] - move[2]) > 0.5;
    const inMelee = distance <= MELEE_RANGE + 0.0001;
    const phase = walking && move[2] > move[1] ? 3 : inMelee ? 2 : walking ? 1 : 0;
    phases.forEach((card, index) => {
      if (index === phase) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
    });
    const [, amount, maximum] = mana[Math.max(0, lastAt(mana, time, logOrder.mana, eventLine))];
    updateDamage();
    $('clock').textContent = timeText(time);
    seek.value = Math.min(time, Number(seek.max));
    seek.setAttribute('aria-valuetext', timeText(time));
    drawArena(distance, inMelee ? 'Melee' : distance < SHOOT_RANGE - 0.0001 ? 'Dead zone' : 'Ranged');
    $('distance').textContent = `${distance.toFixed(2)} yd`;
    $('auto').textContent = countdown(autos, 'auto-bar');
    $('swing').textContent = countdown(swings, 'swing-bar');
    $('mana').textContent = `${amount.toLocaleString()} / ${maximum.toLocaleString()}`;
    $('mana-bar').max = maximum;
    $('mana-bar').value = amount;
    $('prev').disabled = eventIndex === first;
    $('next').disabled = eventIndex === last;
    $('chart-cursor').style.left = `${100 * (time - from) / (to - from)}%`;
    if (eventIndex !== renderedIndex) renderEvent();
  }

  function pause() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    $('toggle').textContent = '▶ Play';
  }

  function jump(index, fromTour = false, at = events[index][0]) {
    if (!fromTour) closeTour();
    pause();
    eventIndex = index;
    time = at;
    eventLine = time === events[index][0] ? logOrder.events[index] : Infinity;
    render();
  }

  function play() {
    $('toggle').textContent = '❚❚ Pause';
    frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    // Clamp the frame gap so a backgrounded tab does not leap ahead on return.
    if (previousTime !== null) time += Math.min(0.25, (now - previousTime) / 1000) * Number($('speed').value);
    eventLine = Infinity;
    previousTime = now;
    if (pendingStop !== null && time >= pendingStop) {
      pendingStop = null;
      showTourStep();
      return;
    }
    if (time >= to) {
      if ($('scope').value === 'clip') time = from + (time - from) % (to - from);
      else {
        time = to;
        pause();
        eventIndex = last;
        render();
        return;
      }
    }
    eventIndex = Math.max(first, lastAt(events, time));
    render();
    frame = requestAnimationFrame(tick);
  }

  function showTourStep() {
    const [index, title, copy, at = events[index][0]] = tourSteps[tourIndex];
    jump(index, true, at);
    $('tour-count').textContent = `Step ${tourIndex + 1} of ${tourSteps.length} · ${timeText(time)}`;
    $('tour-title').textContent = title;
    $('tour-copy').textContent = copy;
    $('tour-back').disabled = tourIndex === 0;
    $('tour-next').textContent = tourIndex === tourSteps.length - 1 ? 'Play replay' : 'Continue';
    $('tour-next').disabled = false;
    render();
    $('tour-title').focus({preventScroll: true});
  }

  function closeTour() {
    pendingStop = null;
    $('tour').hidden = true;
    pause();
  }

  $('tour-start').onclick = () => {
    pendingStop = null;
    tourIndex = 0;
    $('tour').hidden = false;
    showTourStep();
  };
  $('tour-back').onclick = () => {
    pendingStop = null;
    tourIndex--;
    showTourStep();
  };
  $('tour-next').onclick = () => {
    if (tourIndex === tourSteps.length - 1) {
      closeTour();
      $('toggle').focus();
      play();
      return;
    }
    tourIndex++;
    const [index, , , at = events[index][0]] = tourSteps[tourIndex];
    if (at <= time) return showTourStep();
    pendingStop = at;
    $('tour-next').disabled = true;
    play();
  };
  $('tour-close').onclick = () => {
    closeTour();
    $('tour-start').focus();
  };

  $('toggle').onclick = () => {
    if (frame !== null) {
      pause();
      if (pendingStop !== null) {
        pendingStop = null;
        showTourStep();
      }
      return;
    }
    closeTour();
    if (time >= to) jump(first);
    play();
  };
  $('scope').onchange = setScope;
  $('next').onclick = () => jump(Math.min(last, eventIndex + 1));
  $('prev').onclick = () => jump(Math.max(first, eventIndex - 1));
  $('reset').onclick = () => jump(first);
  function scrub(value) {
    closeTour();
    time = Math.max(from, Math.min(to, value));
    eventLine = Infinity;
    eventIndex = Math.max(first, lastAt(events, time));
    render();
  }
  seek.oninput = () => scrub(seek.value === seek.max ? to : Number(seek.value));
  const chart = $('distance-chart');
  function scrubChart(event) {
    const rect = chart.getBoundingClientRect();
    scrub(from + (event.clientX - rect.left) / rect.width * (to - from));
  }
  chart.addEventListener('pointerdown', event => {
    chart.setPointerCapture(event.pointerId);
    scrubChart(event);
  });
  chart.addEventListener('pointermove', event => {
    if (chart.hasPointerCapture(event.pointerId)) scrubChart(event);
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.('input, select, button, a, summary, textarea')) return;
    const controls = {Space: 'toggle', ArrowRight: 'next', ArrowLeft: 'prev'};
    if (Object.hasOwn(controls, event.code)) {
      event.preventDefault();
      $(controls[event.code]).click();
    }
  });

  // Redraw the canvases when their size or the colour scheme changes.
  const redraw = () => {
    drawDistance(moves, from, to);
    render();
  };
  let resizeFrame = null;
  const scheduleRedraw = () => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      redraw();
    });
  };
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleRedraw);
    observer.observe($('arena-map'));
    observer.observe(chart);
  } else {
    window.addEventListener('resize', scheduleRedraw);
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', scheduleRedraw);
  document.fonts?.ready.then(scheduleRedraw);

  setScope();
}

// Links that point at the dead-zone explainer open it before scrolling there.
document.addEventListener("click", event => {
  const link = event.target.closest?.("a[data-open]");
  if (!link) return;
  const panel = document.getElementById(link.dataset.open);
  if (panel?.tagName === "DETAILS") panel.open = true;
});
const openFromHash = () => {
  if (location.hash === "#deadzone") document.getElementById("deadzone").open = true;
};
openFromHash();
window.addEventListener("hashchange", openFromHash);

Promise.all([
  fetch('trace.json').then(response => response.json()),
  fetch('apl.json').then(response => response.json()),
  fetch('source.txt').then(response => response.text()),
]).then(data => startReplay(...data)).catch(error => {
  $('event-name').textContent = 'Replay unavailable';
  $('event-description').textContent = 'The replay data could not be loaded. Refresh the page to try again.';
  console.error(error);
});
