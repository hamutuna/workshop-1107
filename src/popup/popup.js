// のびっと：ポップアップ画面
// 開始・停止、鳴り方（繰り返し／1回だけ）の切り替え、動作チェックを行います。

const statusEl = document.getElementById('status');
const announcerEl = document.getElementById('announcer');
const remainingEl = document.getElementById('remaining');
const toggleButton = document.getElementById('toggle');
const checkButton = document.getElementById('check');
const shortcutEl = document.getElementById('shortcut');
const permissionWarning = document.getElementById('permission-warning');
const checkPanel = document.getElementById('check-panel');
const checkError = document.getElementById('check-error');
const checkOkButton = document.getElementById('check-ok');
const modeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));

const MODE_LABELS = {
  repeat: '繰り返し',
  once: '1回だけ',
};

let state = null;
let tickTimer = null;
let refreshing = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error(response ? response.error : '応答がありません');
  }
  return response;
}

function selectedMode() {
  const checked = modeInputs.find((input) => input.checked);
  return checked ? checked.value : 'repeat';
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function stateSummary() {
  if (!state) {
    return '読み込み中…';
  }
  if (!state.running) {
    return '停止中';
  }
  return `動作中（${MODE_LABELS[state.mode]}）`;
}

// 残り時間の表示は読み上げ対象（role="status"）の外で更新し、毎秒読み上げられないようにする
function renderRemaining() {
  if (!state || !state.running || !state.nextTime) {
    remainingEl.hidden = true;
    remainingEl.textContent = '';
    return;
  }
  const left = state.nextTime - Date.now();
  if (left <= 0) {
    // お知らせが鳴った直後。最新の状態を取り直す（取り直し中は重ねて呼ばない）
    remainingEl.textContent = 'まもなくお知らせします';
    if (!refreshing) {
      refreshing = true;
      setTimeout(() => {
        refresh()
          .catch(console.error)
          .finally(() => {
            refreshing = false;
          });
      }, 1500);
    }
    return;
  }
  remainingEl.hidden = false;
  remainingEl.textContent = `次のお知らせまで ${formatRemaining(left)}`;
}

function render() {
  for (const input of modeInputs) {
    input.checked = input.value === state.mode;
  }
  for (const el of document.querySelectorAll('.interval')) {
    el.textContent = String(state.intervalMinutes);
  }
  toggleButton.textContent = state.running ? '停止' : '開始';
  statusEl.textContent = stateSummary();
  permissionWarning.hidden = state.notificationPermission !== 'denied';
  renderRemaining();

  clearInterval(tickTimer);
  if (state.running) {
    tickTimer = setInterval(renderRemaining, 1000);
  }
}

// 画面には短い状態を表示し、詳しい内容は読み上げ専用の領域で伝える
function announce(text) {
  statusEl.textContent = stateSummary();
  announcerEl.textContent = text;
}

// 音と通知を試した結果を案内に表示し、読み上げ用の文を返す
function showCheckResult(result) {
  const problems = [];
  if (!result.soundOk) {
    problems.push('音を鳴らす処理でエラーが起きました');
  }
  if (!result.notificationOk) {
    problems.push('通知を出す処理でエラーが起きました');
  }
  checkError.hidden = problems.length === 0;
  checkError.textContent = problems.join('。');
  checkPanel.hidden = false;

  if (problems.length > 0) {
    return `${problems.join('。')}。`;
  }
  return 'お試しの音と通知を出しました。届かない場合は下の案内を確認してください。';
}

function hideCheckPanel() {
  checkPanel.hidden = true;
}

async function refresh() {
  const wasRunning = state ? state.running : null;
  ({ state } = await send({ type: 'get-state' }));
  render();
  if (wasRunning === null || wasRunning !== state.running) {
    announce(stateSummary());
  }
}

toggleButton.addEventListener('click', async () => {
  toggleButton.disabled = true;
  try {
    if (state.running) {
      ({ state } = await send({ type: 'stop' }));
      render();
      hideCheckPanel();
      announce('停止しました');
    } else {
      const response = await send({ type: 'start', mode: selectedMode() });
      state = response.state;
      render();
      const started =
        state.mode === 'repeat'
          ? `開始しました。${state.intervalMinutes}分ごとにお知らせします。`
          : `開始しました。${state.intervalMinutes}分後に1回お知らせします。`;
      announce(started + showCheckResult(response.check));
    }
  } catch (error) {
    announce('操作に失敗しました。もう一度お試しください');
    console.error(error);
  } finally {
    toggleButton.disabled = false;
    toggleButton.focus();
  }
});

for (const input of modeInputs) {
  input.addEventListener('change', async () => {
    if (!input.checked) {
      return;
    }
    try {
      ({ state } = await send({ type: 'set-mode', mode: input.value }));
      render();
      announce(`鳴り方を「${MODE_LABELS[state.mode]}」にしました`);
    } catch (error) {
      announce('設定を保存できませんでした');
      console.error(error);
    }
  });
}

checkButton.addEventListener('click', async () => {
  checkButton.disabled = true;
  try {
    const response = await send({ type: 'check' });
    state = response.state;
    render();
    announce(showCheckResult(response.check));
  } catch (error) {
    announce('動作チェックに失敗しました');
    console.error(error);
  } finally {
    checkButton.disabled = false;
    checkButton.focus();
  }
});

checkOkButton.addEventListener('click', () => {
  hideCheckPanel();
  announce('確認できました');
  toggleButton.focus();
});

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const action = commands.find((command) => command.name === '_execute_action');
  if (action && action.shortcut) {
    shortcutEl.textContent = action.shortcut;
  }
}

// ポップアップを開いている間にお知らせが鳴ったら、表示を最新にする
chrome.alarms.onAlarm.addListener(() => {
  setTimeout(() => refresh().catch(console.error), 300);
});

document.addEventListener('DOMContentLoaded', () => {
  refresh().catch((error) => {
    announce('状態を読み込めませんでした');
    console.error(error);
  });
  showShortcut();
});
