// のびっと：音の再生用ページ（Offscreen Document）
// Service Worker は音を出せないため、このページで Web Audio API を使ってチャイム音を合成します。
// 音声ファイルや外部リソースは使いません。

// 「ピン・ポーン」を2回（音の高さ[Hz]と開始タイミング[秒]）
const NOTES = [
  { frequency: 880.0, at: 0.0 },
  { frequency: 659.25, at: 0.45 },
  { frequency: 880.0, at: 1.1 },
  { frequency: 659.25, at: 1.55 },
];
const NOTE_LENGTH = 1.2; // 1音の長さ（秒）
const VOLUME = 0.35;

async function playChime() {
  const context = new AudioContext();
  await context.resume();
  const now = context.currentTime;

  for (const { frequency, at } of NOTES) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startTime = now + at;

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    // 鐘のように、すっと立ち上がってゆっくり消える
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(VOLUME, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + NOTE_LENGTH);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + NOTE_LENGTH + 0.05);
  }

  const lastNote = NOTES[NOTES.length - 1];
  const totalMs = (lastNote.at + NOTE_LENGTH + 0.2) * 1000;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
  await context.close();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen' || message.type !== 'play-chime') {
    return false;
  }
  playChime()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
