let generatedTeams = [];
let currentMatchIndex = 0;

document.addEventListener('DOMContentLoaded', function () {
  // 全選/取消全選功能
  document.getElementById('selectAll').addEventListener('change', function () {
    const checkboxes = document.querySelectorAll('#player-list input.player');
    checkboxes.forEach(checkbox => {
      checkbox.checked = this.checked;
    });
  });

  // 監聽進階選項變更以更新徽章數字
  document.getElementById('autoPriority').addEventListener('change', updateAdvancedOptionsBadge);
  document.getElementById('noBindCheck').addEventListener('change', updateAdvancedOptionsBadge);

  // 初始化所有帶有 data-bs-toggle="popover" 屬性的元素
  const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
  const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));

  // 初始化臨時交換按鈕事件監聽
  document.getElementById('swapGroupsBtn').addEventListener('click', handleSwapGroups);
});

// 新增球員並生成核取方塊
function addPlayer() {
  const input = document.getElementById('newPlayer').value.trim();
  if (!input) return;

  const names = input.split(',').map(name => name.trim()).filter(name => name);
  const playerList = document.getElementById('player-list');

  names.forEach(name => {
    const div = document.createElement('div');
    div.classList.add('col');
    div.classList.add('card');

    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" class="form-check-input player" value="${name}" checked> ${name}`;

    const labelPriority = document.createElement('label');
    labelPriority.innerHTML = `<input type="checkbox" class="form-check-input check-red priority" value="${name}"> 優先`;

    div.appendChild(label);
    div.appendChild(labelPriority);
    playerList.appendChild(div);
  });

  document.getElementById('newPlayer').value = '';
}

/**
 * 隨機分組邏輯核心函數
 */
function generateTeams() {
  // --- 1. 初始化資料與驗證 ---
  // 取得所有目前在清單中被「勾選」要上場的人
  const checkboxes = document.querySelectorAll('#player-list input.player:checked');
  let allSelected = Array.from(checkboxes).map(checkbox => checkbox.value);

  // 檢查人數，羽球雙打至少需要 4 人
  if (allSelected.length < 4) {
    alert("請至少選擇 4 位球員");
    return;
  }

  // --- 2. 處理球員優先權與排序 ---
  // 取得被勾選「優先」的球員名單
  const priorityCheckboxes = document.querySelectorAll('#player-list input.priority:checked');
  let priorityPlayers = Array.from(priorityCheckboxes).map(checkbox => checkbox.value);
  // 確保優先球員也必須在選中名單內
  priorityPlayers = priorityPlayers.filter(p => allSelected.includes(p));

  // 分出「非優先」的球員
  let otherPlayers = allSelected.filter(p => !priorityPlayers.includes(p));

  // 為了公平，先分別隨機打亂優先者與非優先者的內部順序
  shuffleArray(priorityPlayers);
  shuffleArray(otherPlayers);

  // 重新組合清單：優先者排最前。這決定了誰會出現在第一場。
  const sortedPlayers = priorityPlayers.concat(otherPlayers);
  const count = sortedPlayers.length;
  const noBind = document.getElementById('noBindCheck').checked; // 取得「優先不必同組」設定

  let teams = [];

  // --- 3. 核心分配邏輯 ---

  // [情境 A] 當人數為 5~7 人時：執行「公平休息循環」
  // 目的：確保每個人休息次數平均，且不連續休息兩場
  if (count >= 5 && count <= 7) {
    let restSchedules = [];

    if (count === 5) {
      // 5人：抽5場，每人各休1場。
      // 休息索引依序從陣列後方開始，讓優先者(索引0,1)在最後才休息。
      restSchedules = [[4], [3], [2], [1], [0]];
    } else if (count === 6) {
      // 6人：抽3場，每場休2人。剛好 3x2=6，每人輪流休完 1 次。
      restSchedules = [[4, 5], [2, 3], [0, 1]];
    } else if (count === 7) {
      // 7人：抽7場，每場休3人，使每位球員皆能公平上場4次，且不連續休息。
      for (let i = 0; i < 7; i++) {
        let j = (i + 2) % 7;
        restSchedules.push([j, (j + 2) % 7, (j + 4) % 7]);
      }
    }

    // 決定首場對戰的上場與休息位置索引
    let playSlots = [];
    let restSlots = [];
    if (count === 5) {
      playSlots = [0, 1, 2, 3];
      restSlots = [4];
    } else if (count === 6) {
      playSlots = [0, 1, 2, 3];
      restSlots = [4, 5];
    } else if (count === 7) {
      playSlots = [0, 1, 3, 5];
      restSlots = [2, 4, 6];
    }

    // 隨機打亂上場位置，但維持優先同組規則
    if (noBind) {
      // 若優先不必同組，直接打亂所有上場位置
      shuffleArray(playSlots);
    } else {
      // 若優先必須同組，維持兩對的配對結構，只隨機打亂對伍順序與內部位置
      let pair1 = [playSlots[0], playSlots[1]];
      let pair2 = [playSlots[2], playSlots[3]];

      if (Math.random() < 0.5) pair1 = [pair1[1], pair1[0]];
      if (Math.random() < 0.5) pair2 = [pair2[1], pair2[0]];
      if (Math.random() < 0.5) {
        playSlots = [...pair2, ...pair1];
      } else {
        playSlots = [...pair1, ...pair2];
      }
    }

    // 打亂休息位置
    shuffleArray(restSlots);

    // 建立隨機分配後的球員陣列
    const playersToFilter = new Array(count);
    let playIndex = 0;
    let restIndex = 0;

    // 先將優先球員分配至上場位置（若上場位置滿了才分配至休息位置）
    priorityPlayers.forEach(player => {
      if (playIndex < playSlots.length) {
        playersToFilter[playSlots[playIndex++]] = player;
      } else {
        playersToFilter[restSlots[restIndex++]] = player;
      }
    });

    // 再將一般球員分配至剩餘的上場與休息位置
    otherPlayers.forEach(player => {
      if (playIndex < playSlots.length) {
        playersToFilter[playSlots[playIndex++]] = player;
      } else {
        playersToFilter[restSlots[restIndex++]] = player;
      }
    });

    // 依照定義好的休息時程產出組合
    restSchedules.forEach((restIndices, matchIdx) => {
      // 過濾掉該場次要休息的人，留下 4 位上場球員
      let match = playersToFilter.filter((_, idx) => !restIndices.includes(idx));

      /**
       * 優先權特殊規則：
       * 1. 只有第一場 (matchIdx === 0) 且「沒勾選不必同組」時，維持 sortedPlayers 順序（優先者會在同一組）。
       * 2. 勾選了「不必同組」或是在「第二場以後」，一律重新洗牌，打破固定順序。
       */
      if (matchIdx > 0 || noBind) {
        shuffleArray(match);
      }

      teams.push(match);
    });

  } else {
    // [情境 B] 人數為 4 或 8 人以上：執行「補位」邏輯
    let players = [...sortedPlayers];
    let matchCount = 0;

    // 每 4 個人切一組
    for (let i = 0; i < players.length; i += 4) {
      let chunk = players.slice(i, i + 4);

      // 如果人數不足 4 人 (例如總共 9 人，剩 1 人沒人配)
      if (chunk.length < 4 && chunk.length > 0) {
        // 從這場沒被排到的人（休息者）中抽人補位
        let pool = allSelected.filter(p => !chunk.includes(p));
        shuffleArray(pool);
        let needed = 4 - chunk.length;
        chunk.push(...pool.slice(0, needed));

        // 補位的場次因為包含重複上場的人，一律徹底打亂順序
        shuffleArray(chunk);
      } else if (chunk.length === 4) {
        // 剛好滿 4 人的場次
        // 只有第一場依據 noBind 決定是否打亂，後續場次 (matchCount > 0) 一律打亂
        if (matchCount > 0 || noBind) {
          shuffleArray(chunk);
        }
      }

      if (chunk.length === 4) {
        teams.push(chunk);
        matchCount++;
      }
    }
  }

  // --- 4. 輸出結果與自動化處理 ---

  generatedTeams = teams;
  currentMatchIndex = 0;

  // 顯示結果到畫面上 (呼叫 displayResults 函數)
  displayResults();

  // 檢查是否開啟「自動勾選優先」
  const autoPriority = document.getElementById('autoPriority').checked;
  if (autoPriority && teams.length > 0) {
    // 抓取最後一場對戰的 4 人
    const lastMatch = teams[teams.length - 1];
    // 從總名單中過濾，找出「沒在最後一場上場」的人 (即休息的人)
    const restingInLastMatch = allSelected.filter(p => !lastMatch.includes(p));

    // 先清除所有現有的優先勾選
    removePriority();

    // 自動幫這些休息的人勾選「優先」，確保他們下一輪第一場會上
    restingInLastMatch.forEach(name => {
      const cb = document.querySelector(`#player-list input.priority[value="${name}"]`);
      if (cb) cb.checked = true;
    });
  }
}

/**
 * 臨時交換：將下一場對戰與最後一場的組隊進行互換。
 */
/**
 * 臨時交換：將下一場對戰與列表中的所有後續對戰進行整體前移，再將原「下一場」組隊移動到最後一場的位置。
 */
function handleSwapGroups() {
  // 檢查是否有足夠的後續場次進行交換 (需要至少兩場: Next + Last)
  if (!generatedTeams || generatedTeams.length < 2) {
    alert("未能找到足以進行臨時交換的後續對戰場次（需要至少 2 場）。");
    return;
  }

  const nextMatchIndex = currentMatchIndex + 1;
  // 只有在下一場不是最後一場時，才需要執行循環前移和交換
  if (nextMatchIndex > generatedTeams.length - 1) {
    alert("無法執行臨時交換，因為本機已是最後一場對戰。");
    return;
  }

  // 儲存下一場的組隊資料 (要移動到最末尾的內容)
  const groupToMove = generatedTeams[nextMatchIndex];
  
  // 執行整體前移：將所有索引 i >= nextMatchIndex + 1 的元素，向前移動一個位置。
  for (let i = nextMatchIndex; i < generatedTeams.length - 1; i++) {
    generatedTeams[i] = generatedTeams[i + 1];
  }

  // 將原「下一場」的組隊資料放在列表的最後一場
  generatedTeams[generatedTeams.length - 1] = groupToMove;


  console.log(`已將第 ${nextMatchIndex + 1} 場對戰，移動到所有後續場次的末尾。`);

  // 通知用戶並更新 UI (從下一場開始重新顯示)
  displayResults();
}


// 顯示分組結果
function displayResults() {
  const currentBox = document.getElementById('current-match-box');
  const upcomingBox = document.getElementById('upcoming-matches-box');

  // 1. 渲染當前對戰
  const currentMatch = generatedTeams[currentMatchIndex];
  document.getElementById('current-match-header').textContent = `當前對戰 (第 ${currentMatchIndex + 1} / ${generatedTeams.length} 場)`;
  document.getElementById('team-a-display').textContent = currentMatch.slice(0, 2).join(' & ');
  document.getElementById('team-b-display').textContent = currentMatch.slice(2, 4).join(' & ');

  // 啟用 / 停用下一場對戰按鈕
  const nextMatchBtn = document.getElementById('next-match-btn');
  if (currentMatchIndex < generatedTeams.length - 1) {
    nextMatchBtn.classList.remove('d-none');
  } else {
    nextMatchBtn.classList.add('d-none');
  }

  // 啟用 / 停用臨時交換按鈕：需要至少 3 場總對戰 (Current + Next + Another) 且目前場次不能超過倒數第三位，才能執行循環移動。
  const swapGroupBtn = document.getElementById('swap-group-btn');
  if (generatedTeams.length >= 3 && currentMatchIndex < generatedTeams.length - 2) {
    swapGroupBtn.classList.remove('d-none');
  } else {
    swapGroupBtn.classList.add('d-none');
  }

  // 2. 渲染待對戰場次
  const listContainer = document.getElementById('upcoming-matches-list');
  listContainer.innerHTML = '';

  let upcomingCount = 0;
  for (let i = currentMatchIndex + 1; i < generatedTeams.length; i++) {
    upcomingCount++;
    const match = generatedTeams[i];
    const item = document.createElement('div');
    item.className = 'list-group-item d-flex justify-content-between align-items-center py-2';
    
    const matchText = document.createElement('span');
    matchText.innerHTML = `<strong>第 ${i + 1} 場:</strong> ${match.slice(0, 2).join(' & ')} <span class="text-muted fw-normal">VS</span> ${match.slice(2, 4).join(' & ')}`;
    item.appendChild(matchText);

    listContainer.appendChild(item);
  }

  if (upcomingCount === 0) {
    const item = document.createElement('div');
    item.className = 'list-group-item text-muted text-center py-3';
    item.textContent = '已無後續對戰場次';
    listContainer.appendChild(item);
  }
}

// 切換到下一場對戰
function nextMatch() {
  if (currentMatchIndex < generatedTeams.length - 1) {
    currentMatchIndex++;
    displayResults();
  }
}

// 隨機打亂數組
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 移除優先
function removePriority() {
  const priorityCheckboxes = document.querySelectorAll('#player-list input.priority:checked');
  priorityCheckboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
}

// 移除所有球員卡
function removeAllPlayers() {
  const playerList = document.getElementById('player-list');
  playerList.innerHTML = '';
}

// 更新進階選項徽章數字
function updateAdvancedOptionsBadge() {
  let count = 0;
  if (document.getElementById('autoPriority').checked) count++;
  if (document.getElementById('noBindCheck').checked) count++;

  const badge = document.getElementById('advancedOptionsBadge');
  badge.textContent = count;
}