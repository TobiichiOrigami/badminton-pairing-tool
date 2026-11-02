/**
 * 羽球對戰抽籤幫手 v2.0
 * 支援修為等級、IndexedDB 本機儲存、動態場次公平循環與戰力平衡演算法
 */

// --- 1. 修為體系定義 ---
const REALM_DATA = {
  "凡人": { level: 1, class: "realm-1" },
  "煉氣": { level: 2, class: "realm-2" },
  "築基": { level: 3, class: "realm-3" }, // 預設修為
  "結丹": { level: 4, class: "realm-4" },
  "元嬰": { level: 5, class: "realm-5" },
  "化神": { level: 6, class: "realm-6" },
  "煉虛": { level: 7, class: "realm-7" }
};
const DEFAULT_REALM = "築基";

const DEFAULT_PLAYERS = [
  { name: "博翰", realm: "元嬰", isSelected: true, isPriority: true },
  { name: "士賢", realm: "元嬰", isSelected: true, isPriority: true },
  { name: "瑞文", realm: "結丹", isSelected: true, isPriority: true },
  { name: "文凱", realm: "元嬰", isSelected: true, isPriority: true },
  { name: "楊偉", realm: "元嬰", isSelected: false, isPriority: false },
  { name: "同偉", realm: "化神", isSelected: false, isPriority: false },
  { name: "Tony", realm: "煉氣", isSelected: false, isPriority: false },
  { name: "學長", realm: "元嬰", isSelected: false, isPriority: false },
  { name: "學姊", realm: "築基", isSelected: false, isPriority: false },
  { name: "國鋒", realm: "結丹", isSelected: false, isPriority: false },
  { name: "阿呆", realm: "結丹", isSelected: false, isPriority: false },
  { name: "煥呈", realm: "元嬰", isSelected: false, isPriority: false }
];

// 全域狀態
let generatedTeams = [];
let currentMatchIndex = 0;
let cachedPlayers = [];
let cachedStats = {};

// --- 2. IndexedDB 本地儲存模組 (DBHelper) ---
const DBHelper = {
  dbName: "BadmintonPairingDB",
  dbVersion: 1,
  db: null,

  async init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn("瀏覽器不支援 IndexedDB，將降級為記憶體儲存");
        resolve(false);
        return;
      }
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("players")) {
          db.createObjectStore("players", { keyPath: "name" });
        }
        if (!db.objectStoreNames.contains("stats")) {
          db.createObjectStore("stats", { keyPath: "name" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(true);
      };

      request.onerror = (e) => {
        console.error("IndexedDB 開啟失敗:", e);
        resolve(false);
      };
    });
  },

  async getAllPlayers() {
    if (!this.db) {
      const local = localStorage.getItem("badminton_players");
      return local ? JSON.parse(local) : [...DEFAULT_PLAYERS];
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("players", "readonly");
      const store = tx.objectStore("players");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  async savePlayer(player) {
    if (!this.db) {
      const players = await this.getAllPlayers();
      const idx = players.findIndex(p => p.name === player.name);
      if (idx >= 0) players[idx] = player; else players.push(player);
      localStorage.setItem("badminton_players", JSON.stringify(players));
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("players", "readwrite");
      const store = tx.objectStore("players");
      store.put(player);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async saveAllPlayers(players) {
    if (!this.db) {
      localStorage.setItem("badminton_players", JSON.stringify(players));
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("players", "readwrite");
      const store = tx.objectStore("players");
      players.forEach(p => store.put(p));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async deletePlayer(name) {
    if (!this.db) {
      let players = await this.getAllPlayers();
      players = players.filter(p => p.name !== name);
      localStorage.setItem("badminton_players", JSON.stringify(players));
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("players", "readwrite");
      const store = tx.objectStore("players");
      store.delete(name);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async clearAllPlayers() {
    if (!this.db) {
      localStorage.removeItem("badminton_players");
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("players", "readwrite");
      const store = tx.objectStore("players");
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async getAllStats() {
    if (!this.db) {
      const local = localStorage.getItem("badminton_stats");
      return local ? JSON.parse(local) : {};
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("stats", "readonly");
      const store = tx.objectStore("stats");
      const req = store.getAll();
      req.onsuccess = () => {
        const statsMap = {};
        (req.result || []).forEach(item => {
          statsMap[item.name] = item;
        });
        resolve(statsMap);
      };
      req.onerror = () => resolve({});
    });
  },

  async saveStats(statsMap) {
    if (!this.db) {
      localStorage.setItem("badminton_stats", JSON.stringify(statsMap));
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("stats", "readwrite");
      const store = tx.objectStore("stats");
      Object.values(statsMap).forEach(item => store.put(item));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  },

  async resetAllStats() {
    if (!this.db) {
      localStorage.removeItem("badminton_stats");
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("stats", "readwrite");
      const store = tx.objectStore("stats");
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }
};

// --- 3. DOM 初始化與事件綁定 ---
document.addEventListener('DOMContentLoaded', async function () {
  await DBHelper.init();

  let players = await DBHelper.getAllPlayers();
  if (!players || players.length === 0) {
    players = [...DEFAULT_PLAYERS];
    await DBHelper.saveAllPlayers(players);
  }
  cachedPlayers = players;
  cachedStats = await DBHelper.getAllStats();

  renderPlayerList();

  // 全選/取消全選
  document.getElementById('selectAll').addEventListener('change', function () {
    const isChecked = this.checked;
    cachedPlayers.forEach(p => { p.isSelected = isChecked; });
    DBHelper.saveAllPlayers(cachedPlayers);
    const checkboxes = document.querySelectorAll('#player-list input.player');
    checkboxes.forEach(cb => { cb.checked = isChecked; });
  });

  document.getElementById('balanceByRealm').addEventListener('change', updateAdvancedOptionsBadge);
  document.getElementById('autoPriority').addEventListener('change', updateAdvancedOptionsBadge);
  document.getElementById('noBindCheck').addEventListener('change', updateAdvancedOptionsBadge);
  updateAdvancedOptionsBadge();

  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
  [...popoverTriggerList].forEach(el => new bootstrap.Popover(el));
});

// 渲染球員清單
function renderPlayerList() {
  const playerList = document.getElementById('player-list');
  playerList.innerHTML = '';

  cachedPlayers.forEach(player => {
    const div = document.createElement('div');
    div.className = 'col card player-card';
    div.id = `card-${player.name}`;

    const realmInfo = REALM_DATA[player.realm] || REALM_DATA[DEFAULT_REALM];

    let optionsHtml = '';
    for (const realmName in REALM_DATA) {
      const isSelected = realmName === player.realm ? 'selected' : '';
      optionsHtml += `<option value="${realmName}" ${isSelected}>${realmName} (Rank ${REALM_DATA[realmName].level})</option>`;
    }

    div.innerHTML = `
      <span class="delete-btn" title="刪除球員" onclick="deletePlayerAction('${escapeHtml(player.name)}')">&times;</span>
      <div class="player-header">
        <label class="form-check-label text-truncate" style="max-width: 68%;">
          <input type="checkbox" class="form-check-input player" value="${escapeHtml(player.name)}" ${player.isSelected ? 'checked' : ''} onchange="onPlayerCheckChange('${escapeHtml(player.name)}', this.checked)">
          <strong title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong>
        </label>
        <label class="form-check-label text-danger small">
          <input type="checkbox" class="form-check-input check-red priority" value="${escapeHtml(player.name)}" ${player.isPriority ? 'checked' : ''} onchange="onPriorityCheckChange('${escapeHtml(player.name)}', this.checked)"> 優先
        </label>
      </div>
      <div class="d-flex align-items-center gap-1 mt-1">
        <span class="realm-badge ${realmInfo.class}" id="badge-${escapeHtml(player.name)}">${player.realm}</span>
        <select class="form-select form-select-sm realm-select flex-grow-1" onchange="onPlayerRealmChange('${escapeHtml(player.name)}', this.value)">
          ${optionsHtml}
        </select>
      </div>
    `;

    playerList.appendChild(div);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function onPlayerCheckChange(name, isChecked) {
  const p = cachedPlayers.find(item => item.name === name);
  if (p) {
    p.isSelected = isChecked;
    DBHelper.savePlayer(p);
  }
}

function onPriorityCheckChange(name, isChecked) {
  const p = cachedPlayers.find(item => item.name === name);
  if (p) {
    p.isPriority = isChecked;
    DBHelper.savePlayer(p);
  }
}

function onPlayerRealmChange(name, newRealm) {
  const p = cachedPlayers.find(item => item.name === name);
  if (p && REALM_DATA[newRealm]) {
    p.realm = newRealm;
    DBHelper.savePlayer(p);

    const badge = document.getElementById(`badge-${name}`);
    if (badge) {
      badge.className = `realm-badge ${REALM_DATA[newRealm].class}`;
      badge.textContent = newRealm;
    }
  }
}

async function addPlayer() {
  const inputEl = document.getElementById('newPlayer');
  const input = inputEl.value.trim();
  if (!input) return;

  const realmSelectEl = document.getElementById('newPlayerRealm');
  const initialRealm = realmSelectEl.value || DEFAULT_REALM;

  const names = input.split(',').map(n => n.trim()).filter(n => n);
  if (names.length === 0) return;

  for (const name of names) {
    if (cachedPlayers.some(p => p.name === name)) {
      continue;
    }
    const newPlayer = {
      name: name,
      realm: initialRealm,
      isSelected: true,
      isPriority: false
    };
    cachedPlayers.push(newPlayer);
    await DBHelper.savePlayer(newPlayer);
  }

  inputEl.value = '';
  renderPlayerList();
}

async function deletePlayerAction(name) {
  if (!confirm(`確定要刪除球員【${name}】嗎？`)) return;
  cachedPlayers = cachedPlayers.filter(p => p.name !== name);
  await DBHelper.deletePlayer(name);
  renderPlayerList();
}

async function removeAllPlayersAction() {
  if (!confirm("確定要移除所有球員嗎？")) return;
  cachedPlayers = [];
  await DBHelper.clearAllPlayers();
  renderPlayerList();
}

async function restoreDefaultPlayersAction() {
  if (!confirm("確定要恢復預設球員與修為名單嗎？這會覆蓋現有球員資料。")) return;
  cachedPlayers = JSON.parse(JSON.stringify(DEFAULT_PLAYERS));
  await DBHelper.clearAllPlayers();
  await DBHelper.saveAllPlayers(cachedPlayers);
  renderPlayerList();
}

async function resetStatsAction() {
  if (!confirm("確定要重置所有球員的歷史對戰統計嗎？")) return;
  cachedStats = {};
  await DBHelper.resetAllStats();
  alert("對戰統計已歸零！");
}

function removePriority() {
  cachedPlayers.forEach(p => { p.isPriority = false; });
  DBHelper.saveAllPlayers(cachedPlayers);
  const priorityCheckboxes = document.querySelectorAll('#player-list input.priority:checked');
  priorityCheckboxes.forEach(cb => { cb.checked = false; });
}

function updateAdvancedOptionsBadge() {
  let count = 0;
  if (document.getElementById('balanceByRealm').checked) count++;
  if (document.getElementById('autoPriority').checked) count++;
  if (document.getElementById('noBindCheck').checked) count++;

  const badge = document.getElementById('advancedOptionsBadge');
  if (badge) badge.textContent = count;
}

// --- 4. 戰力平衡與抽籤分組演算法 ---

/**
 * 取得球員的修為等級 (1~7)
 */
function getPlayerLevel(playerName) {
  const p = cachedPlayers.find(item => item.name === playerName);
  if (p && REALM_DATA[p.realm]) {
    return REALM_DATA[p.realm].level;
  }
  return REALM_DATA[DEFAULT_REALM].level;
}

/**
 * 計算推薦抽籤場次 (依人數與修為平衡最佳化)
 */
function getRecommendedMatchCount(selectedPlayerNames) {
  const count = selectedPlayerNames.length;
  if (count < 4) return 0;
  if (count === 4) return 3;
  if (count === 5) return 5;
  if (count === 6) return 6;
  if (count === 7) return 7;
  if (count === 8) return 4;
  if (count === 9) return 6;
  if (count === 10) return 5;
  return Math.ceil(count / 2);
}

/**
 * 【重點一】給定單場 4 位球員，求最平衡的 2 vs 2 分組組合
 * 避免雙高 vs 雙低，最小化兩隊戰力差距
 */
function balanceSingleMatch(fourPlayers, allowPriorityPairing = false, priorityList = []) {
  if (fourPlayers.length !== 4) return fourPlayers;

  const [p0, p1, p2, p3] = fourPlayers;
  const v0 = getPlayerLevel(p0);
  const v1 = getPlayerLevel(p1);
  const v2 = getPlayerLevel(p2);
  const v3 = getPlayerLevel(p3);

  // 3 種可能的配對組合
  const pairings = [
    {
      teamA: [p0, p1], teamB: [p2, p3],
      scoreA: v0 + v1, scoreB: v2 + v3,
      diff: Math.abs((v0 + v1) - (v2 + v3)),
      id: 1
    },
    {
      teamA: [p0, p2], teamB: [p1, p3],
      scoreA: v0 + v2, scoreB: v1 + v3,
      diff: Math.abs((v0 + v2) - (v1 + v3)),
      id: 2
    },
    {
      teamA: [p0, p3], teamB: [p1, p2],
      scoreA: v0 + v3, scoreB: v1 + v2,
      diff: Math.abs((v0 + v3) - (v1 + v2)),
      id: 3
    }
  ];

  // 計算每個組合的額外懲罰分數
  pairings.forEach(pair => {
    let penalty = pair.diff * 100;

    const statA0 = cachedStats[pair.teamA[0]];
    const countA = (statA0 && statA0.partnerCounts && statA0.partnerCounts[pair.teamA[1]]) || 0;
    const statB0 = cachedStats[pair.teamB[0]];
    const countB = (statB0 && statB0.partnerCounts && statB0.partnerCounts[pair.teamB[1]]) || 0;
    penalty += (countA + countB) * 5;

    if (!allowPriorityPairing && priorityList.length >= 2) {
      const prioInMatch = fourPlayers.filter(p => priorityList.includes(p));
      if (prioInMatch.length === 2) {
        const isTogether = (pair.teamA.includes(prioInMatch[0]) && pair.teamA.includes(prioInMatch[1])) ||
                           (pair.teamB.includes(prioInMatch[0]) && pair.teamB.includes(prioInMatch[1]));
        if (isTogether) {
          penalty -= 15;
        }
      }
    }

    penalty += Math.random() * 0.5;
    pair.totalPenalty = penalty;
  });

  pairings.sort((a, b) => a.totalPenalty - b.totalPenalty);
  return [...pairings[0].teamA, ...pairings[0].teamB];
}

/**
 * 隨機分組主函數
 */
function generateTeams() {
  const selectedCheckboxes = document.querySelectorAll('#player-list input.player:checked');
  let allSelected = Array.from(selectedCheckboxes).map(cb => cb.value);

  if (allSelected.length < 4) {
    alert("請至少選擇 4 位球員");
    return;
  }

  const priorityCheckboxes = document.querySelectorAll('#player-list input.priority:checked');
  let priorityPlayers = Array.from(priorityCheckboxes).map(cb => cb.value);
  priorityPlayers = priorityPlayers.filter(p => allSelected.includes(p));

  const noBind = document.getElementById('noBindCheck').checked;
  const enableRealmBalance = document.getElementById('balanceByRealm').checked;

  const matchSelectEl = document.getElementById('matchCountSelect');
  let totalMatchTarget = getRecommendedMatchCount(allSelected);
  if (matchSelectEl && matchSelectEl.value !== 'auto') {
    totalMatchTarget = parseInt(matchSelectEl.value, 10);
  }

  let teams = [];

  if (!enableRealmBalance) {
    let pool = [...allSelected];
    shuffleArray(pool);
    priorityPlayers.forEach(p => {
      pool = pool.filter(x => x !== p);
      pool.unshift(p);
    });

    for (let m = 0; m < totalMatchTarget; m++) {
      if (pool.length < 4) {
        let supplement = allSelected.filter(p => !pool.includes(p));
        shuffleArray(supplement);
        pool.push(...supplement.slice(0, 4 - pool.length));
      }
      let chunk = pool.splice(0, 4);
      shuffleArray(chunk);
      teams.push(chunk);
    }
  } else {
    teams = optimizeSchedule(allSelected, totalMatchTarget, priorityPlayers, noBind);
  }

  generatedTeams = teams;
  currentMatchIndex = 0;

  recordMatchStatistics(teams);
  displayResults();

  // 自動優先功能
  const autoPriority = document.getElementById('autoPriority').checked;
  if (autoPriority && teams.length > 0) {
    const lastMatch = teams[teams.length - 1];
    const restingInLastMatch = allSelected.filter(p => !lastMatch.includes(p));
    removePriority();
    restingInLastMatch.forEach(name => {
      const p = cachedPlayers.find(item => item.name === name);
      if (p) p.isPriority = true;
      const cb = document.querySelector(`#player-list input.priority[value="${name}"]`);
      if (cb) cb.checked = true;
    });
    DBHelper.saveAllPlayers(cachedPlayers);
  }
}

/**
 * 核心排程最佳化引擎 (蒙地卡羅多目標搜尋)
 */
function optimizeSchedule(selectedNames, matchCount, priorityNames, noBind) {
  const N = selectedNames.length;
  const levels = selectedNames.map(p => getPlayerLevel(p));
  const minLevel = Math.min(...levels);
  const maxLevel = Math.max(...levels);
  const isTiered = (maxLevel - minLevel) >= 2;

  const sortedLevels = [...levels].sort((a, b) => a - b);
  const medianLevel = sortedLevels[Math.floor(sortedLevels.length / 2)];
  const highTierThreshold = Math.max(4, medianLevel);

  const highNames = selectedNames.filter(p => getPlayerLevel(p) >= highTierThreshold);
  const lowNames = selectedNames.filter(p => getPlayerLevel(p) < highTierThreshold);

  let bestSchedule = null;
  let bestPenalty = Infinity;

  for (let trial = 0; trial < 250; trial++) {
    let playCounts = {};
    selectedNames.forEach(n => { playCounts[n] = 0; });
    let lastResting = [];
    let matches = [];
    let totalDiff = 0;
    let consecutiveRestPenalty = 0;

    for (let m = 0; m < matchCount; m++) {
      let pool = [...selectedNames];

      pool.sort((a, b) => {
        if (m === 0) {
          const aPrio = priorityNames.includes(a) ? 1 : 0;
          const bPrio = priorityNames.includes(b) ? 1 : 0;
          if (aPrio !== bPrio) return bPrio - aPrio;
        }
        if (playCounts[a] !== playCounts[b]) {
          return playCounts[a] - playCounts[b];
        }
        const aRested = lastResting.includes(a) ? 1 : 0;
        const bRested = lastResting.includes(b) ? 1 : 0;
        if (aRested !== bRested) return bRested - aRested;
        return Math.random() - 0.5;
      });

      const four = pool.slice(0, 4);
      const resting = pool.slice(4);

      if (m > 0 && N <= 7) {
        resting.forEach(r => {
          if (lastResting.includes(r)) consecutiveRestPenalty += 300;
        });
      }

      four.forEach(p => { playCounts[p]++; });
      lastResting = resting;

      const balanced = balanceSingleMatch(four, noBind || m > 0, priorityNames);
      const sA = getPlayerLevel(balanced[0]) + getPlayerLevel(balanced[1]);
      const sB = getPlayerLevel(balanced[2]) + getPlayerLevel(balanced[3]);
      totalDiff += Math.abs(sA - sB);
      matches.push(balanced);
    }

    const pValues = Object.values(playCounts);
    const minP = Math.min(...pValues);
    const maxP = Math.max(...pValues);
    const playVariance = (maxP - minP) * 500;

    let highMatchesCount = {};
    let mixedMatchesCount = {};
    highNames.forEach(h => { highMatchesCount[h] = 0; mixedMatchesCount[h] = 0; });
    let totalHighTierMatches = 0;

    matches.forEach(m => {
      const hasLow = m.some(p => lowNames.includes(p));
      if (!hasLow) totalHighTierMatches++;
      highNames.forEach(h => {
        if (m.includes(h)) {
          if (hasLow) mixedMatchesCount[h]++;
          else highMatchesCount[h]++;
        }
      });
    });

    let tierPenalty = 0;
    if (isTiered && highNames.length >= 2 && totalHighTierMatches > 0) {
      highNames.forEach(h => {
        if (highMatchesCount[h] === 0) tierPenalty += 2500;
      });
      const hVals = Object.values(highMatchesCount);
      const mVals = Object.values(mixedMatchesCount);
      tierPenalty += (Math.max(...hVals) - Math.min(...hVals)) * 120;
      tierPenalty += (Math.max(...mVals) - Math.min(...mVals)) * 90;
    }

    highNames.forEach(h => {
      const hist = cachedStats[h];
      if (hist && hist.lowMatchCount > 2) {
        tierPenalty += mixedMatchesCount[h] * 20;
      }
    });

    const totalPenalty = (totalDiff * 15) + playVariance + consecutiveRestPenalty + tierPenalty;

    if (totalPenalty < bestPenalty) {
      bestPenalty = totalPenalty;
      bestSchedule = matches;
    }
  }

  return bestSchedule;
}

/**
 * 累計並持久化本輪所有場次的統計資訊至 IndexedDB
 */
function recordMatchStatistics(allMatches) {
  allMatches.forEach(m => {
    const teamA = m.slice(0, 2);
    const teamB = m.slice(2, 4);

    [teamA, teamB].forEach((team, teamIdx) => {
      const oppTeam = teamIdx === 0 ? teamB : teamA;
      const maxOppLevel = Math.max(...oppTeam.map(p => getPlayerLevel(p)));

      team.forEach(pName => {
        if (!cachedStats[pName]) {
          cachedStats[pName] = {
            name: pName,
            playedCount: 0,
            lowMatchCount: 0,
            highMatchCount: 0,
            partnerCounts: {},
            opponentCounts: {}
          };
        }
        const s = cachedStats[pName];
        s.playedCount = (s.playedCount || 0) + 1;

        const pLevel = getPlayerLevel(pName);
        if (pLevel >= 4 && (pLevel - maxOppLevel) >= 2) {
          s.lowMatchCount = (s.lowMatchCount || 0) + 1;
        } else if (pLevel >= 4 && maxOppLevel >= 4) {
          s.highMatchCount = (s.highMatchCount || 0) + 1;
        }

        const partner = team.find(p => p !== pName);
        if (partner) {
          s.partnerCounts[partner] = (s.partnerCounts[partner] || 0) + 1;
        }

        oppTeam.forEach(opp => {
          s.opponentCounts[opp] = (s.opponentCounts[opp] || 0) + 1;
        });
      });
    });
  });

  DBHelper.saveStats(cachedStats);
}

// 產生球員帶有修為 Badge 的 HTML 字串
function formatPlayerDisplay(name) {
  const p = cachedPlayers.find(item => item.name === name);
  const realm = p ? p.realm : DEFAULT_REALM;
  const realmInfo = REALM_DATA[realm] || REALM_DATA[DEFAULT_REALM];
  return `<span>${escapeHtml(name)} <span class="realm-badge ${realmInfo.class}">${realm}</span></span>`;
}

// 顯示分組結果
function displayResults() {
  if (!generatedTeams || generatedTeams.length === 0) return;

  // 1. 渲染當前對戰
  const currentMatch = generatedTeams[currentMatchIndex];
  document.getElementById('current-match-title').textContent = `當前對戰 (第 ${currentMatchIndex + 1} / ${generatedTeams.length} 場)`;

  const p0 = currentMatch[0], p1 = currentMatch[1], p2 = currentMatch[2], p3 = currentMatch[3];
  const v0 = getPlayerLevel(p0), v1 = getPlayerLevel(p1), v2 = getPlayerLevel(p2), v3 = getPlayerLevel(p3);
  const scoreA = v0 + v1;
  const scoreB = v2 + v3;
  const diff = Math.abs(scoreA - scoreB);

  document.getElementById('team-a-display').innerHTML = `${formatPlayerDisplay(p0)} & ${formatPlayerDisplay(p1)}`;
  document.getElementById('team-b-display').innerHTML = `${formatPlayerDisplay(p2)} & ${formatPlayerDisplay(p3)}`;

  // 戰力指示標籤
  const powerIndicator = document.getElementById('match-power-indicator');
  const powerDetails = document.getElementById('current-match-power-details');
  if (powerIndicator) {
    powerIndicator.classList.remove('d-none');
    if (diff === 0) {
      powerIndicator.className = 'power-indicator balanced';
      powerIndicator.innerHTML = `⚖️ 戰力完美平衡 (差值 0)`;
    } else if (diff <= 1) {
      powerIndicator.className = 'power-indicator slight-diff';
      powerIndicator.innerHTML = `⚖️ 戰力極度相近 (差值 ${diff})`;
    } else {
      powerIndicator.className = 'power-indicator';
      powerIndicator.innerHTML = `戰力差值: ${diff}`;
    }
  }
  if (powerDetails) {
    powerDetails.innerHTML = `<small class="text-muted">隊伍 A 總修為: <strong>${scoreA}</strong> | 隊伍 B 總修為: <strong>${scoreB}</strong></small>`;
  }

  // 啟用 / 停用下一場對戰按鈕
  const nextMatchBtn = document.getElementById('next-match-btn');
  if (currentMatchIndex < generatedTeams.length - 1) {
    nextMatchBtn.classList.remove('d-none');
  } else {
    nextMatchBtn.classList.add('d-none');
  }

  // 啟用 / 停用本場延後按鈕
  const swapGroupBtn = document.getElementById('swap-group-btn');
  if (swapGroupBtn) {
    if (generatedTeams.length >= 2 && currentMatchIndex < generatedTeams.length - 1) {
      swapGroupBtn.classList.remove('d-none');
    } else {
      swapGroupBtn.classList.add('d-none');
    }
  }

  // 2. 渲染待對戰場次
  const listContainer = document.getElementById('upcoming-matches-list');
  listContainer.innerHTML = '';

  let upcomingCount = 0;
  for (let i = currentMatchIndex + 1; i < generatedTeams.length; i++) {
    upcomingCount++;
    const match = generatedTeams[i];
    const sA = getPlayerLevel(match[0]) + getPlayerLevel(match[1]);
    const sB = getPlayerLevel(match[2]) + getPlayerLevel(match[3]);
    const mDiff = Math.abs(sA - sB);

    const item = document.createElement('div');
    item.className = 'list-group-item d-flex justify-content-between align-items-center py-2 flex-wrap gap-2';

    const matchText = document.createElement('div');
    matchText.innerHTML = `<strong>第 ${i + 1} 場:</strong> ${formatPlayerDisplay(match[0])} & ${formatPlayerDisplay(match[1])} <span class="text-muted fw-bold mx-1">VS</span> ${formatPlayerDisplay(match[2])} & ${formatPlayerDisplay(match[3])}`;

    const diffBadge = document.createElement('span');
    diffBadge.className = `badge ${mDiff === 0 ? 'bg-success' : (mDiff <= 1 ? 'bg-info text-dark' : 'bg-secondary')}`;
    diffBadge.textContent = `戰力 ${sA} vs ${sB}`;

    item.appendChild(matchText);
    item.appendChild(diffBadge);
    listContainer.appendChild(item);
  }

  if (upcomingCount === 0) {
    const item = document.createElement('div');
    item.className = 'list-group-item text-muted text-center py-3';
    item.textContent = '已無後續對戰場次';
    listContainer.appendChild(item);
  }
}

// 本場延後
function handleSwapGroups() {
  if (!generatedTeams || generatedTeams.length < 2) {
    alert("未能找到足以進行延後的對戰場次（需要至少 2 場）。");
    return;
  }
  if (currentMatchIndex >= generatedTeams.length - 1) {
    alert("無法執行延後，因為已是最後一場對戰。");
    return;
  }
  const groupToMove = generatedTeams[currentMatchIndex];
  for (let i = currentMatchIndex; i < generatedTeams.length - 1; i++) {
    generatedTeams[i] = generatedTeams[i + 1];
  }
  generatedTeams[generatedTeams.length - 1] = groupToMove;
  displayResults();
}

// 切換到下一場對戰
function nextMatch() {
  if (currentMatchIndex < generatedTeams.length - 1) {
    currentMatchIndex++;
    displayResults();
  }
}

// 隨機打亂陣列
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
