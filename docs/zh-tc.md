# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#安裝">安裝</a> · <a href="#寄信">寄信</a> · <a href="#限制">限制</a> · <a href="./guide.md">完整說明</a>
</p>

> 你在打字，worker 在插話，leader 第三次被叫醒，剛剛那題到底跑去哪了？

你在 Herdr 跑 multi-agent workflow，一個 leader 帶著 Claude Code、Codex 幾個 worker 分頭做事。它們做完一件就往 leader 的對話裡丟：你一句話才打到一半，回報就插進來跟著送出去；剛剛問你的決策題，下一秒就被新訊息洗到不見。

**使用前**

![沒有信箱：worker 的回報被打進寫到一半的 prompt 一起送出，之後每則回報和問題都再叫醒 leader，對話被塞滿](./media/demo-before.gif)

Mailbox 給 leader 一個信箱。worker 除了寄一般訊息（像明信片），還能投遞決策卡和問答卡給你。一般訊息只在你沒在打字、leader 也有空的時候才成批送進去；卡片則留在信箱裡，等你用滑鼠作答。

**使用後**

![有信箱：你打字時回報在信箱裡等著，之後合成一批送達；問題用滑鼠作答，一次全部送回](./media/demo.gif)

- **輸入框始終是你的** — 你在打字時不會有任何東西被打進去，leader 還在回話時也不會送進去。
- **一般訊息一起到** — 一般訊息最多等一分鐘，好合成一批送進去、只叫醒 leader 一次；按 **Send now** 可以不等。
- **問題集中一處** — 決策題變成 leader 旁邊的卡片；用滑鼠作答，所有答案一次送回。
- **任何 agent 都能寄** — 寄件方只要執行 `mailbox send`，所以 Claude Code、Codex，以及任何能執行 shell 指令的 agent，都能寄到同一個信箱。
- **每封都有回條** — 每次寄出都立即回傳這封信的 id 與狀態。
- **跟著 leader 走** — 搬動 pane、重啟 Herdr 或清空對話，信箱都還跟著同一個收件者。

## 安裝

需要 Herdr 0.9.3 或更新版本，以及 Node 18 或更新版本。

```sh
herdr plugin install navishachiku/herdr-mailbox
```

剩下的設定（`mailbox` 指令、Claude Code 的 hooks、快捷鍵，有用 Codex 的話再加一條規則）交給你的 coding agent，指令、hooks 和 Codex 規則由它執行 `node <plugin dir>/src/setup.mjs install`，`uninstall` 可還原。把這句貼給它：

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

設好後按 `prefix+shift+r` 重新載入 Herdr，在 leader 的 pane 上按 `prefix+shift+m`，就會在旁邊開啟信箱畫面（`prefix` 預設是 `ctrl+b`）。agent 照做的步驟在 [AGENT-SETUP.md](../AGENT-SETUP.md)。

## 寄信

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

較長的內容可以用檔案附在信上（`--attach <file>`）；卡片上會出現連結，點下去就在信箱畫面裡直接打開。

![附上測試報告的決策卡：點連結，報告就在信箱畫面裡的框中打開](./media/attachment.png)

`--to` 可以填 pane id、agent 名稱或信箱 id。在 leader 的 pane 上按 `prefix+shift+m`，信箱畫面就會開在它旁邊。討論題、修改與撤回信件，以及信箱畫面上每個按鈕的用法，見[完整說明](./guide.md)。

## 限制

- 問題最多 200 字元、一般訊息最多 500 字元；更長的內容放進檔案，用 `--attach` 附上。
- 擁有信箱的 agent（leader）必須是 Claude Code，因為投遞要等它的輸入框清空；寄件方可以是任何 agent。

<details>
<summary>進階：運作方式、狀態、測試</summary>

### 運作方式

一個小型常駐程式掌管狀態檔，一次處理一個請求。CLI 透過本機 socket 跟它溝通，它沒在跑時由 CLI 啟動。狀態存在 Herdr 的外掛狀態目錄下（不在外掛程式碼目錄裡），帶有結構版本號，並在回傳回條之前寫進磁碟。每個 Herdr session 各有自己的子目錄、常駐程式與信箱，所以兩個 session 裡相同的 pane 位址不會共用信件。

| 元件 | 職責 |
| --- | --- |
| `src/daemon.mjs`、`src/core.mjs` | 常駐程式與信件規則：回條、去重、修改與撤回、長度限制。 |
| `src/identity.mjs` | 把信箱綁定到收件者、定期核對、認領信箱。 |
| `src/delivery.mjs`、`src/format.mjs`、`src/input-box.mjs` | 成批投遞、輸入框檢查、送達確認、批次內文。 |
| `src/screen/` | 信箱畫面，設定與附件也在畫面內顯示。 |
| `src/open.mjs`、`src/on-focus.mjs` | `prefix+shift+m` 的動作，以及 Herdr 重啟後重新開啟信箱畫面。 |
| `src/session-start.mjs`、`src/prompt-submit.mjs`、`src/send-guard.mjs` | Claude Code 的 hooks。 |

### 測試

```sh
npm test
```

在拋棄式狀態目錄裡，用假的 `herdr` 執行檔跑真正的 CLI 與常駐程式。

</details>

## 授權

MIT
