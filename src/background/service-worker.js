// のびっと：バックグラウンド処理（Service Worker）
// タイマー（chrome.alarms）、通知、音の再生依頼を担当します。

const ALARM_NAME = 'nobitto';
const INTERVAL_MINUTES = 15;
const NOTIFICATION_ID = 'nobitto-reminder';
const CHECK_NOTIFICATION_ID = 'nobitto-check';
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const DEFAULT_MODE = 'repeat'; // 'repeat'（繰り返し） または 'once'（1回だけ）

// ---- 設定 ----

async function getMode() {
  const { mode } = await chrome.storage.local.get('mode');
  return mode === 'once' ? 'once' : DEFAULT_MODE;
}

async function getState() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  return {
    running: Boolean(alarm),
    nextTime: alarm ? alarm.scheduledTime : null,
    mode: await getMode(),
    intervalMinutes: INTERVAL_MINUTES,
    // Chrome側でこの拡張機能の通知が許可されているか（'granted' / 'denied'）
    // ※ Macの「システム設定」側の許可や集中モードは、拡張機能からは確認できない
    notificationPermission: await chrome.notifications.getPermissionLevel(),
  };
}

// ---- タイマー ----

function alarmOptions(mode, base) {
  const options = { ...base };
  if (mode === 'repeat') {
    options.periodInMinutes = INTERVAL_MINUTES;
  }
  return options;
}

async function start(mode) {
  const nextMode = mode === 'once' ? 'once' : 'repeat';
  await chrome.storage.local.set({ mode: nextMode });
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(
    ALARM_NAME,
    alarmOptions(nextMode, { delayInMinutes: INTERVAL_MINUTES })
  );
  await updateBadge(true);
}

async function stop() {
  await chrome.alarms.clear(ALARM_NAME);
  await updateBadge(false);
}

// 動作中に鳴り方を変えた場合は、次のお知らせ時刻を保ったまま作り直す
async function setMode(mode) {
  const nextMode = mode === 'once' ? 'once' : 'repeat';
  await chrome.storage.local.set({ mode: nextMode });
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (alarm) {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(
      ALARM_NAME,
      alarmOptions(nextMode, { when: Math.max(alarm.scheduledTime, Date.now() + 1000) })
    );
  }
}

// ---- 表示（バッジ） ----

async function updateBadge(running) {
  await chrome.action.setBadgeBackgroundColor({ color: '#1d5c3f' });
  await chrome.action.setBadgeText({ text: running ? 'ON' : '' });
}

async function syncBadge() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  await updateBadge(Boolean(alarm));
}

// ---- 音 ----

let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  if (contexts.length > 0) {
    return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'ひと休みの時間を知らせるチャイム音を鳴らすため',
    });
  }
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// 失敗した場合は例外を投げる（呼び出し側で扱う）
async function playChime() {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-chime' });
  if (!response || !response.ok) {
    throw new Error(response ? response.error : '音の再生ページから応答がありません');
  }
  console.info('[のびっと] 音を鳴らしました');
}

// ---- 通知 ----

async function createNotification(id, options) {
  await chrome.notifications.clear(id);
  const base = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'のびっと',
    priority: 2,
    silent: true, // 音は拡張機能のチャイムで鳴らすため、OSの通知音は重ねない
    ...options,
  };
  try {
    await chrome.notifications.create(id, base);
  } catch (error) {
    if (!base.buttons) {
      throw error;
    }
    // ボタン付きの通知に対応していない環境向けに、ボタンなしで出し直す
    console.warn('[のびっと] ボタンなしで通知を出し直します', error);
    delete base.buttons;
    await chrome.notifications.create(id, base);
  }
  console.info('[のびっと] 通知を出しました');
}

function showReminder(isRepeating) {
  const options = {
    message: isRepeating
      ? `${INTERVAL_MINUTES}分たちました。立ち上がって、のびっとしましょう。`
      : `${INTERVAL_MINUTES}分たちました。立ち上がって、のびっとしましょう。（タイマーは終了しました）`,
  };
  if (isRepeating) {
    options.buttons = [{ title: '停止' }];
  }
  return createNotification(NOTIFICATION_ID, options);
}

function showCheckNotification(message) {
  return createNotification(CHECK_NOTIFICATION_ID, { message, priority: 0 });
}

// ---- お知らせ・動作チェック ----

// 音と通知は別々に実行し、片方が失敗してももう片方は届くようにする
async function runBoth(showNotification) {
  const [sound, notification] = await Promise.allSettled([playChime(), showNotification()]);
  for (const result of [sound, notification]) {
    if (result.status === 'rejected') {
      console.error('[のびっと] お知らせに失敗しました', result.reason);
    }
  }
  return {
    soundOk: sound.status === 'fulfilled',
    notificationOk: notification.status === 'fulfilled',
  };
}

function remind(isRepeating) {
  return runBoth(() => showReminder(isRepeating));
}

// 開始時・「動作チェック」ボタンで、音と通知が届くかをその場で試す
function check(message) {
  return runBoth(() => showCheckNotification(message));
}

function startMessage(mode) {
  return mode === 'repeat'
    ? `のびっとを開始しました。${INTERVAL_MINUTES}分ごとにお知らせします。`
    : `のびっとを開始しました。${INTERVAL_MINUTES}分後に1回お知らせします。`;
}

// ---- イベント ----

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) {
    return;
  }
  console.info('[のびっと] 時間になりました', new Date().toLocaleTimeString());
  const isRepeating = Boolean(alarm.periodInMinutes);
  if (!isRepeating) {
    await updateBadge(false);
  }
  await remind(isRepeating);
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId === NOTIFICATION_ID && buttonIndex === 0) {
    await stop();
    await chrome.notifications.clear(NOTIFICATION_ID);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === NOTIFICATION_ID || notificationId === CHECK_NOTIFICATION_ID) {
    chrome.notifications.clear(notificationId);
  }
});

chrome.runtime.onInstalled.addListener(syncBadge);
chrome.runtime.onStartup.addListener(syncBadge);

// ポップアップからの操作
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target === 'offscreen') {
    return false;
  }
  const handlers = {
    'get-state': async () => ({ state: await getState() }),
    start: async () => {
      await start(message.mode);
      const state = await getState();
      const checkResult = await check(startMessage(state.mode));
      return { state, check: checkResult };
    },
    stop: async () => {
      await stop();
      return { state: await getState() };
    },
    'set-mode': async () => {
      await setMode(message.mode);
      return { state: await getState() };
    },
    check: async () => {
      const checkResult = await check('動作チェックです。この通知と音が届いていれば準備OKです。');
      return { state: await getState(), check: checkResult };
    },
  };
  const handler = handlers[message.type];
  if (!handler) {
    return false;
  }
  handler()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // 非同期で応答する
});
