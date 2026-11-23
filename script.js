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
const MAX_MATCH_HISTORY = 10;
let generatedTeams = [];
let currentMatchIndex = 0;
let lastMatchRecorded = false;
let cachedPlayers = [];
let cachedStats = {};
let sessionStats = {};
let lastDrawGroupKeys = new Set();
let lastRosterSignature = "";

// --- 2. IndexedDB 本地儲存模組 (DBHelper) ---
const DBHelper = {
  dbName: "BadmintonPairingDB",
  dbVersion: 2,
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
        if (!db.objectStoreNames.contains("matchHistory")) {
          db.createObjectStore("matchHistory", { keyPath: "id", autoIncrement: true });
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
      return local ? JSON.parse(local) : DEFAULT_PLAYERS.map(p => ({ ...p }));
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
  },

  async getMatchHistory() {
    if (!this.db) {
      const local = localStorage.getItem("badminton_match_history");
      const list = local ? JSON.parse(local) : [];
      return list.sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, MAX_MATCH_HISTORY);
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("matchHistory", "readonly");
      const store = tx.objectStore("matchHistory");
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => (b.id || 0) - (a.id || 0));
        resolve(list.slice(0, MAX_MATCH_HISTORY));
      };
      req.onerror = () => resolve([]);
    });
  },

  async addMatchHistory(record) {
    if (!this.db) {
      const list = await this.getMatchHistory();
      const maxId = list.reduce((max, item) => Math.max(max, item.id || 0), 0);
      const entry = { ...record, id: maxId + 1 };
      const updated = [entry, ...list].slice(0, MAX_MATCH_HISTORY);
      localStorage.setItem("badminton_match_history", JSON.stringify(updated));
      return entry;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("matchHistory", "readwrite");
      const store = tx.objectStore("matchHistory");
      const addReq = store.add(record);
      let insertedId = null;

      addReq.onsuccess = (e) => {
        insertedId = e.target.result;
        const keysReq = store.getAllKeys();
        keysReq.onsuccess = () => {
          const keys = (keysReq.result || []).sort((a, b) => a - b);
          if (keys.length > MAX_MATCH_HISTORY) {
            const toDelete = keys.slice(0, keys.length - MAX_MATCH_HISTORY);
            toDelete.forEach(k => store.delete(k));
          }
        };
      };

      tx.oncomplete = () => resolve({ ...record, id: insertedId });
      tx.onerror = () => resolve(null);
    });
  },

  async clearMatchHistory() {
    if (!this.db) {
      localStorage.removeItem("badminton_match_history");
      return true;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction("matchHistory", "readwrite");
      const store = tx.objectStore("matchHistory");
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }
};

// --- 3. DOM 初始化與事件綁定 ---
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async function () {
    await DBHelper.init();

    let players = await DBHelper.getAllPlayers();
    if (!players || players.length === 0) {
      players = DEFAULT_PLAYERS.map(p => ({ ...p }));
      await DBHelper.saveAllPlayers(players);
    }
    cachedPlayers = players;
    cachedStats = await DBHelper.getAllStats();

    renderPlayerList();
    await updateHistoryCountBadge();

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
}

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

function resetSessionFairnessState() {
  sessionStats = {};
  lastDrawGroupKeys = new Set();
  lastRosterSignature = "";
}

function getRosterSignature(selectedNames) {
  return [...selectedNames]
    .sort()
    .map(name => `${name}:${getPlayerLevel(name)}`)
    .join("|");
}

function syncPlayerRealmsFromDOM() {
  if (typeof document === 'undefined') return;
  let changed = false;
  cachedPlayers.forEach(p => {
    const card = document.getElementById(`card-${p.name}`);
    if (!card) return;
    const select = card.querySelector('select.realm-select');
    if (select && REALM_DATA[select.value] && p.realm !== select.value) {
      p.realm = select.value;
      changed = true;
    }
  });
  if (changed) {
    DBHelper.saveAllPlayers(cachedPlayers);
    resetSessionFairnessState();
  }
}

function onPlayerRealmChange(name, newRealm) {
  const p = cachedPlayers.find(item => item.name === name);
  if (p && REALM_DATA[newRealm]) {
    p.realm = newRealm;
    DBHelper.savePlayer(p);

    // 修為異動時立即重置本場次暫存統計，避免舊修為時期的統計殘留影響後續抽籤
    resetSessionFairnessState();

    const badge = document.getElementById(`badge-${name}`);
    if (badge) {
      badge.className = `realm-badge ${REALM_DATA[newRealm].class}`;
      badge.textContent = newRealm;
    }

    if (generatedTeams && generatedTeams.length > 0) {
      displayResults();
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
  resetSessionFairnessState();
  renderPlayerList();
}

async function removeAllPlayersAction() {
  if (!confirm("確定要移除所有球員嗎？")) return;
  cachedPlayers = [];
  await DBHelper.clearAllPlayers();
  resetSessionFairnessState();
  renderPlayerList();
}

async function restoreDefaultPlayersAction() {
  if (!confirm("確定要恢復預設球員與修為名單嗎？這會覆蓋現有球員資料。")) return;
  cachedPlayers = DEFAULT_PLAYERS.map(p => ({ ...p }));
  await DBHelper.clearAllPlayers();
  await DBHelper.saveAllPlayers(cachedPlayers);
  resetSessionFairnessState();
  renderPlayerList();
}

async function resetStatsAction() {
  if (!confirm("確定要重置所有球員的歷史對戰統計嗎？")) return;
  cachedStats = {};
  resetSessionFairnessState();
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
 * 分析目前出戰球員的修為分層結構
 * - homogeneous: 全員修為相近 (最大差 <= 1)，無低端分層問題
 * - tiered: 存在明顯較低修為的少數球員 (與高階組落差 >= 2，且高階組至少 4 人、內部分散 <= 2，低階組內部分散 <= 2)
 *           → 啟用「低端場輪流參與、平均享受高端局」機制
 * - complex: 修為分布過於複雜多層，難以單純區分高低端 → 依原則採公平隨機抽選 + 單場 2v2 戰力平衡
 */
function analyzeRealmTiers(selectedNames) {
  const N = selectedNames.length;
  const playersWithLevel = selectedNames.map(name => ({
    name,
    level: getPlayerLevel(name)
  }));
  playersWithLevel.sort((a, b) => a.level - b.level);

  const minLevel = playersWithLevel[0].level;
  const maxLevel = playersWithLevel[N - 1].level;

  if (maxLevel - minLevel <= 1) {
    return {
      mode: "homogeneous",
      isClearTiered: false,
      threshold: minLevel,
      highNames: [...selectedNames],
      lowNames: []
    };
  }

  // 從高往低尋找最清晰的斷層 splitIndex (1 <= i <= N - 4)
  // 需滿足：
  // 1. 斷層落差 >= 2
  // 2. 高階人數 >= 4 (才組得出純高端局) 且低階人數 < 高階人數 (少數低階搭配多數高階)
  // 3. 高階組內部最大落差 <= 2，低階組內部最大落差 <= 2 (避免 3~4 層複雜混合)
  let bestSplit = -1;
  for (let i = N - 4; i >= 1; i--) {
    const gap = playersWithLevel[i].level - playersWithLevel[i - 1].level;
    const highCount = N - i;
    const lowCount = i;
    const highSpread = playersWithLevel[N - 1].level - playersWithLevel[i].level;
    const lowSpread = playersWithLevel[i - 1].level - playersWithLevel[0].level;

    if (gap >= 2 && highCount >= 4 && lowCount < highCount && highSpread <= 2 && lowSpread <= 2) {
      bestSplit = i;
      break;
    }
  }

  if (bestSplit !== -1) {
    const threshold = playersWithLevel[bestSplit].level;
    const lowNames = playersWithLevel.slice(0, bestSplit).map(p => p.name);
    const highNames = playersWithLevel.slice(bestSplit).map(p => p.name);
    return {
      mode: "tiered",
      isClearTiered: true,
      threshold,
      highNames,
      lowNames
    };
  }

  return {
    mode: "complex",
    isClearTiered: false,
    threshold: minLevel,
    highNames: [...selectedNames],
    lowNames: []
  };
}

function getPairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function getGroupKey(fourPlayers) {
  return [...fourPlayers].sort().join("\u0000");
}

function getSessionPartnerCount(a, b, statsSource) {
  const s = statsSource && statsSource[a];
  return (s && s.partnerCounts && s.partnerCounts[b]) || 0;
}

function getSessionMixedCount(name, statsSource) {
  const s = statsSource && statsSource[name];
  return (s && s.mixedMatchCount) || 0;
}

function getSessionHighCount(name, statsSource) {
  const s = statsSource && statsSource[name];
  return (s && s.highMatchCount) || 0;
}

/**
 * 給定單場 4 位球員，求最平衡的 2 vs 2 分組組合
 * - 啟用修為平衡時：優先最小化兩隊戰力差（避免雙高 vs 雙低），同差值下輪替搭檔
 * - 未啟用修為平衡時：隨機配對並避免連續同搭檔
 */
function balanceSingleMatch(
  fourPlayers,
  allowPriorityPairing = false,
  priorityList = [],
  schedulePartnerCounts = {},
  enableRealmBalance = true,
  statsSource = sessionStats
) {
  if (fourPlayers.length !== 4) return [...fourPlayers];

  const [p0, p1, p2, p3] = fourPlayers;
  const v0 = getPlayerLevel(p0);
  const v1 = getPlayerLevel(p1);
  const v2 = getPlayerLevel(p2);
  const v3 = getPlayerLevel(p3);

  const pairings = [
    {
      teamA: [p0, p1], teamB: [p2, p3],
      diff: Math.abs((v0 + v1) - (v2 + v3))
    },
    {
      teamA: [p0, p2], teamB: [p1, p3],
      diff: Math.abs((v0 + v2) - (v1 + v3))
    },
    {
      teamA: [p0, p3], teamB: [p1, p2],
      diff: Math.abs((v0 + v3) - (v1 + v2))
    }
  ];

  pairings.forEach(pair => {
    let penalty = enableRealmBalance ? pair.diff * 1000 : 0;

    // 避免同一次抽籤內重複同搭檔
    const inSchedA = schedulePartnerCounts[getPairKey(pair.teamA[0], pair.teamA[1])] || 0;
    const inSchedB = schedulePartnerCounts[getPairKey(pair.teamB[0], pair.teamB[1])] || 0;
    penalty += (inSchedA + inSchedB) * 50;

    // 避免同場次連續抽籤反覆同搭檔
    const sessA = getSessionPartnerCount(pair.teamA[0], pair.teamA[1], statsSource);
    const sessB = getSessionPartnerCount(pair.teamB[0], pair.teamB[1], statsSource);
    penalty += (sessA + sessB) * 15;

    // 若取消勾選「優先不必同組」，首場 2 位優先球員盡量分在同一隊
    if (!allowPriorityPairing && priorityList.length >= 2) {
      const prioInMatch = fourPlayers.filter(p => priorityList.includes(p));
      if (prioInMatch.length === 2) {
        const isTogether =
          (pair.teamA.includes(prioInMatch[0]) && pair.teamA.includes(prioInMatch[1])) ||
          (pair.teamB.includes(prioInMatch[0]) && pair.teamB.includes(prioInMatch[1]));
        if (isTogether) {
          penalty -= 200;
        }
      }
    }

    penalty += Math.random() * 0.5;
    pair.totalPenalty = penalty;
  });

  pairings.sort((a, b) => a.totalPenalty - b.totalPenalty);
  const chosen = pairings[0];
  // 隨機決定隊伍 A/B 顯示左右與隊內先後，避免視覺固定順序
  const teamA = Math.random() < 0.5 ? [...chosen.teamA] : [chosen.teamA[1], chosen.teamA[0]];
  const teamB = Math.random() < 0.5 ? [...chosen.teamB] : [chosen.teamB[1], chosen.teamB[0]];
  return Math.random() < 0.5 ? [...teamA, ...teamB] : [...teamB, ...teamA];
}

/**
 * 依加權或隨機方式從候選池挑出 k 名球員
 */
function pickFromBucket(bucket, k, scorer = null) {
  if (k <= 0) return [];
  if (bucket.length <= k) return [...bucket];

  const copy = [...bucket];
  shuffleArray(copy);
  if (!scorer) {
    return copy.slice(0, k);
  }

  // 先打亂再依分數排序（加上微量隨機擾動以探索不同最佳解）
  const scored = copy.map(p => ({ p, score: scorer(p) + Math.random() * 0.75 }));
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, k).map(item => item.p);
}

/**
 * 產生一組滿足休息與公平原則的候選賽程（每場為 4 人名單）
 * 原則：
 * 1. 首場必納入所有優先球員（至多 4 人），確保 <= 8 人時跨次抽籤上一場未出賽者必上場
 * 2. 5~7 人：每場必納入上一場全部休息者（保證 0 連續休息）
 * 3. 8 人：第 1、2 場各 4 人不重複；第 3 場起每兩場為一輪，強制混合前兩場人員以更換對手
 * 4. 9 人以上：維持上場次數平衡，第 3 場起允許上上一場休息者再休一場以混合對手，並避免過度連休
 */
function buildCandidateSchedule(
  selectedNames,
  matchCount,
  priorityNames,
  tierInfo,
  statsSource,
  guided
) {
  const N = selectedNames.length;
  const lowSet = new Set(tierInfo.lowNames);
  const playCounts = {};
  const consecRest = {};
  const mixedCounts = {};
  const highCounts = {};
  selectedNames.forEach(n => {
    playCounts[n] = 0;
    consecRest[n] = 0;
    mixedCounts[n] = 0;
    highCounts[n] = 0;
  });

  const matches = [];
  let lastResting = [];

  for (let m = 0; m < matchCount; m++) {
    let four = [];

    if (N === 4) {
      four = [...selectedNames];
    } else if (m === 0) {
      // 首場：優先球員必上場
      if (priorityNames.length >= 4) {
        if (guided && tierInfo.isClearTiered && priorityNames.length > 4) {
          const prioLows = priorityNames.filter(p => lowSet.has(p));
          const prioHighs = priorityNames.filter(p => !lowSet.has(p));
          const aimPureHigh = prioHighs.length >= 4 && Math.random() < 0.6;
          if (aimPureHigh) {
            four = pickFromBucket(prioHighs, 4, h => getSessionHighCount(h, statsSource));
          } else {
            const pickLows = prioLows.slice(0, Math.min(prioLows.length, 2));
            const restPool = priorityNames.filter(p => !pickLows.includes(p));
            four = [
              ...pickLows,
              ...pickFromBucket(restPool, 4 - pickLows.length, h => getSessionMixedCount(h, statsSource))
            ];
          }
        } else {
          four = pickFromBucket(priorityNames, 4);
        }
      } else {
        four = [...priorityNames];
        const needed = 4 - four.length;
        const others = selectedNames.filter(p => !four.includes(p));

        if (guided && tierInfo.isClearTiered) {
          const hasLowAlready = four.some(p => lowSet.has(p));
          const otherHighs = others.filter(p => !lowSet.has(p));
          const otherLows = others.filter(p => lowSet.has(p));

          if (!hasLowAlready && otherHighs.length >= needed && Math.random() < 0.65) {
            four.push(...pickFromBucket(otherHighs, needed, h => getSessionHighCount(h, statsSource)));
          } else if (hasLowAlready && otherLows.length > 0 && Math.random() < 0.7) {
            const addLows = pickFromBucket(otherLows, Math.min(otherLows.length, needed));
            four.push(...addLows);
            const rem = 4 - four.length;
            if (rem > 0) {
              four.push(...pickFromBucket(otherHighs, rem, h => getSessionMixedCount(h, statsSource)));
            }
          } else {
            four.push(...pickFromBucket(others, needed, p =>
              lowSet.has(p) ? -0.5 : getSessionMixedCount(p, statsSource)
            ));
          }
        } else {
          four.push(...pickFromBucket(others, needed));
        }
      }
    } else if (N <= 7) {
      // 5~7 人：上一場休息的 (N - 4) 人全部必上，確保 0 連續休息
      const mustPlay = [...lastResting];
      const needed = 4 - mustPlay.length;
      const prevPlayed = selectedNames.filter(p => !mustPlay.includes(p));

      // 依 playCounts 分組由少到多挑選，維持上場次數高度平均
      const minPlay = Math.min(...prevPlayed.map(p => playCounts[p]));
      const buckets = [];
      for (let c = minPlay; c <= minPlay + 2; c++) {
        const b = prevPlayed.filter(p => playCounts[p] === c);
        if (b.length > 0) buckets.push(b);
      }

      four = [...mustPlay];
      for (const bucket of buckets) {
        const rem = 4 - four.length;
        if (rem <= 0) break;
        if (bucket.length <= rem) {
          four.push(...bucket);
        } else if (guided && tierInfo.isClearTiered) {
          const hasLowInFour = four.some(p => lowSet.has(p));
          const bHighs = bucket.filter(p => !lowSet.has(p));
          const bLows = bucket.filter(p => lowSet.has(p));

          if (hasLowInFour) {
            // 已經是低端混編場：若有多名低階球員優先同場，其餘挑混編場次最少的高階球員
            if (bLows.length > 0 && Math.random() < 0.7) {
              const addLows = pickFromBucket(bLows, Math.min(bLows.length, rem));
              four.push(...addLows);
              const stillRem = 4 - four.length;
              if (stillRem > 0) {
                four.push(...pickFromBucket(bHighs, stillRem, h =>
                  getSessionMixedCount(h, statsSource) + mixedCounts[h]
                ));
              }
            } else {
              four.push(...pickFromBucket(bucket, rem, p =>
                lowSet.has(p)
                  ? 10
                  : getSessionMixedCount(p, statsSource) + mixedCounts[p]
              ));
            }
          } else {
            // 目前尚未含低階球員：一定機率組純高端場，一定機率納入低階球員以探索各種輪休型態
            if (bHighs.length >= rem && Math.random() < 0.65) {
              four.push(...pickFromBucket(bHighs, rem, h =>
                getSessionHighCount(h, statsSource) + highCounts[h]
              ));
            } else {
              four.push(...pickFromBucket(bucket, rem, p =>
                lowSet.has(p)
                  ? -0.5
                  : getSessionMixedCount(p, statsSource) + mixedCounts[p]
              ));
            }
          }
        } else {
          four.push(...pickFromBucket(bucket, rem));
        }
      }
    } else if (N === 8) {
      // 8 人專屬分輪混編邏輯
      if (m % 2 === 1) {
        // 奇數索引場 (第 2、4、6...場)：與前一場互補，確保每兩場 8 人全上場一次
        const prev = matches[m - 1];
        four = selectedNames.filter(p => !prev.includes(p));
      } else {
        // 偶數索引場 (第 3、5、7...場)：必須混合前兩場人員，禁止重複前兩場的四人組
        const prevA = matches[m - 2]; // 上一場休息者
        const prevB = matches[m - 1]; // 上上一場休息、上一場上場者

        let kFromA = 2;
        if (tierInfo.isClearTiered) {
          // 明確高低層級時允許 3+1 或 2+2 混合（例如 7高1低時 3+1 可讓全員高階都至少打一場純高端且僅 1 人連休）
          if (tierInfo.lowNames.length === 1) {
            kFromA = Math.random() < 0.75 ? 3 : 2;
          } else {
            const choices = [2, 2, 3, 1];
            kFromA = choices[Math.floor(Math.random() * choices.length)];
          }
        }
        const kFromB = 4 - kFromA;

        if (guided && tierInfo.isClearTiered) {
          const aHasLow = prevA.some(p => lowSet.has(p));
          const bHasLow = prevB.some(p => lowSet.has(p));

          if (tierInfo.lowNames.length === 1 && kFromA === 3) {
            if (aHasLow) {
              // prevA 含唯一低階：從 prevA 拿 3 名高階 + 從 prevB 拿 1 名（高端場較少或混編場較多者）→ 本場純高端、下場低階帶 prevB 其餘 3 名高階
              const aHighs = prevA.filter(p => !lowSet.has(p));
              const bPick = pickFromBucket(prevB, 1, h =>
                -(getSessionMixedCount(h, statsSource) + mixedCounts[h]) +
                (getSessionHighCount(h, statsSource) + highCounts[h])
              );
              four = [...aHighs, ...bPick];
            } else if (bHasLow) {
              // prevB 含唯一低階：從 prevB 拿低階 + 從 prevA 拿 3 名（混編場較少者）→ 本場混編、下場純高端
              const bLow = prevB.filter(p => lowSet.has(p));
              const aPick = pickFromBucket(prevA, 3, h =>
                (getSessionMixedCount(h, statsSource) + mixedCounts[h]) -
                (getSessionHighCount(h, statsSource) + highCounts[h])
              );
              four = [...aPick, ...bLow];
            } else {
              four = [...pickFromBucket(prevA, kFromA), ...pickFromBucket(prevB, kFromB)];
            }
          } else {
            // 多名低階或其他切法：傾向讓低階集中同組（放本場或放下一場），並讓高階平均輪替
            const putLowInCurrent = Math.random() < 0.5;
            const pickFromGroup = (group, k) => pickFromBucket(group, k, p => {
              if (lowSet.has(p)) return putLowInCurrent ? -10 : 10;
              return putLowInCurrent
                ? (getSessionMixedCount(p, statsSource) + mixedCounts[p])
                : (getSessionHighCount(p, statsSource) + highCounts[p]);
            });
            four = [...pickFromGroup(prevA, kFromA), ...pickFromGroup(prevB, kFromB)];
          }
        } else {
          four = [...pickFromBucket(prevA, kFromA), ...pickFromBucket(prevB, kFromB)];
        }
      }
    } else {
      // N >= 9：維持上場次數平衡；第 3 場起允許上上一場休息者再休一場以混合對手，但限制最大連休數
      const maxConsecRest = Math.ceil(N / 4);
      const minPlay = Math.min(...selectedNames.map(p => playCounts[p]));

      // 必須立即上場者：上場數為最低且已達連休上限
      const urgent = selectedNames.filter(
        p => playCounts[p] === minPlay && consecRest[p] >= maxConsecRest
      );

      if (urgent.length >= 4) {
        four = pickFromBucket(urgent, 4);
      } else {
        four = [...urgent];
        const remainingPool = selectedNames.filter(p => !four.includes(p));

        // 依 (playCount 升冪, 是否上一場有休息降冪) 分桶，不強制把連休 2 場與連休 1 場鎖死在同一組，讓第 3 場起可自然混編對手
        const orderedBuckets = [];
        for (let c = minPlay; c <= minPlay + 2; c++) {
          const restedInTier = remainingPool.filter(p => playCounts[p] === c && consecRest[p] >= 1);
          const playedPrevInTier = remainingPool.filter(p => playCounts[p] === c && consecRest[p] === 0);
          if (restedInTier.length > 0) orderedBuckets.push(restedInTier);
          if (playedPrevInTier.length > 0) orderedBuckets.push(playedPrevInTier);
        }

        for (const bucket of orderedBuckets) {
          const rem = 4 - four.length;
          if (rem <= 0) break;
          if (bucket.length <= rem) {
            four.push(...bucket);
          } else if (guided && tierInfo.isClearTiered) {
            const hasLowInFour = four.some(p => lowSet.has(p));
            const bHighs = bucket.filter(p => !lowSet.has(p));
            const bLows = bucket.filter(p => lowSet.has(p));
            if (hasLowInFour) {
              if (bLows.length > 0 && Math.random() < 0.7) {
                const addLows = pickFromBucket(bLows, Math.min(bLows.length, rem));
                four.push(...addLows);
                const stillRem = 4 - four.length;
                if (stillRem > 0) {
                  four.push(...pickFromBucket(bHighs, stillRem, h =>
                    getSessionMixedCount(h, statsSource) + mixedCounts[h]
                  ));
                }
              } else {
                four.push(...pickFromBucket(bucket, rem, p =>
                  lowSet.has(p) ? 10 : (getSessionMixedCount(p, statsSource) + mixedCounts[p])
                ));
              }
            } else if (bHighs.length >= rem && Math.random() < 0.65) {
              four.push(...pickFromBucket(bHighs, rem, h =>
                getSessionHighCount(h, statsSource) + highCounts[h]
              ));
            } else {
              four.push(...pickFromBucket(bucket, rem, p =>
                lowSet.has(p) ? -0.5 : (getSessionMixedCount(p, statsSource) + mixedCounts[p])
              ));
            }
          } else {
            four.push(...pickFromBucket(bucket, rem));
          }
        }
      }
    }

    // 更新狀態
    const fourSet = new Set(four);
    const resting = selectedNames.filter(p => !fourSet.has(p));
    const hasLow = tierInfo.isClearTiered && four.some(p => lowSet.has(p));

    selectedNames.forEach(p => {
      if (fourSet.has(p)) {
        playCounts[p]++;
        consecRest[p] = 0;
        if (tierInfo.isClearTiered && !lowSet.has(p)) {
          if (hasLow) mixedCounts[p]++;
          else highCounts[p]++;
        }
      } else {
        consecRest[p]++;
      }
    });

    lastResting = resting;
    matches.push(four);
  }

  return matches;
}

/**
 * 計算數值陣列的變異數總和（離差平方和）
 */
function sumSquaredDeviation(values) {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - avg) * (v - avg), 0);
}

/**
 * 評估一組完整賽程的總懲罰分數（越低越佳）
 */
function evaluateSchedule(
  balancedMatches,
  selectedNames,
  tierInfo,
  statsSource,
  prevDrawKeys,
  enableRealmBalance
) {
  const N = selectedNames.length;
  const lowSet = new Set(tierInfo.lowNames);
  const playCounts = {};
  const consecRest = {};
  selectedNames.forEach(p => {
    playCounts[p] = 0;
    consecRest[p] = 0;
  });

  let penalty = 0;
  const groupCounts = {};
  const pairCoOccur = {};
  const schedPartnerCounts = {};
  const maxOkRest = N <= 7 ? 1 : (N === 8 ? 2 : Math.ceil(N / 4));

  balancedMatches.forEach((match, m) => {
    const matchSet = new Set(match);
    const gKey = getGroupKey(match);
    groupCounts[gKey] = (groupCounts[gKey] || 0) + 1;

    // 8 人場次嚴禁第 3 場起與前兩場的四人組相同
    if (N === 8 && m >= 2) {
      const prev2Key = getGroupKey(balancedMatches[m - 2]);
      const prev1Key = getGroupKey(balancedMatches[m - 1]);
      if (gKey === prev2Key || gKey === prev1Key) {
        penalty += 50000;
      }
      if (prevDrawKeys && prevDrawKeys.has(gKey)) {
        penalty += 120;
      }
    }

    // 統計連休與上場次數
    selectedNames.forEach(p => {
      if (matchSet.has(p)) {
        playCounts[p]++;
        consecRest[p] = 0;
      } else {
        consecRest[p]++;
        if (N <= 7 && consecRest[p] >= 2) {
          penalty += 100000;
        } else if (N === 8) {
          if (consecRest[p] >= 3) penalty += 100000;
          else if (consecRest[p] === 2) penalty += 30;
        } else if (N >= 9) {
          if (consecRest[p] > maxOkRest) penalty += 50000;
          else if (consecRest[p] === maxOkRest) penalty += 35;
        }
      }
    });

    // 同場 4 人兩兩共場次數
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const pk = getPairKey(match[i], match[j]);
        pairCoOccur[pk] = (pairCoOccur[pk] || 0) + 1;
      }
    }

    // 隊友重複次數
    const pkA = getPairKey(match[0], match[1]);
    const pkB = getPairKey(match[2], match[3]);
    schedPartnerCounts[pkA] = (schedPartnerCounts[pkA] || 0) + 1;
    schedPartnerCounts[pkB] = (schedPartnerCounts[pkB] || 0) + 1;
    penalty += getSessionPartnerCount(match[0], match[1], statsSource) * 10;
    penalty += getSessionPartnerCount(match[2], match[3], statsSource) * 10;
  });

  // 1. 上場次數公平性
  const pVals = Object.values(playCounts);
  const playSpread = Math.max(...pVals) - Math.min(...pVals);
  penalty += playSpread > 1 ? playSpread * 100000 : playSpread * 500;

  // 2. 四人組重複懲罰（N >= 5）
  if (N >= 5) {
    const dupWeight = N === 5 ? 200 : 800;
    Object.values(groupCounts).forEach(cnt => {
      if (cnt > 1) penalty += (cnt - 1) * dupWeight;
    });
  }

  // 3. 明確分層模式（原則二）：高階球員平均參與高端局與低端混編局
  if (enableRealmBalance && tierInfo.isClearTiered) {
    const highInSched = {};
    const mixedInSched = {};
    tierInfo.highNames.forEach(h => {
      highInSched[h] = 0;
      mixedInSched[h] = 0;
    });

    let totalHighMatches = 0;
    balancedMatches.forEach(match => {
      const hasLow = match.some(p => lowSet.has(p));
      if (!hasLow) totalHighMatches++;
      match.forEach(p => {
        if (!lowSet.has(p)) {
          if (hasLow) mixedInSched[p]++;
          else highInSched[p]++;
        }
      });
    });

    // 若低階球員 >= 2 人，鼓勵低階球員集中於同一混編場，增加純高端場數
    if (tierInfo.lowNames.length >= 2) {
      penalty -= totalHighMatches * 1000;
    }

    const hVals = Object.values(highInSched);
    const mVals = Object.values(mixedInSched);
    const highSpread = Math.max(...hVals) - Math.min(...hVals);
    const mixedSpread = Math.max(...mVals) - Math.min(...mVals);

    penalty += mixedSpread * 5000 + sumSquaredDeviation(mVals) * 400;
    penalty += highSpread * 5000 + sumSquaredDeviation(hVals) * 400;

    // 只要純高端場次總名額足夠覆蓋每位高階球員，每人至少應打一場純高端局
    if (totalHighMatches * 4 >= tierInfo.highNames.length) {
      tierInfo.highNames.forEach(h => {
        if (highInSched[h] === 0) penalty += 10000;
      });
    }

    // 跨次抽籤（同場次累計）平均輪替
    const cumMixedVals = tierInfo.highNames.map(h => getSessionMixedCount(h, statsSource) + mixedInSched[h]);
    const cumHighVals = tierInfo.highNames.map(h => getSessionHighCount(h, statsSource) + highInSched[h]);
    penalty += (Math.max(...cumMixedVals) - Math.min(...cumMixedVals)) * 1500;
    penalty += sumSquaredDeviation(cumMixedVals) * 150;
    penalty += (Math.max(...cumHighVals) - Math.min(...cumHighVals)) * 1500;
    penalty += sumSquaredDeviation(cumHighVals) * 150;
  }

  // 4. 對手與隊友多樣性（避免小圈圈固定綁在一起）
  if (N >= 5) {
    Object.values(pairCoOccur).forEach(cnt => {
      if (cnt > 1) penalty += (cnt - 1) * (cnt - 1) * 25;
    });
  }
  Object.values(schedPartnerCounts).forEach(cnt => {
    if (cnt > 1) penalty += (cnt - 1) * 45;
  });

  // 微量隨機值打破完全同分僵局，確保每次抽籤皆具新鮮感
  penalty += Math.random() * 0.1;
  return penalty;
}

/**
 * 核心排程最佳化引擎
 * 支援：
 * - 修為戰力平衡模式（明確高低分層輪替 / 同層或複雜混合時公平隨機 + 單場 2v2 戰力平衡）
 * - 純隨機模式（仍嚴格保障休息原則與 8 人以上混編對手）
 */
function optimizeSchedule(
  selectedNames,
  matchCount,
  priorityNames,
  noBind,
  enableRealmBalance = true,
  statsSource = sessionStats,
  prevDrawKeys = lastDrawGroupKeys
) {
  const tierInfo = enableRealmBalance
    ? analyzeRealmTiers(selectedNames)
    : { mode: "random", isClearTiered: false, threshold: 0, highNames: [...selectedNames], lowNames: [] };

  const totalTrials = tierInfo.isClearTiered ? 600 : 250;
  let bestSchedule = null;
  let bestPenalty = Infinity;

  for (let trial = 0; trial < totalTrials; trial++) {
    const guided = tierInfo.isClearTiered && trial >= Math.floor(totalTrials * 0.35);
    const rawMatches = buildCandidateSchedule(
      selectedNames,
      matchCount,
      priorityNames,
      tierInfo,
      statsSource,
      guided
    );

    // 單場 2v2 平衡配對，並追蹤本輪搭檔次數以促進搭檔輪替
    const schedPartnerCounts = {};
    const balancedMatches = rawMatches.map((four, m) => {
      const balanced = balanceSingleMatch(
        four,
        noBind || m > 0,
        priorityNames,
        schedPartnerCounts,
        enableRealmBalance,
        statsSource
      );
      const pkA = getPairKey(balanced[0], balanced[1]);
      const pkB = getPairKey(balanced[2], balanced[3]);
      schedPartnerCounts[pkA] = (schedPartnerCounts[pkA] || 0) + 1;
      schedPartnerCounts[pkB] = (schedPartnerCounts[pkB] || 0) + 1;
      return balanced;
    });

    const penalty = evaluateSchedule(
      balancedMatches,
      selectedNames,
      tierInfo,
      statsSource,
      prevDrawKeys,
      enableRealmBalance
    );

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestSchedule = balancedMatches;
    }
  }

  return { schedule: bestSchedule, tierInfo };
}

/**
 * 依據最後一場未上場球員更新「自動優先」勾選
 */
function updateAutoPriorityFromLastMatch(allSelected, teams) {
  if (typeof document === 'undefined') return;
  const autoPriorityEl = document.getElementById('autoPriority');
  if (!autoPriorityEl || !autoPriorityEl.checked || !teams || teams.length === 0) return;

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

/**
 * 隨機分組主函數
 */
function generateTeams() {
  // 抽籤前先與 DOM 修為選單同步，避免任何修為暫存不同步
  syncPlayerRealmsFromDOM();

  const selectedCheckboxes = document.querySelectorAll('#player-list input.player:checked');
  let allSelected = Array.from(selectedCheckboxes).map(cb => cb.value);

  if (allSelected.length < 4) {
    alert("請至少選擇 4 位球員");
    return;
  }

  // 若出戰名單或任一球員修為發生變化，重置本場次輪替統計，避免舊修為殘留影響
  const currentSignature = getRosterSignature(allSelected);
  if (lastRosterSignature && lastRosterSignature !== currentSignature) {
    resetSessionFairnessState();
  }
  lastRosterSignature = currentSignature;

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

  const { schedule: teams, tierInfo } = optimizeSchedule(
    allSelected,
    totalMatchTarget,
    priorityPlayers,
    noBind,
    enableRealmBalance
  );

  generatedTeams = teams;
  currentMatchIndex = 0;
  lastMatchRecorded = false;

  recordMatchStatistics(teams, tierInfo);
  displayResults();
  updateAutoPriorityFromLastMatch(allSelected, teams);
}

/**
 * 累計本輪所有場次的統計資訊（同時更新本場次記憶體輪替狀態與 IndexedDB）
 */
function recordMatchStatistics(allMatches, tierInfo = null) {
  const lowSet = new Set((tierInfo && tierInfo.isClearTiered) ? tierInfo.lowNames : []);
  const newGroupKeys = new Set();

  allMatches.forEach(m => {
    newGroupKeys.add(getGroupKey(m));
    const teamA = m.slice(0, 2);
    const teamB = m.slice(2, 4);
    const hasLow = lowSet.size > 0 && m.some(p => lowSet.has(p));

    [teamA, teamB].forEach((team, teamIdx) => {
      const oppTeam = teamIdx === 0 ? teamB : teamA;

      team.forEach(pName => {
        // 1. 更新本場次記憶體輪替統計 (sessionStats)
        if (!sessionStats[pName]) {
          sessionStats[pName] = {
            name: pName,
            playedCount: 0,
            mixedMatchCount: 0,
            highMatchCount: 0,
            partnerCounts: {}
          };
        }
        const ss = sessionStats[pName];
        ss.playedCount++;
        if (lowSet.size > 0 && !lowSet.has(pName)) {
          if (hasLow) ss.mixedMatchCount++;
          else ss.highMatchCount++;
        }

        // 2. 更新持久化統計 (cachedStats)
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

        if (lowSet.size > 0 && !lowSet.has(pName)) {
          if (hasLow) s.lowMatchCount = (s.lowMatchCount || 0) + 1;
          else s.highMatchCount = (s.highMatchCount || 0) + 1;
        }

        const partner = team.find(p => p !== pName);
        if (partner) {
          ss.partnerCounts[partner] = (ss.partnerCounts[partner] || 0) + 1;
          s.partnerCounts[partner] = (s.partnerCounts[partner] || 0) + 1;
        }

        oppTeam.forEach(opp => {
          s.opponentCounts[opp] = (s.opponentCounts[opp] || 0) + 1;
        });
      });
    });
  });

  lastDrawGroupKeys = newGroupKeys;
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
  if (nextMatchBtn) {
    if (currentMatchIndex < generatedTeams.length - 1) {
      nextMatchBtn.classList.remove('d-none');
      nextMatchBtn.disabled = false;
      nextMatchBtn.textContent = '下一場對戰';
    } else if (!lastMatchRecorded) {
      nextMatchBtn.classList.remove('d-none');
      nextMatchBtn.disabled = false;
      nextMatchBtn.textContent = '完成本場對戰';
    } else {
      nextMatchBtn.classList.remove('d-none');
      nextMatchBtn.disabled = true;
      nextMatchBtn.textContent = '✓ 本場已紀錄';
    }
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

  const selectedCheckboxes = document.querySelectorAll('#player-list input.player:checked');
  const allSelected = Array.from(selectedCheckboxes).map(cb => cb.value);
  updateAutoPriorityFromLastMatch(allSelected, generatedTeams);
}

// 建立單場歷史紀錄資料（保留當下球員名稱與修為）
function buildMatchHistoryRecord(match) {
  const buildPlayer = (name) => {
    const p = cachedPlayers.find(item => item.name === name);
    const realm = (p && REALM_DATA[p.realm]) ? p.realm : DEFAULT_REALM;
    return {
      name,
      realm,
      level: REALM_DATA[realm].level
    };
  };

  const teamA = [buildPlayer(match[0]), buildPlayer(match[1])];
  const teamB = [buildPlayer(match[2]), buildPlayer(match[3])];
  const scoreA = teamA[0].level + teamA[1].level;
  const scoreB = teamB[0].level + teamB[1].level;

  return {
    playedAt: Date.now(),
    teamA,
    teamB,
    scoreA,
    scoreB,
    diff: Math.abs(scoreA - scoreB)
  };
}

function formatHistoryTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHistoryPlayerDisplay(playerObj) {
  const realm = (playerObj && REALM_DATA[playerObj.realm]) ? playerObj.realm : DEFAULT_REALM;
  const realmInfo = REALM_DATA[realm];
  return `<span>${escapeHtml(playerObj.name)} <span class="realm-badge ${realmInfo.class}">${realm}</span></span>`;
}

async function updateHistoryCountBadge() {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('historyCountBadge');
  if (!badge) return;
  const history = await DBHelper.getMatchHistory();
  badge.textContent = history.length;
}

async function renderMatchHistoryList() {
  const container = document.getElementById('match-history-list');
  if (!container) return;

  const history = await DBHelper.getMatchHistory();
  container.innerHTML = '';

  if (!history || history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-muted text-center py-4';
    empty.textContent = '目前尚無歷史對戰紀錄（按下「下一場對戰」或「完成本場對戰」後才會紀錄）';
    container.appendChild(empty);
    return;
  }

  history.forEach((record, idx) => {
    const item = document.createElement('div');
    item.className = 'list-group-item d-flex justify-content-between align-items-center py-3 flex-wrap gap-2';

    const left = document.createElement('div');
    left.className = 'd-flex flex-column gap-1';

    const meta = document.createElement('div');
    meta.className = 'small text-muted';
    meta.innerHTML = `<span class="badge bg-light text-dark border me-1">#${idx + 1}</span>${formatHistoryTimestamp(record.playedAt)}`;

    const matchLine = document.createElement('div');
    matchLine.innerHTML = `${formatHistoryPlayerDisplay(record.teamA[0])} & ${formatHistoryPlayerDisplay(record.teamA[1])} <span class="text-muted fw-bold mx-1">VS</span> ${formatHistoryPlayerDisplay(record.teamB[0])} & ${formatHistoryPlayerDisplay(record.teamB[1])}`;

    left.appendChild(meta);
    left.appendChild(matchLine);

    const diffBadge = document.createElement('span');
    const mDiff = record.diff ?? Math.abs((record.scoreA || 0) - (record.scoreB || 0));
    diffBadge.className = `badge ${mDiff === 0 ? 'bg-success' : (mDiff <= 1 ? 'bg-info text-dark' : 'bg-secondary')}`;
    diffBadge.textContent = `戰力 ${record.scoreA} vs ${record.scoreB}`;

    item.appendChild(left);
    item.appendChild(diffBadge);
    container.appendChild(item);
  });
}

async function openMatchHistoryModal() {
  await renderMatchHistoryList();
  await updateHistoryCountBadge();
  const modalEl = document.getElementById('matchHistoryModal');
  if (modalEl && typeof bootstrap !== 'undefined') {
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }
}

async function clearMatchHistoryAction() {
  if (!confirm("確定要清除所有歷史對戰紀錄嗎？")) return;
  await DBHelper.clearMatchHistory();
  await renderMatchHistoryList();
  await updateHistoryCountBadge();
}

// 切換到下一場對戰（只有按下本按鈕才會將當前對戰紀錄寫入 IndexedDB 歷史紀錄）
async function nextMatch() {
  if (!generatedTeams || generatedTeams.length === 0) return;

  if (currentMatchIndex < generatedTeams.length - 1) {
    const finishedMatch = generatedTeams[currentMatchIndex];
    currentMatchIndex++;
    if (typeof document !== 'undefined') displayResults();
    await DBHelper.addMatchHistory(buildMatchHistoryRecord(finishedMatch));
    await updateHistoryCountBadge();
  } else if (!lastMatchRecorded) {
    const finishedMatch = generatedTeams[currentMatchIndex];
    lastMatchRecorded = true;
    if (typeof document !== 'undefined') displayResults();
    await DBHelper.addMatchHistory(buildMatchHistoryRecord(finishedMatch));
    await updateHistoryCountBadge();
  }
}

// 隨機打亂陣列
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 供 Node.js 測試環境匯出核心演算法
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REALM_DATA,
    DEFAULT_PLAYERS,
    MAX_MATCH_HISTORY,
    DBHelper,
    setTestState: (players, stats = {}, prevKeys = new Set()) => {
      cachedPlayers = players.map(p => ({ ...p }));
      sessionStats = stats;
      lastDrawGroupKeys = prevKeys;
    },
    setTestSchedule: (teams, idx = 0, recorded = false) => {
      generatedTeams = teams.map(m => [...m]);
      currentMatchIndex = idx;
      lastMatchRecorded = recorded;
    },
    getTestScheduleState: () => ({ generatedTeams, currentMatchIndex, lastMatchRecorded }),
    getSessionStats: () => sessionStats,
    getLastDrawGroupKeys: () => lastDrawGroupKeys,
    resetSessionFairnessState,
    getPlayerLevel,
    getRecommendedMatchCount,
    analyzeRealmTiers,
    balanceSingleMatch,
    optimizeSchedule,
    recordMatchStatistics,
    buildMatchHistoryRecord,
    nextMatch,
    handleSwapGroups,
    getGroupKey
  };
}
