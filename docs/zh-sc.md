# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#安装">安装</a> · <a href="#寄信">寄信</a> · <a href="#限制">限制</a> · <a href="./guide.md">完整说明</a>
</p>

> 你在打字，worker 在插话，leader 第三次被叫醒，刚才那个问题到底跑哪去了？

你在 Herdr 里跑 multi-agent workflow，一个 leader 带着 Claude Code、Codex 几个 worker 分头干活。它们做完一件就往 leader 的对话里丢：你一句话才打到一半，汇报就插进来，跟着一起发出去；刚才问你的决策题，下一秒就被新消息冲得不见踪影。

**使用前**

![没有信箱：worker 的汇报被打进写到一半的 prompt 一起发出，之后每条汇报和问题都再叫醒 leader，对话被塞满](./media/demo-before.gif)

Mailbox 给 leader 一个信箱。worker 除了寄一般消息（像明信片），还能投递决策卡和讨论卡给你。一般消息只在你没在打字、leader 也有空的时候才成批送进去；卡片则留在信箱里，等你用鼠标作答。

**使用后**

![有信箱：你打字时汇报在信箱里等着，之后合成一批送达；问题用鼠标作答，一次全部送回](./media/demo.gif)

- **输入框始终是你的** — 你在打字时不会有任何东西被打进去，leader 还在回话时也不会送进去。
- **一般消息一起到** — 一般消息最多等一分钟，好合成一批送进去、只叫醒 leader 一次；点 **立即投递** 可以不等。
- **问题集中一处** — 决策题变成 leader 旁边的卡片；用鼠标作答，所有答案一次送回。
- **任何 agent 都能寄** — 寄件方只要运行 `mailbox send`，所以 Claude Code、Codex，以及任何能运行 shell 命令的 agent，都能寄到同一个信箱。
- **每封都有回执** — 每次寄出都会立刻返回这封信的 id 与状态。
- **跟着 leader 走** — 挪动 pane、重启 Herdr 或清空对话，信箱都还跟着同一个收件人。

## 安装

需要 Herdr 0.9.3 或更新版本，以及 Node 18 或更新版本。

```sh
herdr plugin install navishachiku/herdr-mailbox
```

剩下的设置（`mailbox` 命令、Claude Code 的 hooks、快捷键，用 Codex 的话再加一条规则）交给你的 coding agent，命令、hooks 和 Codex 规则由它执行 `node <plugin dir>/src/setup.mjs install`，`uninstall` 可还原。把这句贴给它：

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

设置好后按 `prefix+shift+r` 重新加载 Herdr，在 leader 的 pane 上按 `prefix+shift+m`，就会在旁边打开信箱画面（`prefix` 默认是 `ctrl+b`）。agent 照做的步骤在 [AGENT-SETUP.md](../AGENT-SETUP.md)。

## 寄信

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

较长的内容可以用文件附在信上（`--attach <file>`）；卡片上会出现链接，点一下用系统默认的程序打开（图片用看图程序、文本文件用默认的程序）。问题里的网址会用默认浏览器打开。

`--to` 可以填 pane id、agent 名称或信箱 id。在 leader 的 pane 上按 `prefix+shift+m`，信箱画面就会开在它旁边。讨论题、修改与撤回信件，以及信箱画面上每个按钮的用法，见[完整说明](./guide.md)。

## 限制

- 问题最多 200 个字符、一般消息最多 500 个字符；更长的内容放进文件，用 `--attach` 附上。
- 拥有信箱的 agent（leader）必须是 Claude Code，因为投递要等它的输入框清空；寄件方可以是任何 agent。

<details>
<summary>进阶：运作方式、状态、测试</summary>

### 运作方式

一个小型常驻进程掌管状态文件，一次处理一个请求。CLI 通过本机 socket 跟它通信，它没在运行时由 CLI 启动。状态存放在 Herdr 的插件状态目录下（不在插件代码目录里），带有结构版本号，并在返回回执之前写入磁盘。每个 Herdr session 各有自己的子目录、常驻进程和信箱，所以两个 session 里相同的 pane 地址不会共用信件。

| 组成 | 职责 |
| --- | --- |
| `src/daemon.mjs`、`src/core.mjs` | 常驻进程与信件规则：回执、去重、修改与撤回、长度限制。 |
| `src/identity.mjs` | 把信箱绑定到收件人、定期核对、认领信箱。 |
| `src/delivery.mjs`、`src/format.mjs`、`src/input-box.mjs` | 成批投递、输入框检查、送达确认、批次正文。 |
| `src/screen/` | 信箱画面，设置在画面内显示；附件与链接交给系统默认的程序。 |
| `src/open.mjs`、`src/on-focus.mjs` | `prefix+shift+m` 的动作，以及 Herdr 重启后重新打开信箱画面。 |
| `src/session-start.mjs`、`src/prompt-submit.mjs`、`src/send-guard.mjs` | Claude Code 的 hooks。 |

### 测试

```sh
npm test
```

在一次性的状态目录里，用假的 `herdr` 可执行文件跑真正的 CLI 与常驻进程。

</details>

## 授权

MIT
