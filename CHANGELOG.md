# Changelog

このプロジェクトの主な変更点はこのファイルに記録します。

形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に基づき、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- 拡張機能の名前を「のびっと」に決定し、説明文を追加
- 15分タイマー（`chrome.alarms`）。「繰り返し（15分ごと）」と「1回だけ（15分後）」を選択可能
- 時間になったらチャイム音（Offscreen Document + Web Audio API）とChromeの通知でお知らせ
- ポップアップ画面：開始・停止、鳴り方の切り替え、残り時間の表示、「動作チェック」ボタン
- 開始時に、お試しの音と通知を出して「届きましたか？」の案内を表示
- Chrome側で通知が拒否されている場合の警告表示
- 音と通知を別々に実行し、片方が失敗してももう片方は届くように
- 通知の「停止」ボタン（繰り返し時）、動作中のツールバーバッジ「ON」
- ポップアップを開くショートカット（Alt+Shift+N）
- アイコン（16/32/48/128px）
- 仕様書 `docs/仕様書.md`
- permissions：`alarms`、`storage`、`notifications`、`offscreen`
