'use strict';

// ── Storage key ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'mordhiem_v1';

// ── Round-robin: each tournament "round" is a full cycle (everyone vs everyone once).
// Returns one entry per set (scheduling slot): { matches: [[p1,p2],...], byePlayer: id|null }
function roundRobinSchedule(playerIds, rotationOffset = 0) {
  if (playerIds.length < 2) return [];
  let roster = [...playerIds];
  if (roster.length % 2 !== 0) roster.push('bye');

  const n = roster.length;
  const numRounds = n - 1;
  const half = n / 2;
  let arr = roster.slice();
  const rot = ((rotationOffset % n) + n) % n;
  if (rot > 0) arr = [...arr.slice(rot), ...arr.slice(0, rot)];

  const out = [];
  for (let r = 0; r < numRounds; r++) {
    const matches = [];
    let byePlayer = null;
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === 'bye') byePlayer = b;
      else if (b === 'bye') byePlayer = a;
      else matches.push([a, b]);
    }
    out.push({ matches, byePlayer });

    const fixed = arr[0];
    const rest = arr.slice(1);
    const last = rest.pop();
    rest.unshift(last);
    arr = [fixed, ...rest];
  }
  return out;
}

function setsFromSchedule(sched) {
  return sched.map((sd, idx) => {
    const matches = sd.matches.map(([p1, p2]) => ({
      id: freshId(), p1, p2, result: null, played: false,
    }));
    if (sd.byePlayer) {
      matches.push({
        id: freshId(), p1: sd.byePlayer, p2: 'bye', result: 'p1', played: true,
      });
      state.byeHistory.push(sd.byePlayer);
    }
    return { setNumber: idx + 1, matches };
  });
}

// Blank slate used by Reset — no players, no rounds.
function defaultState() {
  state = {
    players: [],
    rounds: [],
    byeHistory: [],
    idCounter: 1,
  };
}

// The current live tournament seeded on first ever visit (nothing in localStorage).
// Round 1 is a full round-robin (5 sets). Andy beat Bill and Lucas beat Geoff in Set 1.
// Circle order [andy, geoff, adrian, phil, lucas, bill] → Set 1: Andy–Bill, Geoff–Lucas, Adrian–Phil.
function initialTournamentState() {
  state = {
    players: [
      { id: 'andy',   name: 'Andy',   active: true },
      { id: 'bill',   name: 'Bill',   active: true },
      { id: 'geoff',  name: 'Geoff',  active: true },
      { id: 'lucas',  name: 'Lucas',  active: true },
      { id: 'adrian', name: 'Adrian', active: true },
      { id: 'phil',   name: 'Phil',   active: true },
    ],
    rounds: [],
    byeHistory: [],
    idCounter: 1,
  };

  const sched = roundRobinSchedule(['andy', 'geoff', 'adrian', 'phil', 'lucas', 'bill'], 0);
  const sets = setsFromSchedule(sched);
  sets[0].matches[0].result = 'p1';
  sets[0].matches[0].played = true;
  sets[0].matches[1].result = 'p2';
  sets[0].matches[1].played = true;

  state.rounds.push({ roundNumber: 1, sets });
}

// ── State ────────────────────────────────────────────────────────────────────
let state;

function migrateLegacyRound(rnd) {
  if (rnd.sets) return rnd;
  return {
    roundNumber: rnd.roundNumber,
    sets: [{ setNumber: 1, matches: rnd.matches || [] }],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      if (!state.byeHistory) state.byeHistory = [];
      if (!state.idCounter) state.idCounter = 100;
      state.rounds = state.rounds.map(migrateLegacyRound);
      return;
    }
  } catch (_) { /* fall through */ }
  initialTournamentState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function pairKey(a, b) { return [a, b].sort().join('|'); }
function getPlayer(id) { return state.players.find(p => p.id === id) || null; }
function playerName(id) { if (id === 'bye') return 'BYE'; const p = getPlayer(id); return p ? p.name : '?'; }
function currentRound() { return state.rounds.length ? state.rounds[state.rounds.length - 1] : null; }

function allMatchesInRound(rnd) {
  return rnd.sets.flatMap(s => s.matches);
}

function isComplete(rnd) {
  return rnd.sets.every(s => s.matches.every(m => m.played));
}

/** First set index that still has an unplayed real match, or -1 if round complete */
function activeSetIndex(rnd) {
  for (let i = 0; i < rnd.sets.length; i++) {
    if (rnd.sets[i].matches.some(m => !m.played && m.p2 !== 'bye')) return i;
  }
  return -1;
}

function freshId() { return `m${state.idCounter++}`; }

function findMatchInRound(roundIdx, matchId) {
  const rnd = state.rounds[roundIdx];
  if (!rnd) return null;
  for (const set of rnd.sets) {
    const m = set.matches.find(x => x.id === matchId);
    if (m) return m;
  }
  return null;
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function computeScores() {
  const map = {};
  state.players.forEach(p => {
    map[p.id] = { id: p.id, name: p.name, active: p.active, pts: 0, w: 0, d: 0, l: 0, played: 0 };
  });

  state.rounds.forEach(rnd => {
    allMatchesInRound(rnd).forEach(m => {
      if (!m.played || m.p1 === 'bye' || m.p2 === 'bye') return;
      const s1 = map[m.p1], s2 = map[m.p2];
      if (!s1 || !s2) return;
      s1.played++; s2.played++;
      if      (m.result === 'p1')   { s1.pts += 3; s1.w++; s2.l++; }
      else if (m.result === 'p2')   { s2.pts += 3; s2.w++; s1.l++; }
      else if (m.result === 'draw') { s1.pts++; s1.d++; s2.pts++; s2.d++; }
    });
  });

  return Object.values(map).sort((a, b) =>
    b.pts !== a.pts ? b.pts - a.pts :
    b.w   !== a.w   ? b.w   - a.w   :
    a.name.localeCompare(b.name)
  );
}

// ── Round generation ──────────────────────────────────────────────────────────
function generateNextRound() {
  const active = state.players.filter(p => p.active).map(p => p.id);
  if (active.length < 2) {
    alert('Need at least 2 active players to generate a round.');
    return false;
  }

  active.sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const rotation = state.rounds.length % active.length;
  const sched = roundRobinSchedule(active, rotation);
  const sets = setsFromSchedule(sched);

  const roundNumber = state.rounds.length + 1;
  state.rounds.push({ roundNumber, sets });
  saveState();
  return true;
}

// ── Match actions ──────────────────────────────────────────────────────────────
function setMatchResult(roundIdx, matchId, result) {
  const match = findMatchInRound(roundIdx, matchId);
  if (!match) return;

  match.result = result;
  match.played = true;
  saveState();
  render();
}

function undoMatch(roundIdx, matchId) {
  const match = findMatchInRound(roundIdx, matchId);
  if (!match || match.p2 === 'bye') return;

  match.result = null;
  match.played = false;
  saveState();
  render();
}

// ── Player actions ─────────────────────────────────────────────────────────────
function addPlayer(name) {
  const n = name.trim();
  if (!n) return false;
  const id = 'p_' + n.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
  state.players.push({ id, name: n, active: true });
  saveState();
  render();
  return true;
}

function toggleActive(playerId) {
  const p = getPlayer(playerId);
  if (!p) return;
  p.active = !p.active;
  saveState();
  render();
}

function resetTournament() {
  if (!confirm('Reset ALL tournament data? This will clear all players and matches. This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  defaultState();
  saveState();
  render();
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId)
  );
  document.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${tabId}`)
  );
}

// ── Render: Upcoming / Current round ──────────────────────────────────────────
function renderUpcoming() {
  const title   = document.getElementById('upcoming-title');
  const content = document.getElementById('upcoming-content');
  const rnd     = currentRound();

  if (!rnd) {
    title.textContent = 'Upcoming Matches';
    content.innerHTML = '<p class="empty">No rounds yet — go to Admin to generate the first round.</p>';
    return;
  }

  const nSets = rnd.sets.length;
  const aIdx  = activeSetIndex(rnd);

  if (aIdx < 0) {
    title.textContent = `Round ${rnd.roundNumber}`;
    content.innerHTML = `
      <div class="round-complete">
        <p>Round ${rnd.roundNumber} complete (${nSets} set${nSets !== 1 ? 's' : ''} — everyone played everyone).</p>
        <button class="btn btn-primary" onclick="handleGenerate()">Generate Round ${rnd.roundNumber + 1}</button>
      </div>`;
    return;
  }

  title.textContent = `Round ${rnd.roundNumber}`;

  const roundIdx = state.rounds.length - 1;

  // A player is "ready" if they have no unplayed real match in any set before setIdx.
  function playerReady(playerId, setIdx) {
    for (let s = 0; s < setIdx; s++) {
      const earlier = rnd.sets[s].matches.find(
        m => !m.played && m.p2 !== 'bye' && (m.p1 === playerId || m.p2 === playerId)
      );
      if (earlier) return false;
    }
    return true;
  }

  // Collect every unplayed match across all sets where both players are ready.
  const playable = [];
  const waiting  = [];   // { set, match } still blocked

  rnd.sets.forEach((st, sIdx) => {
    st.matches
      .filter(m => !m.played && m.p2 !== 'bye')
      .forEach(m => {
        if (playerReady(m.p1, sIdx) && playerReady(m.p2, sIdx)) {
          playable.push({ set: st, match: m });
        } else {
          waiting.push({ set: st, match: m });
        }
      });
  });

  // Group playable matches by set number for display.
  const playableBySets = [];
  playable.forEach(({ set: st, match: m }) => {
    let entry = playableBySets.find(e => e.setNumber === st.setNumber);
    if (!entry) { entry = { setNumber: st.setNumber, matches: [] }; playableBySets.push(entry); }
    entry.matches.push(m);
  });

  const grid = playableBySets.map(entry => {
    const cards = entry.matches.map(m => {
      const n1 = playerName(m.p1), n2 = playerName(m.p2);
      return `
        <div class="match-card">
          <div class="match-players">${n1} <span class="vs">vs</span> ${n2}</div>
          <div class="match-actions">
            <button class="result-btn btn-win"  onclick="setMatchResult(${roundIdx},'${m.id}','p1')">${n1} Won</button>
            <button class="result-btn btn-draw" onclick="setMatchResult(${roundIdx},'${m.id}','draw')">Draw</button>
            <button class="result-btn btn-win"  onclick="setMatchResult(${roundIdx},'${m.id}','p2')">${n2} Won</button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="set-group">
        <h3 class="set-group-heading">Round ${rnd.roundNumber} &middot; Set ${entry.setNumber} of ${nSets}</h3>
        <div class="match-grid">${cards}</div>
      </div>`;
  }).join('');

  // Group waiting matches by set for the preview list.
  const waitingBySets = [];
  waiting.forEach(({ set: st, match: m }) => {
    let entry = waitingBySets.find(e => e.setNumber === st.setNumber);
    if (!entry) { entry = { setNumber: st.setNumber, lines: [] }; waitingBySets.push(entry); }
    entry.lines.push(`${playerName(m.p1)} vs ${playerName(m.p2)}`);
  });

  let previewHtml = '';
  if (waitingBySets.length > 0) {
    const blocks = waitingBySets.map(e => `
      <div class="later-set-row">
        <span class="later-set-label">Set ${e.setNumber}</span>
        <span class="later-set-pairs">${e.lines.join(', ')}</span>
      </div>`).join('');
    previewHtml = `
      <div class="later-sets-card">
        <h3 class="later-sets-heading">Waiting on earlier results</h3>
        <p class="hint" style="margin-top:0;margin-bottom:.6rem">These matches unlock once both players have finished their earlier game.</p>
        ${blocks}
      </div>`;
  }

  const main = grid || '<p class="empty">No matches ready to play yet.</p>';

  content.innerHTML = main + previewHtml;
}

// ── Render: Scoreboard ─────────────────────────────────────────────────────────
function renderScoreboard() {
  const content = document.getElementById('scoreboard-content');
  const scores  = computeScores();

  const rows = scores.map((s, i) => `
    <tr class="${s.active ? '' : 'inactive'}">
      <td class="col-rank">${i + 1}</td>
      <td class="col-name">${s.name}${s.active ? '' : '<span class="tag-inactive">inactive</span>'}</td>
      <td class="col-pts">${s.pts}</td>
      <td class="col-num">${s.w}</td>
      <td class="col-num">${s.d}</td>
      <td class="col-num">${s.l}</td>
      <td class="col-num">${s.played}</td>
    </tr>`).join('');

  content.innerHTML = `
    <table class="scoreboard-table">
      <thead>
        <tr>
          <th class="col-rank">#</th>
          <th>Player</th>
          <th>Pts</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>GP</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Render: Match History ──────────────────────────────────────────────────────
function renderHistory() {
  const content = document.getElementById('history-content');

  const withPlayed = state.rounds.filter(r =>
    allMatchesInRound(r).some(m => m.played && m.p1 !== 'bye' && m.p2 !== 'bye')
  );

  if (withPlayed.length === 0) {
    content.innerHTML = '<p class="empty">No matches recorded yet.</p>';
    return;
  }

  const sorted = [...withPlayed].sort((a, b) => b.roundNumber - a.roundNumber);

  const html = sorted.map((rnd, idx) => {
    const roundIdx = state.rounds.indexOf(rnd);
    const isCurrentRound = roundIdx === state.rounds.length - 1;

    const setBlocks = rnd.sets.map(st => {
      const rows = st.matches
        .filter(m => m.played && m.p1 !== 'bye' && m.p2 !== 'bye')
        .map(m => {
          const n1 = playerName(m.p1), n2 = playerName(m.p2);
          let result = 'Draw';
          if      (m.result === 'p1') result = `<strong>${n1}</strong> won`;
          else if (m.result === 'p2') result = `<strong>${n2}</strong> won`;
          const undo = isCurrentRound
            ? `<button type="button" class="undo-btn history-undo" onclick="undoMatch(${roundIdx},'${m.id}')">Clear (pending)</button>`
            : '';
          return `
            <div class="history-match">
              <div class="history-match-top">
                <span class="history-players">${n1} vs ${n2}</span>
                <span class="history-result">${result}</span>
              </div>
              <div class="history-match-edit">
                <span class="history-edit-label">Change result</span>
                <button type="button" class="result-btn btn-win history-edit-btn"
                  onclick="setMatchResult(${roundIdx},'${m.id}','p1')">${n1} won</button>
                <button type="button" class="result-btn btn-draw history-edit-btn"
                  onclick="setMatchResult(${roundIdx},'${m.id}','draw')">Draw</button>
                <button type="button" class="result-btn btn-win history-edit-btn"
                  onclick="setMatchResult(${roundIdx},'${m.id}','p2')">${n2} won</button>
                ${undo}
              </div>
            </div>`;
        }).join('');

      if (!rows) return '';
      return `
        <div class="history-set-block">
          <div class="history-set-title">Set ${st.setNumber}</div>
          <div class="history-matches">${rows}</div>
        </div>`;
    }).join('');

    const open = idx === 0 ? 'open' : '';
    return `
      <details class="round-details" ${open}>
        <summary>Round ${rnd.roundNumber}</summary>
        ${setBlocks}
      </details>`;
  }).join('');

  content.innerHTML = html;
}

// ── Render: Admin ──────────────────────────────────────────────────────────────
function renderAdmin() {
  const playerEl = document.getElementById('admin-players');
  playerEl.innerHTML = state.players.map(p => `
    <div class="player-item ${p.active ? '' : 'inactive'}">
      <span class="player-item-name">${p.name}</span>
      <button class="btn btn-ghost" style="font-size:.8rem;padding:.28rem .65rem"
              onclick="toggleActive('${p.id}')">
        ${p.active ? 'Remove' : 'Re-add'}
      </button>
    </div>`).join('') || '<p class="empty">No players.</p>';

  const ctrlEl = document.getElementById('admin-round-controls');
  const rnd    = currentRound();
  let statusMsg = '', warningMsg = '';

  if (!rnd) {
    statusMsg = 'No rounds generated yet.';
  } else if (isComplete(rnd)) {
    statusMsg = `Round ${rnd.roundNumber} is complete. Ready to generate Round ${rnd.roundNumber + 1}.`;
  } else {
    const left = allMatchesInRound(rnd).filter(m => !m.played && m.p2 !== 'bye').length;
    const nSets = rnd.sets.length;
    const cur   = activeSetIndex(rnd);
    statusMsg  = `Round ${rnd.roundNumber} in progress — Set ${rnd.sets[cur].setNumber} of ${nSets} active (${left} game${left !== 1 ? 's' : ''} left in the round).`;
    warningMsg = 'Generating now will leave the current round unfinished.';
  }

  ctrlEl.innerHTML = `
    <p class="round-status">${statusMsg}</p>
    ${warningMsg ? `<p class="hint" style="color:#e8c04a;margin-bottom:.75rem">⚠ ${warningMsg}</p>` : ''}
    <button class="btn btn-primary" onclick="handleGenerate()">Generate Next Round</button>`;
}

// ── Master render ──────────────────────────────────────────────────────────────
function render() {
  renderUpcoming();
  renderScoreboard();
  renderHistory();
  renderAdmin();
}

// ── Global handlers (used by inline onclick attributes) ────────────────────────
window.setMatchResult = setMatchResult;
window.undoMatch      = undoMatch;
window.toggleActive   = toggleActive;

window.handleGenerate = function () {
  const rnd = currentRound();
  if (rnd && !isComplete(rnd)) {
    if (!confirm(`Round ${rnd.roundNumber} is not finished yet. Generate Round ${rnd.roundNumber + 1} anyway?`)) return;
  }
  if (generateNextRound()) {
    render();
    switchTab('tournament');
  }
};

// ── Bootstrap ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadState();

  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  const input = document.getElementById('add-player-input');
  document.getElementById('add-player-btn').addEventListener('click', () => {
    if (addPlayer(input.value)) input.value = '';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && addPlayer(input.value)) input.value = '';
  });

  document.getElementById('reset-btn').addEventListener('click', resetTournament);

  render();
});
