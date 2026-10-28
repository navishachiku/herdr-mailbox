# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#安装">安装</a> · <a href="#使用">使用</a> · <a href="#寄信">寄信</a> · <a href="#限制">限制</a> · <a href="./guide.md">完整说明</a>
</p>

> 在 multi-agent workflow 里，你的注意力和决策才是一切的关键

你在 Herdr 里跑 multi-agent workflow，一个 leader agent 带着好几个 worker agent 分头干活。它们的汇报和消息会疯狂轰炸 leader 的对话：你一句话才打到一半，汇报就插进来，跟着一起发出去；刚才问你的决策题，下一秒就被新消息冲得不见踪影。

这个插件就是为解决这个痛点而生的：让你的注意力不被打断，留给真正只有你能做的高质量决策。

它不是把 Claude Code 的选项提问（AskUserQuestion）再造一遍，而是借助 Herdr 的能力，把不同厂商 agent 的汇报和待决问题集中起来整合、协调；也因为对话不再被刷屏，省下了额外的用量消耗。

**使用前**

![没有信箱：worker 的汇报被打进写到一半的 prompt 一起发出，之后每条汇报和问题都再叫醒 leader，对话被塞满](./media/demo-before.gif)

Mailbox 给 leader 一个信箱。worker 除了寄一般消息（像明信片），还能投递决策卡和讨论卡给你。一般消息只在你没在打字、leader 也有空的时候才成批送进去；卡片则留在信箱里，等你用鼠标作答。

**使用后**

![有信箱：你打字时汇报在信箱里等着，之后合成一批送达；问题用鼠标作答，一次全部送回](./media/demo.gif)

- **输入框始终是你的** — 你在打字时不会有任何东西被打进去，leader 还在回话时也不会送进去。
- **一般消息一起到** — 一般消息最多等一分钟，好合成一批送进去、只叫醒 leader 一次；点 **立即投递** 可以不等。
- **问题集中一处** — 决策题变成 leader 旁边的卡片；用鼠标作答，所有答案一次送回。
- **任何 agent 都能寄** — 寄件方只要运行 `mailbox send`，所以 Claude Code、Codex、agy，以及任何能运行 shell 命令的 agent，都能寄到同一个信箱。
- **每封都有回执** — 每次寄出都会立刻返回这封信的 id 与状态。
- **跟着 leader 走** — 挪动 pane、重启 Herdr 或清空对话，信箱都还跟着同一个收件人。

## 安装

需要 Herdr 0.9.3 或更新版本，以及 Node 18 或更新版本。

```sh
# 1. 安装插件
herdr plugin install navishachiku/herdr-mailbox

# 2. 运行它的 setup 动作：`mailbox` 命令、Claude Code 的 hooks，以及 Codex 与 agy 的放行规则
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Herdr 自带的 agent 集成，用哪个 agent 就装哪个
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. 教 agent 寄信的 skill
npx skills add navishachiku/herdr-mailbox --global
```

非交互式安装插件时，在第 1 步加上 `--yes`：`herdr plugin install navishachiku/herdr-mailbox --yes`。

Herdr 的集成负责识别每个 pane 里的对话，信箱才能绑定到它的收件人。如果 agent 的自动模式拒绝执行第 3 步，请自己在终端里运行相关命令。没有这些集成时，寄信也许仍然可行，但信箱可能无法绑定到收件人的对话。

没有 skill 机制的 agent，可以从 `mailbox skill` 读到同一份说明；把它的输出贴进该 agent 的指令文件。

setup 动作改任何文件前都会先备份（`<file>.bak-<date>`），重复运行不会重复添加，`herdr plugin update` 之后也照常工作。`node <plugin dir>/src/setup.mjs uninstall` 可以还原。要收信的 Claude Code session 请重新启动。

把快捷键加进 Herdr 的 `config.toml`（`~/.config/herdr/config.toml`；Windows 是 `%APPDATA%\herdr\config.toml`），再按 `prefix+shift+r` 重新加载（`prefix` 默认是 `ctrl+b`）：

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

如果 setup 动作在你的机器上跑不起来，[AGENT-SETUP.md](../AGENT-SETUP.md) 有同样的步骤，可以交给 coding agent 照做。

## 使用

信箱要开在 leader 的窗口：先选中 leader 的 pane，再按 `prefix+shift+m`。信箱属于你按下快捷键时所在 pane 的 agent，所以要在 leader 的 pane 上按，而不是 worker 的。信箱画面会开在 leader 旁边；在画面里再按一次快捷键或按 `q` 就会关闭，信件都还在。

- **一般消息** — worker 寄来的一般消息在这里等着，成批送进 leader；点 **立即投递** 马上发送。
- **决策区** — 决策卡与讨论卡。点选项或写备注，再点 **确认送出**，所有答案一次送回。**全部按建议**、**全部再解释**、**全部作废** 可以一次处理多张卡。
- **设置** — 画面宽度、卡片模式、一般消息等多久合并，以及画面语言（13 种）。

信箱画面没开着时，新的决策题或讨论题进来会弹出一条带题目的 Herdr 通知；画面开着就不弹。worker 用下面的 `mailbox send` 寄信给 leader。

**信箱认领**：leader 的对话被替换后，信箱会断开，信件都还留着。在新 agent 的 pane 里运行画面上显示的那行 `mailbox claim MB-xxxx`，信箱就重新接上了。

## 寄信

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` 可以填 pane id、agent 名称或信箱 id。`--recommend` 可省略；没有它的卡片不标建议选项。

较长的内容可以用文件附在信上（`--attach <file>`，每封最多 5 个）；卡片上会出现链接，点一下用系统默认的程序打开（图片用看图程序、文本文件用默认的程序）。问题里的网址会用默认浏览器打开。

加 `--wait [--timeout <ms>]` 时，要等 leader 收下这封信、做完这一轮才返回。等不到时会以退出码 3 或 4 结束；寄给信箱的信无论哪种都已排队或已送达，不要再寄一次。寄给没有信箱的 pane 时，信会签名后立刻直接打进去一次。讨论题、查询、修改与撤回信件，以及信箱画面上每个按钮的用法，见[完整说明](./guide.md)。

## 限制

- 问题最多 200 个字符、一般消息最多 500 个字符；更长的内容放进文件，用 `--attach` 附上。
- 拥有信箱的 agent（leader）必须是 Claude Code 或 agy，因为投递要等它的输入框清空，而只有这两种的输入框读得到；寄件方可以是任何 agent。

## 已知问题

- **Codex：还不能拥有信箱。** Codex 0.163 的所有对话都跑在同一个共享的后台服务器里，所以 Herdr 的 Codex 集成会把每个对话都报告到启动那个服务器的 pane，Codex 自己的 pane 拿不到可以绑定信箱的对话 id。Codex 仍然可以寄信，寄给没有信箱的 Codex pane 的一般消息，会签名后直接打进去一次。Codex 的 `HERDR_PANE_ID` 可能指向错误的 pane，所以 Codex 寄信时必须用 `--from <pane id>` 指明自己的 pane。
- **agy：skill 没有装到 agy 读取的位置。** `skills` CLI 装不进 agy 加载 skill 的文件夹，所以 `npx skills add` 对 agy 无效。这是该 CLI 的限制，信箱不另外绕过。
- **agy：看得到 skill，但不会主动用信箱。** 只跟它说“汇报给 agent-a”时，agy 会改用它内置的消息工具，而不是 `mailbox send`。请在要求里直接点名命令（“用 `mailbox send` 寄”）。

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
