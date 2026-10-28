# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#インストール">インストール</a> · <a href="#使い方">使い方</a> · <a href="#手紙を送る">手紙を送る</a> · <a href="#制限">制限</a> · <a href="./guide.md">詳しいガイド</a>
</p>

> multi-agent workflow でいちばん大切なのは、あなたの集中力と判断です。

Herdr で multi-agent workflow を回すと、1人の leader agent のもとで何人かの worker agent がそれぞれの仕事を進めます。その報告やメッセージが leader の会話に次々となだれ込みます。文章を打っている途中で報告が割り込み、そのまま一緒に送信されてしまう。さっき聞かれた判断の質問も、1秒後には次のメッセージに流されて見えなくなる。

このプラグインは、まさにそれを解決するためにあります。あなたの集中を途切れさせず、あなたにしかできない質の高い判断のために取っておきます。

Claude Code の選択式の質問（AskUserQuestion）を作り直したものではありません。Herdr の仕組みを使って、異なるベンダーの agent からの報告や未決の質問を一か所に集め、まとめて調整します。会話が埋め尽くされなくなるので、そのぶん消費する使用量も節約できます。

**導入前**

![メールボックスなし：worker の報告が書きかけの prompt に打ち込まれて一緒に送信され、その後も報告や質問のたびに leader が起こされて、会話が埋まっていく](./media/demo-before.gif)

Mailbox は leader にメールボックスを用意します。worker は、はがきのような一般メッセージのほかに、あなたが答えるための判断カードや相談カードも投函できます。一般メッセージは、あなたが入力しておらず leader も手が空いているときにだけ、まとめて届きます。カードはメールボックスに残り、マウスで答えるのを待ちます。

**導入後**

![メールボックスあり：入力中は報告がメールボックスで待ち、あとでまとめて届く。質問はマウスで答えて、一度にまとめて返送される](./media/demo.gif)

- **入力欄はずっとあなたのもの** — 入力中は何も打ち込まれず、leader が返答している間も届きません。
- **一般メッセージはまとめて届く** — 一般メッセージは最長1分待ち、1回のバッチにして leader を一度だけ起こします。**今すぐ送る** で待たずに送れます。
- **質問は一か所に** — 判断の質問は leader の隣にカードとして並びます。マウスで答えれば、すべての回答を一度に返送できます。
- **どの agent からでも書ける** — 送る側は `mailbox send` を実行するだけなので、Claude Code も Codex も agy も、シェルコマンドを実行できる agent なら同じメールボックスに書けます。
- **送るたびに受領通知** — 送信のたびに、その手紙の id と状態がすぐ返ります。
- **leader についていく** — pane を動かしても、Herdr を再起動しても、会話をクリアしても、メールボックスは同じ受け取り手に付いたままです。

## インストール

Herdr 0.9.3 以降と Node 18 以降が必要です。

```sh
# 1. プラグインをインストール
herdr plugin install navishachiku/herdr-mailbox

# 2. setup アクションを実行：`mailbox` コマンド、Claude Code の hooks、Codex と agy の許可ルール
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Herdr 自身の agent 連携。使っている agent ごとに入れる
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. agent に手紙の送り方を教える skill
npx skills add navishachiku/herdr-mailbox --global
```

非対話式でプラグインをインストールする場合は、手順 1 に `--yes` を付けます：`herdr plugin install navishachiku/herdr-mailbox --yes`。

Herdr の連携は各 pane の会話を識別し、メールボックスを受け取り手に紐づけられるようにします。agent の自動モードが手順 3 を拒否する場合は、該当するコマンドをターミナルで自分で実行してください。連携がなくても送信は動くことがありますが、メールボックスを受け取り手の会話に紐づけられない場合があります。

skill の仕組みがない agent は、`mailbox skill` から同じ説明を読めます。その出力を agent の指示ファイルに貼り付けてください。

setup アクションはファイルを変更する前に必ずバックアップを取り（`<file>.bak-<date>`）、もう一度実行しても重複して追加せず、`herdr plugin update` の後もそのまま動きます。`node <plugin dir>/src/setup.mjs uninstall` で元に戻せます。手紙を受け取る Claude Code の session は再起動してください。

Herdr の `config.toml`（`~/.config/herdr/config.toml`、Windows では `%APPDATA%\herdr\config.toml`）にショートカットを追加し、`prefix+shift+r` で再読み込みします（`prefix` は変更していなければ `ctrl+b`）。

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

setup アクションがお使いのマシンで動かない場合は、[AGENT-SETUP.md](../AGENT-SETUP.md) に coding agent が従える同じ手順があります。

## 使い方

メールボックスは leader のウィンドウで開きます。leader の pane にフォーカスして `prefix+shift+m` を押してください。メールボックスは押したときの pane の agent のものになるので、worker ではなく leader の pane で押します。メールボックス画面は leader の隣に開きます。画面の中でもう一度ショートカットを押すか `q` を押すと閉じ、手紙はそのまま残ります。

- **一般メッセージ** — worker からの一般メッセージがここで待ち、まとめて leader に届きます。**今すぐ送る** ですぐに送れます。
- **判断** — 判断カードと相談カード。選択肢をクリックするかメモを書き、**送信** を押すとすべての回答を一度に返します。**すべて推奨**、**すべて再説明**、**すべて取り消し** で複数のカードをまとめて処理できます。
- **設定** — 画面の幅、カードモード、一般メッセージをまとめるまでの待ち時間、画面の言語（13言語）。

画面を開いていないときに新しい判断の質問や相談の質問が届くと、その質問を含む Herdr の通知が出ます。画面を開いているあいだは通知は出ません。worker は下の `mailbox send` で leader に手紙を書きます。

**メールボックスの引き受け**：leader の会話が入れ替わると、メールボックスは切断されますが、手紙は残ります。新しい agent の pane で、画面に表示される `mailbox claim MB-xxxx` の行を実行すれば、メールボックスがまたつながります。

## 手紙を送る

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` には pane id、agent 名、メールボックス id を指定できます。`--recommend` は省略でき、付けないカードには推奨の選択肢が表示されません。

長めの内容はファイルにして手紙に添付できます（`--attach <file>`、1通につき5個まで）。カードにリンクが出て、クリックするとシステム既定のプログラムで開きます（画像は画像ビューア、テキストファイルは既定のアプリ）。質問の中のウェブアドレスは既定のブラウザで開きます。

`--wait [--timeout <ms>]` を付けると、leader が手紙を受け取ってそのターンを終えるまで戻りません。待ちきれずに諦めた場合は終了コード 3 か 4 で終わります。メールボックス宛ての手紙はどちらの場合もキューに入っているか届いているので、もう一度送らないでください。メールボックスのない pane 宛ての手紙は、署名を付けてすぐに1回だけ直接打ち込まれます。相談の質問、手紙の確認・編集・取り下げ、画面上の各ボタンの使い方は[詳しいガイド](./guide.md)にあります。

## 制限

- 質問は200文字、一般メッセージは500文字まで。それより長い内容はファイルにして `--attach` で添付してください。
- メールボックスを持つ agent（leader）は Claude Code か agy である必要があります。配信は入力欄が空になるのを待つためで、入力欄を読み取れるのはこの2つだけだからです。送る側はどの agent でも構いません。

## 既知の問題

- **Codex：まだメールボックスを持てません。** Codex 0.163 はすべての会話を1つの共有バックグラウンドサーバーで動かすため、Herdr の Codex 連携はどの会話もそのサーバーを起動した pane に報告し、Codex の pane 自体はメールボックスを紐づけるための会話 id を得られません。Codex から手紙を送ることはでき、メールボックスのない Codex の pane に送った一般メッセージは、署名を付けて1回だけ直接打ち込まれます。Codex の `HERDR_PANE_ID` は間違った pane を指すことがあるので、Codex から送るときは `--from <pane id>` で自分の pane を明示する必要があります。
- **agy：skill が agy の読む場所にインストールされません。** `skills` CLI は agy が skill を読み込むフォルダにインストールできないため、`npx skills add` は agy に届きません。これはその CLI の制限で、メールボックス側では回避していません。
- **agy：skill は見えていても、自分からはメールボックスを使いません。** 「agent-a に報告して」とだけ伝えると、agy は `mailbox send` ではなく内蔵のメッセージツールを使おうとします。依頼の中でコマンドを名指ししてください（「`mailbox send` で送って」）。

<details>
<summary>応用：仕組み、状態、テスト</summary>

### 仕組み

小さな常駐プロセス（daemon）が状態ファイルを管理し、リクエストを1件ずつ処理します。CLI はローカルソケットで daemon と話し、動いていなければ起動します。状態は Herdr のプラグイン状態ディレクトリの下（プラグインのコードディレクトリの外）に、スキーマバージョン付きで置かれ、受領通知を返す前にディスクへ書き込まれます。Herdr の session ごとに専用のサブディレクトリ、daemon、メールボックスがあるので、2つの session で同じ pane アドレスでも手紙が混ざることはありません。

| 部品 | 役割 |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | daemon と手紙のルール：受領通知、重複排除、編集と取り下げ、文字数制限。 |
| `src/identity.mjs` | メールボックスと受け取り手の紐づけ、定期的な突き合わせ、引き受け。 |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | バッチ配信、入力欄のチェック、到着確認、バッチの本文。 |
| `src/screen/` | メールボックス画面。設定は画面内に表示し、添付とリンクはシステム既定のプログラムに渡します。 |
| `src/open.mjs`, `src/on-focus.mjs` | `prefix+shift+m` の動作と、Herdr 再起動後の画面の再表示。 |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Claude Code の hooks。 |

### テスト

```sh
npm test
```

使い捨ての状態ディレクトリで、偽の `herdr` バイナリを相手に、本物の CLI と daemon を動かします。

</details>

## ライセンス

MIT
