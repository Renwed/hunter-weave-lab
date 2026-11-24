const $ = id => document.getElementById(id);
const seek = $('seek');
const start = Number(seek.min);
const explanations = {
  move: 'Follow the range indicator as your hunter crosses the dead zone.',
  melee: 'The weapon connects or attempts a hit at melee range.',
  ranged: 'The ranged weapon fires automatically.',
  cast: 'An ability executes according to your action priority list.',
  cooldown: 'Your setup uses an offensive cooldown or consumable.',
};

function timeText(seconds) {
  const hundredths = Math.round(Math.abs(seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const remainder = ((hundredths % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${seconds < 0 ? '−' : ''}${minutes}:${remainder}`;
}

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

function actionName(action, catalog) {
  const [kind, value] = Object.entries(action).find(([key]) => key !== 'condition') ?? ['', {}];
  const id = value.spellId;
  if (id) {
    const name = catalog[`s${id.spellId}`]?.[0] ?? catalog[`i${id.itemId}`]?.[0] ??
      (id.otherId === 'OtherActionResourcePotion' ? 'Resource potion' : 'Spell ' + id.spellId);
    if (id.tag === 1 && id.spellId === 14266) return 'Queue ' + name;
    if (kind === 'multidot') return `${name} (up to ${value.maxDots} targets)`;
    return name;
  }
  if (kind === 'autocastOtherCooldowns') return 'Use other cooldowns';
  if (kind === 'groupReference') return 'Run ' + value.groupName;
  if (kind === 'move' && value.rangeFromTarget?.const) return 'Move to ' + value.rangeFromTarget.const.val + ' yd';
  if (kind === 'move') return 'Move to calculated range';
  if (kind === 'wait' && value.duration?.const) return 'Wait ' + value.duration.const.val;
  return plainWords(kind);
}

function prepullTime(item) {
  const value = item.doAtValue.const.val;
  return Number.parseFloat(value) / (value.endsWith('ms') ? 1000 : 1);
}

function addApl(entries, title, type, catalog, expanded = false) {
  const section = document.createElement('details');
  section.open = expanded;
  const heading = document.createElement('summary');
  heading.textContent = `${title} · ${entries.length}`;
  const list = document.createElement('ol');
  list.className = 'apl-list';
  entries.forEach((item, index) => {
    const row = document.createElement('li');
    row.className = 'apl-row';
    const order = document.createElement('span');
    order.textContent = type === 'prepull' ? item.doAtValue.const.val : String(index + 1).padStart(2, '0');
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
  });
  section.append(heading, list);
  $('apl').append(section);
}

function drawArena(distance, zone) {
  const canvas = $('arena-map');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {width, height} = canvas;
  const x = width / 2 - 65;
  const y = height / 2;
  const scale = 13.5;
  ctx.clearRect(0, 0, width, height);
  const ring = (r, fill, stroke) => {
    ctx.beginPath();
    ctx.arc(x, y, r * scale, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.stroke();
  };
  ring(13.3, '#4b7c911f', '#577b8b');
  ring(11.67, '#22293b', '#737788');
  ring(5, '#473037', '#d07470');
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 14 * scale, y);
  ctx.strokeStyle = '#b4c2df80';
  ctx.stroke();
  ctx.setLineDash([]);
  ring(1.3, '#f09480', '#ffd6ce');
  ctx.font = '600 17px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#171b29';
  ctx.fillText('B', x, y + 6);
  const playerX = x + distance * scale;
  ctx.beginPath();
  ctx.arc(playerX, y, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#89d9eb';
  ctx.fill();
  ctx.fillStyle = '#152035';
  ctx.fillText('H', playerX, y + 6);
  ctx.fillStyle = '#edf1ff';
  ctx.fillText(zone, playerX, y - 26);
}

function positionAt(move, time) {
  if (!move) return 12;
  return move[1] + (move[2] - move[1]) * Math.min(1, (time - move[0]) / move[3]);
}

function drawDistance(moves, from, to) {
  const canvas = $('distance-chart');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {width, height} = canvas;
  const y = distance => height - 7 - distance / 14 * (height - 14);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#72708729';
  ctx.fillRect(0, y(11.67), width, y(5) - y(11.67));
  ctx.beginPath();
  for (let x = 0; x <= width; x++) {
    const sample = from + x / width * (to - from);
    const sampleY = y(positionAt(moves[lastAt(moves, sample)], sample));
    if (x === 0) ctx.moveTo(x, sampleY);
    else ctx.lineTo(x, sampleY);
  }
  ctx.strokeStyle = '#89d9eb';
  ctx.lineWidth = 2;
  ctx.stroke();
}

const openerTour = [
  [0, 'Set up before the pull', 'At −20.00 s, your hunter casts Aspect of the Hawk. The pre-pull move at −19.00 s changes your starting position from 12.00 to 11.67 yd. Hunter’s Mark goes on at −3.30 s.'],
  [3, 'Pre-cast Aimed Shot', 'Start Aimed Shot at −1.70 s. The simulator then uses Major Frenzy Potion at −1.50 s while the cast is underway. Aimed Shot completes at 0.01 s, then its damage lands at 0.30 s.'],
  [7, 'Apply Serpent Sting at range', 'At 0.01 s the recorded order is Aimed Shot completion, Rapid Fire, then Serpent Sting. These events share a displayed timestamp. You are still at 11.67 yd.'],
  [8, 'Watch for the Auto Shot', 'The first Auto Shot fires at 0.43 s and hits at 0.72 s. In this run you remain at range until 0.99 s. Use the Bow timer to follow the recorded shot timing.'],
  [11, 'Queue Raptor Strike and walk in', 'At 0.99 s Dense Dynamite completes and Raptor Strike is queued. The walk begins at that same displayed time, toward 4.60 yd. Queueing Raptor Strike is separate from the swing that delivers it.'],
  [12, 'Swing as you reach melee', 'At 1.94 s, around the 5 yd melee boundary, the queued Raptor Strike is recorded as the melee attack. Strider Kick follows at the same displayed timestamp. The next weave can use a different melee action.'],
  [14, 'Walk back to shooting range', 'At 2.34 s you start back from 4.60 yd. The movement takes about 0.78 s. Wait for shooting range before using a ranged attack.'],
  [15, 'Resume ranged attacks', 'Arcane Shot fires at 3.44 s, followed by Auto Shot at 3.95 s. The next walk-in begins at 4.07 s and produces a normal melee swing in this run. Your APL checks each weave as the fight progresses.'],
];

const clipStart = 23.4;
const clipEnd = 35.44;
const combatTour = [
  [52, 'Begin at shooting range', 'At 23.40 s, your hunter is at 11.67 yd and begins casting Aimed Shot. The two timer bars follow the next recorded Auto Shot and melee swing.'],
  [53, 'Watch Auto Shot fire', 'Auto Shot fires at 24.72 s while Aimed Shot is still casting. The Auto Shot impact is logged at 25.01 s. Stay at range for the cast to finish.'],
  [54, 'Finish Aimed Shot', 'Aimed Shot completes at 25.11 s and hits at 25.40 s. The log also records the Raptor Strike queue and the start of the inward walk at this displayed timestamp.'],
  [55, 'Queue Raptor Strike', 'Queueing lines up Raptor Strike for the next melee swing. The cast entry here is the queue, so the strike itself appears later.'],
  [56, 'Cross the dead zone', 'The walk starts at 11.67 yd and heads toward 4.60 yd. Watch the marker cross the space between shooting and melee range.'],
  [58, 'Swing and use Strider Kick', 'At 26.06 s, Raptor Strike fires as you reach the 5 yd melee boundary. Strider Kick follows at the same displayed time.'],
  [59, 'Head back out', 'At 26.46 s, movement reverses. The return from 4.60 yd to 11.67 yd takes about 0.78 s.'],
  [59, 'Back at shooting range', 'You reach shooting range at about 27.24 s. The next recorded ranged action is Arcane Shot at 27.56 s.', 27.24],
];

function buildSpellBar(events, catalog) {
  const tiles = new Map();
  const eventIcons = new Map(events.map(([, , name, icon]) => [name, icon]));
  const groups = [
    ['At range', [['Auto Shot'], ['Aimed Shot'], ['Serpent Sting', 'Sting', 's13555'], ['Arcane Shot'], ['Multi-Shot', null, 's2643']]],
    ['In melee', [['Melee swing', 'Swing'], ['Raptor Strike'], ['Strider Kick'], ['Mongoose Bite', 'Bite'], ['Immolation Trap', 'Trap'], ['Wing Clip', null, 's14268']]],
    ['Movement', [['Move in', 'Walk in'], ['Move out', 'Walk out']]],
  ];
  for (const [label, spells] of groups) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = label;
    const row = document.createElement('ul');
    for (const [name, label, id] of spells) {
      const tile = document.createElement('li');
      tile.title = name;
      const icon = eventIcons.get(name) || catalog[id]?.[1];
      const picture = icon ? document.createElement('img') : document.createElement('span');
      if (icon) {
        picture.src = `icons/${icon}.jpg`;
        picture.alt = '';
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
    section.append(heading, row);
    $('spell-bar').append(section);
  }
  return tiles;
}

function startReplay({events, moves, mana, duration, catalog, damage, logOrder}, apl, source) {
  $('sim-link').href = source.trim();

  const spellTiles = buildSpellBar(events, catalog);
  const phases = Array.from(document.querySelectorAll('.weave-phases li'));
  let tourIndex = 0;
  addApl([...apl.prepullActions].sort((a, b) => prepullTime(a) - prepullTime(b)), 'Before the pull', 'prepull', catalog);
  addApl(apl.priorityList, 'Combat priority', 'priority', catalog, true);
  for (const group of apl.groups) addApl(group.actions, group.name + ' group', 'group', catalog);
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
  let first = 52;
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
    $('damage-scope').textContent = full ? 'Since pull' : 'This loop';
    seek.min = from;
    seek.max = to.toFixed(2);
    $('clip-summary').textContent = full
      ? 'Follow your recorded opener or explore the entire sim run.'
      : 'Three recorded weaves from your APL. The clip repeats from 23.40 to 35.44 s.';
    $('window-label').textContent = full ? 'Full fight' : 'Weave loop';
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

  function renderEvent() {
    const [, kind, name, icon, detail] = events[eventIndex];
    for (const [spell, tile] of spellTiles) {
      tile.classList.toggle('active', spell === name.replace(/^(Start|Queue) /, ''));
    }
    $('event-name').textContent = name;
    $('event-description').textContent = detail ? `${explanations[kind]} ${detail.startsWith('priority') || detail.startsWith('prepull') ? 'APL ' + detail + '.' : detail}` : explanations[kind];
    const nextEvent = eventIndex < last ? events[eventIndex + 1] : null;
    $('next-event').textContent = nextEvent
      ? `Up next · ${nextEvent[2]} at ${timeText(nextEvent[0])}`
      : $('scope').value === 'clip'
        ? `Loop restarts at ${timeText(from)}`
        : 'Last event in this iteration';
    const iconBox = $('event-icon');
    iconBox.replaceChildren();
    if (icon) {
      const img = document.createElement('img');
      img.alt = '';
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
      button.append(timestamp, document.createTextNode(type === 'move' ? `${title} · ${note}` : title));
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
    // The next logged movement segment starts at the measured melee boundary.
    // At the swing itself use that measurement rather than interpolating
    // from a rounded segment start and swing timestamp.
    const meleeBoundary = move?.[1] > 5 && moves[lastAt(moves, time)]?.[1] === 5;
    if (meleeBoundary) {
      const swing = lastAt(swings.records, time, swings.order, eventLine);
      if (swings.records[swing]?.[0] === time) distance = 5;
    }
    const walking = time >= 0 && move && time < move[0] + move[3] && Math.abs(move[1] - move[2]) > 0.5;
    const phase = walking && move[2] > move[1] ? 3 : distance <= 5.0001 ? 2 : walking ? 1 : 0;
    phases.forEach((card, index) => {
      if (index === phase) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
    });
    const [, amount, maximum] = mana[Math.max(0, lastAt(mana, time, logOrder.mana, eventLine))];
    updateDamage();
    $('clock').textContent = timeText(time);
    seek.value = Math.min(time, Number(seek.max));
    seek.setAttribute('aria-valuetext', timeText(time));
    drawArena(distance, distance <= 5.0001 ? 'Melee' : distance < 11.6699 ? 'Dead zone' : 'Ranged');
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
    $('toggle').textContent = 'Ⅱ Pause';
    frame = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (previousTime !== null) time += (now - previousTime) / 1000 * Number($('speed').value);
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
      event.target.closest('input, select, button, a, summary, textarea')) return;
    const controls = {Space: 'toggle', ArrowRight: 'next', ArrowLeft: 'prev'};
    if (Object.hasOwn(controls, event.code)) {
      event.preventDefault();
      $(controls[event.code]).click();
    }
  });
  setScope();
}

Promise.all([
  fetch('trace.json').then(response => response.json()),
  fetch('apl.json').then(response => response.json()),
  fetch('source.txt').then(response => response.text()),
]).then(data => startReplay(...data)).catch(error => {
  $('event-name').textContent = 'Replay unavailable';
  $('event-description').textContent = 'Refresh the page to try again.';
  console.error(error);
});
