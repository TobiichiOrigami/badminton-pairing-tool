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
      // 7人：抽3場，每場休3人。
      // 設計特定的休息索引組合，確保沒有人「連休兩場」。
      restSchedules = [
        [4, 5, 6], // 第一場優先者全上，休最後三位
        [1, 2, 3], // 第二場休中間三位
        [0, 5, 6]  // 第三場混合休
      ];
    }

    // 依照定義好的休息時程產出組合
    restSchedules.forEach((restIndices, matchIdx) => {
      // 過濾掉該場次要休息的人，留下 4 位上場球員
      let match = sortedPlayers.filter((_, idx) => !restIndices.includes(idx));

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

  // 顯示結果到畫面上 (呼叫 displayResults 函數)
  displayResults(teams);

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

// 顯示分組結果
function displayResults(teams) {
  let resultHtml = '';
  let groupIndex = 1;
  for (let i = 0; i < teams.length; i++) {
    resultHtml += `<p>組合 ${groupIndex++}: ${teams[i].slice(0, 2).join(' 跟 ')} 對 組合 ${groupIndex++}: ${teams[i].slice(2, 4).join(' 跟 ')}</p>`;
  }
  document.getElementById('result').innerHTML = resultHtml;
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
