# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#インストール">インストール</a> · <a href="#手紙を送る">手紙を送る</a> · <a href="#制限">制限</a> · <a href="./guide.md">詳しいガイド</a>
</p>

> 入力している最中に worker が割り込んできて、leader は3回目の起こされ方をして、さっきの質問はいったいどこへ行った？

Herdr で multi-agent workflow を回していると、1人の leader のもとで Claude Code や Codex の worker が何人か、それぞれの仕事を進めます。1つ終わるたびに、worker は leader の会話へ報告を放り込みます。文章を打っている途中で報告が割り込み、そのまま一緒に送信されてしまう。さっき聞かれた判断の質問も、次のメッセージに流されて見えなくなる。

**導入前**

![メールボックスなし：worker の報告が書きかけの prompt に打ち込まれて一緒に送信され、その後も報告や質問のたびに leader が起こされて、会話が埋まっていく](./media/demo-before.gif)

Mailbox は leader にメールボックスを用意します。worker は、はがきのような一般メッセージのほかに、あなたが答えるための判断カードや相談カードも投函できます。一般メッセージは、あなたが入力しておらず leader も手が空いているときにだけ、まとめて届きます。カードはメールボックスに残り、マウスで答えるのを待ちます。

**導入後**

![メールボックスあり：入力中は報告がメールボックスで待ち、あとでまとめて届く。質問はマウスで答えて、一度にまとめて返送される](./media/demo.gif)

- **入力欄はずっとあなたのもの** — 入力中は何も打ち込まれず、leader が返答している間も届きません。
- **一般メッセージはまとめて届く** — 一般メッセージは最長1分待ち、1回のバッチにして leader を一度だけ起こします。**Send now** で待たずに送れます。
- **質問は一か所に** — 判断の質問は leader の隣にカードとして並びます。マウスで答えれば、すべての回答を一度に返送できます。
- **どの agent からでも書ける** — 送る側は `mailbox send` を実行するだけなので、Claude Code も Codex も、シェルコマンドを実行できる agent なら同じメールボックスに書けます。
- **送るたびに受領通知** — 送信のたびに、その手紙の id と状態がすぐ返ります。
- **leader についていく** — pane を動かしても、Herdr を再起動しても、会話をクリアしても、メールボックスは同じ受け取り手に付いたままです。

## インストール

Herdr 0.9.3 以降と Node 18 以降が必要です。

```sh
herdr plugin install navishachiku/herdr-mailbox
```

残りの設定（`mailbox` コマンド、Claude Code の hooks、ショートカット、Codex を使うならそのルール）は coding agent に任せましょう。コマンド・hooks・Codex のルールについては `node <plugin dir>/src/setup.mjs install` を実行し、`uninstall` で元に戻せます。次の一文を貼り付けてください：

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

終わったら `prefix+shift+r` で Herdr を再読み込みし、leader の pane で `prefix+shift+m` を押すと横にメールボックス画面が開きます（`prefix` は既定で `ctrl+b`）。agent が従う手順は [AGENT-SETUP.md](../AGENT-SETUP.md) にあります。

## 手紙を送る

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

長めの内容はファイルにして手紙に添付できます（`--attach <file>`）。カードにリンクが出て、クリックするとメールボックス画面の中でそのまま開きます。

![テストレポートを添付した判断カード：リンクをクリックすると、メールボックス画面内のボックスでレポートが開く](./media/attachment.png)

`--to` には pane id、agent 名、メールボックス id を指定できます。leader の pane で `prefix+shift+m` を押すと、その隣にメールボックス画面が開きます。相談の質問、手紙の編集と取り下げ、画面上の各ボタンの使い方は[詳しいガイド](./guide.md)にあります。

## 制限

- 質問は200文字、一般メッセージは500文字まで。それより長い内容はファイルにして `--attach` で添付してください。
- メールボックスを持つ agent（leader）は Claude Code である必要があります。配信は入力欄が空になるのを待つためです。送る側はどの agent でも構いません。

<details>
<summary>応用：仕組み、状態、テスト</summary>

### 仕組み

小さな常駐プロセス（daemon）が状態ファイルを管理し、リクエストを1件ずつ処理します。CLI はローカルソケットで daemon と話し、動いていなければ起動します。状態は Herdr のプラグイン状態ディレクトリの下（プラグインのコードディレクトリの外）に、スキーマバージョン付きで置かれ、受領通知を返す前にディスクへ書き込まれます。Herdr の session ごとに専用のサブディレクトリ、daemon、メールボックスがあるので、2つの session で同じ pane アドレスでも手紙が混ざることはありません。

| 部品 | 役割 |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | daemon と手紙のルール：受領通知、重複排除、編集と取り下げ、文字数制限。 |
| `src/identity.mjs` | メールボックスと受け取り手の紐づけ、定期的な突き合わせ、引き受け。 |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | バッチ配信、入力欄のチェック、到着確認、バッチの本文。 |
| `src/screen/` | メールボックス画面。設定と添付も画面内に表示します。 |
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
