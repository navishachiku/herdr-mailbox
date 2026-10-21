# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#설치">설치</a> · <a href="#편지-보내기">편지 보내기</a> · <a href="#제한">제한</a> · <a href="./guide.md">전체 가이드</a>
</p>

> 타이핑하는 중에 worker가 끼어들고, leader는 세 번째로 깨어났는데, 방금 그 질문은 어디로 갔지?

Herdr에서 multi-agent workflow를 돌리면 leader 한 명 아래에서 Claude Code와 Codex worker 몇 명이 각자 일을 나눠 맡습니다. 하나를 끝낼 때마다 worker는 leader의 대화창에 결과를 던져 넣죠. 문장을 쓰다 말았는데 보고가 끼어들어 같이 전송되어 버리고, 방금 받은 결정 질문은 다음 메시지에 밀려 보이지 않게 됩니다.

**사용 전**

![우편함 없음: worker의 보고가 쓰다 만 prompt에 입력되어 함께 전송되고, 이후 보고와 질문마다 leader가 다시 깨어나 대화가 가득 참](./media/demo-before.gif)

Mailbox는 leader에게 우편함을 만들어 줍니다. worker는 엽서 같은 일반 메시지를 보낼 수 있고, 당신이 답할 결정 카드와 토론 카드도 넣을 수 있습니다. 일반 메시지는 당신이 입력 중이 아니고 leader도 한가할 때만 한 묶음으로 들어가고, 카드는 우편함에 남아 당신이 마우스로 답할 때까지 기다립니다.

**사용 후**

![우편함 있음: 입력하는 동안 보고는 우편함에서 기다렸다가 한 묶음으로 도착하고, 질문은 마우스로 답해 한 번에 돌려보냄](./media/demo.gif)

- **입력창은 늘 당신의 것** — 타이핑하는 동안에는 아무것도 입력되지 않고, leader가 답하는 중에도 들어오지 않습니다.
- **일반 메시지는 함께 도착** — 일반 메시지는 최대 1분 기다렸다가 한 묶음으로 들어가 leader를 한 번만 깨웁니다. **Send now**를 누르면 기다리지 않습니다.
- **질문은 한곳에서** — 결정 질문은 leader 옆의 카드가 됩니다. 마우스로 답하면 모든 답이 한 번에 돌아갑니다.
- **어떤 agent든 보낼 수 있음** — 보내는 쪽은 `mailbox send`만 실행하면 되므로 Claude Code, Codex, 셸 명령을 실행할 수 있는 모든 agent가 같은 우편함에 쓸 수 있습니다.
- **모든 편지에 수신 확인** — 보낼 때마다 편지의 id와 상태가 바로 돌아옵니다.
- **leader를 따라감** — pane을 옮기거나 Herdr를 다시 시작하거나 대화를 비워도 우편함은 같은 수신자에게 그대로 붙어 있습니다.

## 설치

Herdr 0.9.3 이상과 Node 18 이상이 필요합니다.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

나머지 설정(`mailbox` 명령, Claude Code hooks, 단축키, Codex를 쓴다면 규칙 하나)은 coding agent에게 맡기세요. 아래 문장을 붙여 넣으면 됩니다:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

끝나면 `prefix+shift+r`로 Herdr를 다시 불러오고, leader의 pane에서 `prefix+shift+m`을 누르면 옆에 메일함 화면이 열립니다(`prefix`의 기본값은 `ctrl+b`). agent가 따르는 단계는 [AGENT-SETUP.md](../AGENT-SETUP.md)에 있습니다.

## 편지 보내기

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

긴 내용은 파일로 편지에 첨부할 수 있습니다(`--attach <file>`). 카드에 링크가 나타나고, 누르면 우편함 화면 안에서 바로 열립니다.

![테스트 보고서가 첨부된 결정 카드: 링크를 누르면 우편함 화면 안의 상자에서 보고서가 열림](./media/attachment.png)

`--to`에는 pane id, agent 이름, 우편함 id를 쓸 수 있습니다. leader의 pane에서 `prefix+shift+m`을 누르면 그 옆에 우편함 화면이 열립니다. 토론 질문, 편지 수정과 철회, 화면의 각 버튼 사용법은 [전체 가이드](./guide.md)에 있습니다.

## 제한

- 질문은 최대 200자, 일반 메시지는 최대 500자입니다. 더 긴 내용은 파일에 담아 `--attach`로 첨부하세요.
- 우편함을 가진 agent(leader)는 Claude Code여야 합니다. 전달이 입력창이 빌 때까지 기다리기 때문입니다. 보내는 쪽은 어떤 agent든 괜찮습니다.

<details>
<summary>고급: 동작 방식, 상태, 테스트</summary>

### 동작 방식

작은 데몬이 상태 파일을 맡아 요청을 한 번에 하나씩 처리합니다. CLI는 로컬 소켓으로 데몬과 통신하고, 데몬이 실행 중이 아니면 CLI가 띄웁니다. 상태는 Herdr의 플러그인 상태 디렉터리 아래(플러그인 코드 디렉터리 밖)에 스키마 버전과 함께 저장되며, 수신 확인을 돌려주기 전에 디스크에 기록됩니다. Herdr session마다 자기만의 하위 디렉터리, 데몬, 우편함이 있어서 두 session에 같은 pane 주소가 있어도 편지가 섞이지 않습니다.

| 구성 요소 | 역할 |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | 데몬과 편지 규칙: 수신 확인, 중복 제거, 수정과 철회, 길이 제한. |
| `src/identity.mjs` | 우편함을 수신자에 연결, 주기적 대조, 우편함 인수. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | 묶음 전달, 입력창 확인, 도착 확인, 묶음 본문. |
| `src/screen/` | 우편함 화면. 설정과 첨부도 화면 안에 표시됩니다. |
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
