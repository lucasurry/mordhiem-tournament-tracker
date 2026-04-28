'use strict';

// ── Storage key ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'mordhiem_v1';

// ── Default / initial state ─────────────────────────────────────────────────
// Round 1 is pre-seeded: Andy beat Bill, Lucas beat Geoff.
// Adrian vs Phil is the remaining unplayed match.
function defaultState() {
  return {
    players: [
      { id: 'andy',   name: 'Andy',   active: true },
      { id: 'bill',   name: 'Bill',   active: true },
      { id: 'geoff',  name: 'Geoff',  active: true },
      { id: 'lucas',  name: 'Lucas',  active: true },
      { id: 'adrian', name: 'Adrian', active: true },
      { id: 'phil',   name: 'Phil',   active: true },
    ],
    rounds: [
      {
        roundNumber: 1,
        matches: [
          { id: 'm1r1', p1: 'andy',   p2: 'bill',  result: 'p1',  played: true  },
          { id: 'm2r1', p1: 'geoff',  p2: 'lucas', result: 'p2',  played: true  },
          { id: 'm3r1', p1: 'adrian', p2: 'phil',  result: null,  played: false },
        ],
      },
    ],
    byeHistory: [],  // ids of players who received byes, in order
    idCounter:  20,  // monotonic id counter for new matches
  };
}

// ── State ────────────────────────────────────────────────────────────────────
let state;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      if (!state.byeHistory) state.byeHistory = [];
      if (!state.idCounter)  state.idCounter  = 100;
      return;
    }
  } catch (_) { /* fall through */ }
  state = defaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function pairKey(a, b)    { return [a, b].sort().join('|'); }
function getPlayer(id)    { return state.players.find(p => p.id === id) || null; }
function playerName(id)   { if (id === 'bye') return 'BYE'; const p = getPlayer(id); return p ? p.name : '?'; }
function currentRound()   { return state.rounds.length ? state.rounds[state.rounds.length - 1] : null; }
function isComplete(rnd)  { return rnd.matches.every(m => m.played); }
function freshId()        { return `m${state.idCounter++}`; }

// ── Scoring ───────────────────────────────────────────────────────────────────
function computeScores() {
  const map = {};
  state.players.forEach(p => {
    map[p.id] = { id: p.id, name: p.name, active: p.active, pts: 0, w: 0, d: 0, l: 0, played: 0 };
  });

  state.rounds.forEach(rnd => {
    rnd.matches.forEach(m => {
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

// ── Meeting counts ────────────────────────────────────────────────────────────
function meetingCounts() {
  const counts = {};
  state.rounds.forEach(rnd => {
    rnd.matches.forEach(m => {
      if (m.p1 === 'bye' || m.p2 === 'bye') return;
      const k = pairKey(m.p1, m.p2);
      counts[k] = (counts[k] || 0) + 1;
    });
  });
  return counts;
}

// ── Perfect-matching enumeration ──────────────────────────────────────────────
// Returns every possible way to pair up a list of players.
// For n=6 this is 15 matchings — fast enough for any practical player count.
function allMatchings(players) {
  if (players.length === 0) return [[]];
  const [first, ...rest] = players;
  const out = [];
  rest.forEach((partner, i) => {
    const remaining = rest.filter((_, j) => j !== i);
    allMatchings(remaining).forEach(sub => out.push([[first, partner], ...sub]));
  });
  return out;
}

// ── Round generation ──────────────────────────────────────────────────────────
// Generates a new round for the current active players.
// Returns true on success, false/alert on error.
function generateNextRound() {
  const active = state.players.filter(p => p.active).map(p => p.id);
  if (active.length < 2) {
    alert('Need at least 2 active players to generate a round.');
    return false;
  }

  let pool = [...active];
  let byeId = null;

  // ── BYE for odd-sized pools ──
  if (pool.length % 2 !== 0) {
    // Find who has had the fewest byes; break ties by avoiding the most-recent bye recipient
    const lastRnd = currentRound();
    const lastByeMatch = lastRnd && lastRnd.matches.find(m => m.p1 === 'bye' || m.p2 === 'bye');
    const lastByeId    = lastByeMatch
      ? (lastByeMatch.p1 === 'bye' ? lastByeMatch.p2 : lastByeMatch.p1)
      : null;

    const byeCount = Object.fromEntries(pool.map(id => [id, 0]));
    state.byeHistory.forEach(id => { if (id in byeCount) byeCount[id]++; });

    const sorted = [...pool].sort((a, b) => {
      if (a === lastByeId && b !== lastByeId) return  1;
      if (b === lastByeId && a !== lastByeId) return -1;
      return byeCount[a] - byeCount[b];
    });
    byeId = sorted[0];
    pool  = pool.filter(id => id !== byeId);
  }

  // ── Score every possible matching ──
  const counts     = meetingCounts();
  const lastPairs  = new Set();
  const last = currentRound();
  if (last) {
    last.matches.forEach(m => {
      if (m.p1 !== 'bye' && m.p2 !== 'bye') lastPairs.add(pairKey(m.p1, m.p2));
    });
  }

  const matchings = allMatchings(pool);
  let bestMatching = matchings[0];
  let bestScore    = Infinity;

  matchings.forEach(matching => {
    let score = 0;
    matching.forEach(([a, b]) => {
      score += (counts[pairKey(a, b)] || 0) * 10; // prefer fewer prior meetings
      if (lastPairs.has(pairKey(a, b))) score += 100;  // strongly avoid immediate repeats
    });
    if (score < bestScore) { bestScore = score; bestMatching = matching; }
  });

  // ── Build round ──
  const roundNumber = state.rounds.length + 1;
  const matches = bestMatching.map(([p1, p2]) => ({
    id: freshId(), p1, p2, result: null, played: false,
  }));

  if (byeId) {
    matches.push({ id: freshId(), p1: byeId, p2: 'bye', result: 'p1', played: true });
    state.byeHistory.push(byeId);
  }

  state.rounds.push({ roundNumber, matches });
  saveState();
  return true;
}

// ── Match actions ──────────────────────────────────────────────────────────────
function setMatchResult(roundIdx, matchId, result) {
  const rnd   = state.rounds[roundIdx];
  if (!rnd) return;
  const match = rnd.matches.find(m => m.id === matchId);
  if (!match) return;

  match.result = result;
  match.played = true;
  saveState();
  render();
}

function undoMatch(roundIdx, matchId) {
  const rnd   = state.rounds[roundIdx];
  if (!rnd) return;
  const match = rnd.matches.find(m => m.id === matchId);
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
  if (!confirm('Reset ALL tournament data? This cannot be undone.')) return;
  state = defaultState();
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

  title.textContent = `Round ${rnd.roundNumber}`;

  if (isComplete(rnd)) {
    content.innerHTML = `
      <div class="round-complete">
        <p>Round ${rnd.roundNumber} complete!</p>
        <button class="btn btn-primary" onclick="handleGenerate()">Generate Round ${rnd.roundNumber + 1}</button>
      </div>`;
    return;
  }

  const roundIdx = state.rounds.length - 1;
  const html = rnd.matches
    .filter(m => m.p1 !== 'bye' && m.p2 !== 'bye')
    .map(m => {
      const n1 = playerName(m.p1);
      const n2 = playerName(m.p2);

      if (m.played) {
        let label = '', cls = '';
        if      (m.result === 'p1')   { label = `${n1} won`;  cls = 'win-p1'; }
        else if (m.result === 'p2')   { label = `${n2} won`;  cls = 'win-p2'; }
        else                          { label = 'Draw';        cls = 'draw';   }

        return `
          <div class="match-card played">
            <div class="match-players">${n1} <span class="vs">vs</span> ${n2}</div>
            <div class="match-result ${cls}">${label}</div>
            <button class="undo-btn" onclick="undoMatch(${roundIdx},'${m.id}')">undo</button>
          </div>`;
      }

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

  content.innerHTML = html || '<p class="empty">No matches in this round.</p>';
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
// Only shows fully-completed rounds (current in-progress round stays in Upcoming).
function renderHistory() {
  const content = document.getElementById('history-content');

  const done = state.rounds.filter(r =>
    isComplete(r) && r.matches.some(m => m.p1 !== 'bye' && m.p2 !== 'bye')
  );

  if (done.length === 0) {
    content.innerHTML = '<p class="empty">No completed rounds yet.</p>';
    return;
  }

  // Most recent round first
  const html = [...done].reverse().map((rnd, idx) => {
    const rows = rnd.matches
      .filter(m => m.p1 !== 'bye' && m.p2 !== 'bye')
      .map(m => {
        const n1 = playerName(m.p1), n2 = playerName(m.p2);
        let result = 'Draw';
        if      (m.result === 'p1') result = `<strong>${n1}</strong> won`;
        else if (m.result === 'p2') result = `<strong>${n2}</strong> won`;
        return `
          <div class="history-match">
            <span>${n1} vs ${n2}</span>
            <span class="history-result">${result}</span>
          </div>`;
      }).join('');

    // Open the most-recent completed round by default
    const open = idx === 0 ? 'open' : '';
    return `
      <details class="round-details" ${open}>
        <summary>Round ${rnd.roundNumber}</summary>
        <div class="history-matches">${rows}</div>
      </details>`;
  }).join('');

  content.innerHTML = html;
}

// ── Render: Admin ──────────────────────────────────────────────────────────────
function renderAdmin() {
  // Player list
  const playerEl = document.getElementById('admin-players');
  playerEl.innerHTML = state.players.map(p => `
    <div class="player-item ${p.active ? '' : 'inactive'}">
      <span class="player-item-name">${p.name}</span>
      <button class="btn btn-ghost" style="font-size:.8rem;padding:.28rem .65rem"
              onclick="toggleActive('${p.id}')">
        ${p.active ? 'Remove' : 'Re-add'}
      </button>
    </div>`).join('') || '<p class="empty">No players.</p>';

  // Round controls
  const ctrlEl = document.getElementById('admin-round-controls');
  const rnd    = currentRound();
  let statusMsg = '', warningMsg = '';

  if (!rnd) {
    statusMsg = 'No rounds generated yet.';
  } else if (isComplete(rnd)) {
    statusMsg = `Round ${rnd.roundNumber} is complete. Ready to generate Round ${rnd.roundNumber + 1}.`;
  } else {
    const left = rnd.matches.filter(m => !m.played && m.p2 !== 'bye').length;
    statusMsg  = `Round ${rnd.roundNumber} is in progress (${left} match${left !== 1 ? 'es' : ''} remaining).`;
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

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Add player
  const input = document.getElementById('add-player-input');
  document.getElementById('add-player-btn').addEventListener('click', () => {
    if (addPlayer(input.value)) input.value = '';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && addPlayer(input.value)) input.value = '';
  });

  // Reset
  document.getElementById('reset-btn').addEventListener('click', resetTournament);

  render();
});
