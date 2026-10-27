# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#설치">설치</a> · <a href="#사용법">사용법</a> · <a href="#편지-보내기">편지 보내기</a> · <a href="#제한">제한</a> · <a href="./guide.md">전체 가이드</a>
</p>

> multi-agent workflow에서 가장 중요한 것은 당신의 집중력과 결정입니다.

Herdr에서 multi-agent workflow를 돌리면 leader agent 하나 아래에서 여러 worker agent가 각자 일을 나눠 맡습니다. 이들의 보고와 메시지가 leader의 대화창으로 쏟아져 들어옵니다. 문장을 쓰다 말았는데 보고가 끼어들어 같이 전송되어 버리고, 방금 받은 결정 질문은 1초 뒤 다음 메시지에 밀려 보이지 않게 됩니다.

이 플러그인은 바로 이 문제를 해결하기 위해 만들어졌습니다. 당신의 집중이 끊기지 않게 지켜, 당신만 내릴 수 있는 질 높은 결정에 쓰도록 합니다.

Claude Code의 선택지 질문(AskUserQuestion)을 다시 만든 것이 아닙니다. Herdr가 제공하는 기능을 이용해 서로 다른 벤더의 agent가 보낸 보고와 미결 질문을 한곳에 모아 합치고 조율합니다. 대화가 더 이상 메시지로 넘쳐나지 않으니, 그만큼 들던 사용량도 아낄 수 있습니다.

**사용 전**

![우편함 없음: worker의 보고가 쓰다 만 prompt에 입력되어 함께 전송되고, 이후 보고와 질문마다 leader가 다시 깨어나 대화가 가득 참](./media/demo-before.gif)

Mailbox는 leader에게 우편함을 만들어 줍니다. worker는 엽서 같은 일반 메시지를 보낼 수 있고, 당신이 답할 결정 카드와 토론 카드도 넣을 수 있습니다. 일반 메시지는 당신이 입력 중이 아니고 leader도 한가할 때만 한 묶음으로 들어가고, 카드는 우편함에 남아 당신이 마우스로 답할 때까지 기다립니다.

**사용 후**

![우편함 있음: 입력하는 동안 보고는 우편함에서 기다렸다가 한 묶음으로 도착하고, 질문은 마우스로 답해 한 번에 돌려보냄](./media/demo.gif)

- **입력창은 늘 당신의 것** — 타이핑하는 동안에는 아무것도 입력되지 않고, leader가 답하는 중에도 들어오지 않습니다.
- **일반 메시지는 함께 도착** — 일반 메시지는 최대 1분 기다렸다가 한 묶음으로 들어가 leader를 한 번만 깨웁니다. **지금 전달**을 누르면 기다리지 않습니다.
- **질문은 한곳에서** — 결정 질문은 leader 옆의 카드가 됩니다. 마우스로 답하면 모든 답이 한 번에 돌아갑니다.
- **어떤 agent든 보낼 수 있음** — 보내는 쪽은 `mailbox send`만 실행하면 되므로 Claude Code, Codex, agy, 셸 명령을 실행할 수 있는 모든 agent가 같은 우편함에 쓸 수 있습니다.
- **모든 편지에 수신 확인** — 보낼 때마다 편지의 id와 상태가 바로 돌아옵니다.
- **leader를 따라감** — pane을 옮기거나 Herdr를 다시 시작하거나 대화를 비워도 우편함은 같은 수신자에게 그대로 붙어 있습니다.

## 설치

Herdr 0.9.3 이상과 Node 18 이상이 필요합니다.

```sh
# 1. 플러그인 설치
herdr plugin install navishachiku/herdr-mailbox

# 2. setup 동작 실행: `mailbox` 명령, Claude Code hooks, Codex와 agy 허용 규칙
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Herdr 자체의 agent 연동, 사용하는 agent마다 설치
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. agent에게 편지 보내는 법을 알려 주는 skill
npx skills add navishachiku/herdr-mailbox
```

skill 시스템이 없는 agent는 `mailbox skill`에서 같은 안내를 읽을 수 있습니다. 그 출력을 해당 agent의 지시 파일에 붙여 넣으세요.

setup 동작은 파일을 바꾸기 전에 항상 백업하고(`<file>.bak-<date>`), 다시 실행해도 중복으로 추가하지 않으며, `herdr plugin update` 후에도 그대로 동작합니다. `node <plugin dir>/src/setup.mjs uninstall`로 되돌릴 수 있습니다. 편지를 받을 Claude Code session은 다시 시작하세요.

Herdr의 `config.toml`(`~/.config/herdr/config.toml`, Windows에서는 `%APPDATA%\herdr\config.toml`)에 단축키를 추가한 뒤 `prefix+shift+r`로 다시 불러옵니다(`prefix`는 바꾸지 않았다면 `ctrl+b`):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

setup 동작이 당신의 컴퓨터에서 작동하지 않으면 [AGENT-SETUP.md](../AGENT-SETUP.md)에 coding agent가 따라 할 수 있는 같은 단계가 있습니다.

## 사용법

우편함은 leader의 창에서 엽니다. leader의 pane에 포커스를 두고 `prefix+shift+m`을 누르세요. 우편함은 단축키를 누른 pane의 agent에게 속하므로 worker가 아니라 leader의 pane에서 눌러야 합니다. 우편함 화면은 leader 옆에 열리고, 화면 안에서 단축키를 다시 누르거나 `q`를 누르면 닫힙니다. 편지는 그대로 남습니다.

- **일반 메시지** — worker가 보낸 일반 메시지가 여기서 기다렸다가 한 묶음으로 leader에게 들어갑니다. **지금 전달**을 누르면 바로 보냅니다.
- **결정** — 결정 카드와 토론 카드. 선택지를 클릭하거나 메모를 쓴 뒤 **보내기**를 누르면 모든 답이 한 번에 돌아갑니다. **모두 추천**, **모두 설명 요청**, **모두 무효**로 여러 카드를 한꺼번에 처리할 수 있습니다.
- **설정** — 화면 너비, 카드 모드, 일반 메시지를 합치기까지 기다리는 시간, 화면 언어(13개 언어).

화면이 열려 있지 않을 때 새 결정 질문이나 토론 질문이 도착하면 그 질문이 담긴 Herdr 알림이 뜹니다. 화면이 열려 있는 동안에는 알림이 뜨지 않습니다. worker는 아래의 `mailbox send`로 leader에게 편지를 씁니다.

**우편함 인수**: leader의 대화가 바뀌면 우편함은 연결이 끊기지만 편지는 남아 있습니다. 새 agent의 pane에서 화면에 표시된 `mailbox claim MB-xxxx` 줄을 실행하면 우편함이 다시 연결됩니다.

## 편지 보내기

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to`에는 pane id, agent 이름, 우편함 id를 쓸 수 있습니다. `--recommend`는 생략할 수 있으며, 이것이 없는 카드에는 추천 선택지가 표시되지 않습니다.

긴 내용은 파일로 편지에 첨부할 수 있습니다(`--attach <file>`, 편지당 최대 5개). 카드에 링크가 나타나고, 누르면 시스템 기본 프로그램으로 열립니다(이미지는 이미지 뷰어, 텍스트 파일은 기본 앱). 질문 속 웹 주소는 기본 브라우저로 열립니다.

`--wait [--timeout <ms>]`를 붙이면 leader가 편지를 받아 그 턴을 끝낸 뒤에야 반환됩니다. 기다리다 포기하면 종료 코드 3 또는 4로 끝납니다. 우편함으로 보낸 편지는 어느 경우든 이미 대기열에 있거나 전달된 상태이니 다시 보내지 마세요. 우편함이 없는 pane으로 보낸 편지는 서명을 붙여 즉시 한 번 직접 입력됩니다. 토론 질문, 편지 확인·수정·철회, 화면의 각 버튼 사용법은 [전체 가이드](./guide.md)에 있습니다.

## 제한

- 질문은 최대 200자, 일반 메시지는 최대 500자입니다. 더 긴 내용은 파일에 담아 `--attach`로 첨부하세요.
- 우편함을 가진 agent(leader)는 Claude Code나 agy여야 합니다. 전달이 입력창이 빌 때까지 기다리는데, 입력창을 읽을 수 있는 것은 이 둘뿐이기 때문입니다. 보내는 쪽은 어떤 agent든 괜찮습니다.

## 알려진 문제

- **Codex: 아직 우편함을 가질 수 없습니다.** Codex 0.163은 모든 대화를 하나의 공유 백그라운드 서버에서 실행하므로, Herdr의 Codex 연동은 모든 대화를 그 서버를 시작한 pane으로 보고하고, Codex pane 자체는 우편함을 연결할 대화 id를 얻지 못합니다. Codex도 편지를 보낼 수는 있으며, 우편함이 없는 Codex pane으로 보낸 일반 메시지는 서명을 붙여 한 번 직접 입력됩니다. Codex의 `HERDR_PANE_ID`는 잘못된 pane을 가리킬 수 있으므로, Codex가 보낼 때는 `--from <pane id>`로 자기 pane을 지정해야 합니다.
- **agy: skill이 agy가 읽는 위치에 설치되지 않습니다.** `skills` CLI는 agy가 skill을 불러오는 폴더에 설치할 수 없어서 `npx skills add`가 agy에 닿지 않습니다. 이는 해당 CLI의 한계이며, 우편함은 이를 우회하지 않습니다.
- **agy: skill은 보이지만 스스로 우편함을 쓰지는 않습니다.** "agent-a에게 보고해"라고만 하면 agy는 `mailbox send` 대신 내장 메시지 도구를 쓰려 합니다. 요청에서 명령을 직접 지정하세요("`mailbox send`로 보내").

<details>
<summary>고급: 동작 방식, 상태, 테스트</summary>

### 동작 방식

작은 데몬이 상태 파일을 맡아 요청을 한 번에 하나씩 처리합니다. CLI는 로컬 소켓으로 데몬과 통신하고, 데몬이 실행 중이 아니면 CLI가 띄웁니다. 상태는 Herdr의 플러그인 상태 디렉터리 아래(플러그인 코드 디렉터리 밖)에 스키마 버전과 함께 저장되며, 수신 확인을 돌려주기 전에 디스크에 기록됩니다. Herdr session마다 자기만의 하위 디렉터리, 데몬, 우편함이 있어서 두 session에 같은 pane 주소가 있어도 편지가 섞이지 않습니다.

| 구성 요소 | 역할 |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | 데몬과 편지 규칙: 수신 확인, 중복 제거, 수정과 철회, 길이 제한. |
| `src/identity.mjs` | 우편함을 수신자에 연결, 주기적 대조, 우편함 인수. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | 묶음 전달, 입력창 확인, 도착 확인, 묶음 본문. |
| `src/screen/` | 우편함 화면. 설정은 화면 안에 표시하고, 첨부와 링크는 시스템 기본 프로그램으로 넘깁니다. |
| `src/open.mjs`, `src/on-focus.mjs` | `prefix+shift+m` 동작, Herdr 재시작 후 화면 다시 열기. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Claude Code hooks. |

### 테스트

```sh
npm test
```

일회용 상태 디렉터리에서 가짜 `herdr` 바이너리를 상대로 진짜 CLI와 데몬을 실행합니다.

</details>

## 라이선스

MIT
