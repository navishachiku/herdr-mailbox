# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#cài-đặt">cài đặt</a> · <a href="#cách-dùng">cách dùng</a> · <a href="#gửi-thư">gửi thư</a> · <a href="#giới-hạn">giới hạn</a> · <a href="./guide.md">hướng dẫn đầy đủ</a>
</p>

> Trong một multi-agent workflow, sự tập trung và các quyết định của bạn mới là điều quan trọng nhất.

Bạn chạy một multi-agent workflow trong Herdr: một agent leader cùng vài agent worker, mỗi con một việc. Báo cáo và tin nhắn của chúng tràn ngập cuộc trò chuyện của leader. Bạn mới gõ nửa câu thì một báo cáo chen vào và bị gửi đi cùng; câu hỏi cần bạn quyết định vừa hiện ra, một giây sau đã bị tin nhắn kế tiếp cuốn trôi.

Plugin này ra đời chính là để giải quyết chuyện đó: sự tập trung của bạn không bị cắt ngang, được dành trọn cho những quyết định chất lượng mà chỉ bạn mới đưa ra được.

Nó không phải là bản làm lại câu hỏi lựa chọn của Claude Code (AskUserQuestion). Nó tận dụng những gì Herdr cung cấp để gom báo cáo và các câu hỏi còn bỏ ngỏ của agent từ nhiều hãng khác nhau về một chỗ, gộp lại và điều phối chúng; và vì cuộc trò chuyện không còn bị tràn ngập, nó cũng tiết kiệm được lượng sử dụng mà những đợt tràn ngập đó tiêu tốn.

**Trước khi dùng**

![Không có hộp thư: báo cáo của worker bị gõ vào prompt đang viết dở rồi gửi đi cùng, sau đó mỗi báo cáo và câu hỏi lại đánh thức leader, cuộc trò chuyện đầy ắp](./media/demo-before.gif)

Mailbox cho leader một hộp thư. Ngoài tin nhắn thường (như tấm bưu thiếp), worker còn có thể gửi thẻ quyết định và thẻ thảo luận để bạn trả lời. Tin nhắn thường chỉ được đưa vào thành một lô khi bạn không đang gõ và leader đang rảnh; còn thẻ thì nằm yên trong hộp thư, chờ bạn trả lời bằng chuột.

**Sau khi dùng**

![Có hộp thư: báo cáo chờ trong hộp thư lúc bạn đang gõ, rồi đến cùng một lô; câu hỏi được trả lời bằng chuột và gửi lại một lượt](./media/demo.gif)

- **Ô nhập liệu luôn là của bạn** — không có gì bị gõ vào khi bạn đang gõ, và không có gì được đưa vào khi leader còn đang trả lời.
- **Tin nhắn thường đến cùng lúc** — tin nhắn thường chờ tối đa một phút để vào thành một lô và chỉ đánh thức leader một lần; bấm **Gửi ngay** nếu không muốn chờ.
- **Câu hỏi gom về một chỗ** — câu hỏi quyết định biến thành thẻ ngay cạnh leader; trả lời bằng chuột rồi gửi toàn bộ câu trả lời một lượt.
- **Agent nào cũng gửi được** — bên gửi chỉ cần chạy `mailbox send`, nên Claude Code, Codex, agy và bất kỳ agent nào chạy được lệnh shell đều gửi được vào cùng một hộp thư.
- **Mỗi lần gửi đều có biên nhận** — mỗi lần gửi trả về ngay id và trạng thái của lá thư.
- **Đi theo leader** — di chuyển pane, khởi động lại Herdr hay xoá cuộc trò chuyện thì hộp thư vẫn thuộc về cùng một người nhận.

## Cài đặt

Cần Herdr 0.9.3 trở lên và Node 18 trở lên.

```sh
# 1. Cài plugin
herdr plugin install navishachiku/herdr-mailbox

# 2. Chạy thao tác setup của nó: lệnh `mailbox`, hooks của Claude Code, và quy tắc cho phép của Codex và agy
herdr plugin action invoke setup --plugin herdr-mailbox

# 3. Các tích hợp agent của chính Herdr, dùng agent nào thì cài cái đó
herdr integration install claude
herdr integration install codex
herdr integration install antigravity-cli

# 4. Skill dạy agent cách gửi thư
npx skills add navishachiku/herdr-mailbox --global
```

Với bản cài không tương tác, thêm `--yes` vào bước 1: `herdr plugin install navishachiku/herdr-mailbox --yes`.

Các tích hợp của Herdr nhận diện cuộc trò chuyện trong từng pane để hộp thư gắn được với người nhận. Nếu chế độ tự động của một agent từ chối bước 3, hãy tự chạy các lệnh tương ứng trong terminal. Không có tích hợp, việc gửi vẫn có thể hoạt động, nhưng hộp thư có thể không gắn được với cuộc trò chuyện của người nhận.

Agent không có hệ thống skill có thể đọc cùng hướng dẫn đó từ `mailbox skill`; dán đầu ra của nó vào tệp chỉ dẫn của agent.

Thao tác setup sao lưu mọi tệp trước khi sửa (`<file>.bak-<date>`), chạy lại cũng không thêm trùng, và vẫn hoạt động sau `herdr plugin update`. `node <plugin dir>/src/setup.mjs uninstall` sẽ hoàn tác. Hãy khởi động lại các session Claude Code cần nhận thư.

Thêm phím tắt vào `config.toml` của Herdr (`~/.config/herdr/config.toml`; trên Windows là `%APPDATA%\herdr\config.toml`), rồi bấm `prefix+shift+r` để tải lại (`prefix` mặc định là `ctrl+b`):

```toml
[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "herdr-mailbox.open"
description = "open the mailbox"

[ui.toast]
delivery = "herdr"
```

Nếu thao tác setup không chạy được trên máy bạn, [AGENT-SETUP.md](../AGENT-SETUP.md) có các bước tương tự để giao cho coding agent làm theo.

## Cách dùng

Mở hộp thư trong cửa sổ của leader: chọn pane của leader rồi bấm `prefix+shift+m`. Hộp thư thuộc về agent của pane nơi bạn bấm phím tắt, nên hãy bấm trên pane của leader, không phải của worker. Màn hình hộp thư mở ra ngay cạnh leader; bấm lại phím tắt ngay trong màn hình, hoặc bấm `q`, sẽ đóng nó, còn thư thì vẫn giữ nguyên.

- **Tin nhắn** — tin nhắn thường từ worker chờ ở đây và được đưa vào leader thành một lô; **Gửi ngay** gửi chúng đi ngay.
- **Câu hỏi** — thẻ quyết định và thẻ thảo luận. Bấm chọn một phương án hoặc viết ghi chú, rồi **Gửi** gửi lại toàn bộ câu trả lời một lượt. **Đồng ý tất cả**, **Hỏi lại tất cả** và **Huỷ tất cả** xử lý nhiều thẻ cùng lúc.
- **Tuỳ chọn** — độ rộng màn hình, chế độ thẻ, thời gian tin nhắn thường chờ để gộp, và ngôn ngữ màn hình (13 ngôn ngữ).

Khi màn hình chưa mở, một câu hỏi quyết định hoặc câu hỏi thảo luận mới sẽ hiện thông báo của Herdr kèm câu hỏi; khi màn hình đang mở thì không có thông báo. Worker gửi thư cho leader bằng `mailbox send`, xem bên dưới.

**Nhận lại hộp thư**: khi cuộc trò chuyện của leader bị thay thế, hộp thư mất kết nối nhưng thư vẫn còn. Chạy dòng `mailbox claim MB-xxxx` hiện trên màn hình trong pane của agent mới, hộp thư sẽ được kết nối lại.

## Gửi thư

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

`--to` nhận pane id, tên agent hoặc id hộp thư. `--recommend` là tuỳ chọn; thẻ không có nó sẽ không đánh dấu phương án đề xuất.

Nội dung dài hơn thì đính kèm vào thư dưới dạng tệp (`--attach <file>`, tối đa 5 tệp mỗi thư); trên thẻ sẽ có một liên kết, bấm vào là tệp mở bằng chương trình mặc định của hệ thống (ảnh mở trong trình xem ảnh, tệp văn bản mở trong ứng dụng mặc định). Địa chỉ web trong câu hỏi mở bằng trình duyệt mặc định.

Với `--wait [--timeout <ms>]`, lệnh gửi chỉ trả về sau khi leader đã nhận thư và làm xong lượt của mình. Nếu thôi chờ, lệnh kết thúc với mã 3 hoặc 4; thư gửi vào hộp thư dù thế nào cũng đã vào hàng đợi hoặc đã được chuyển, nên đừng gửi lại. Thư gửi tới một pane không có hộp thư sẽ được ký tên và gõ thẳng vào đó một lần, ngay lập tức. Câu hỏi thảo luận, cách kiểm tra, sửa và thu hồi thư, cùng công dụng của từng nút trên màn hình đều có trong [hướng dẫn đầy đủ](./guide.md).

## Giới hạn

- Một câu hỏi dài tối đa 200 ký tự, một tin nhắn thường tối đa 500 ký tự; nội dung dài hơn thì để trong tệp và đính kèm bằng `--attach`.
- Agent sở hữu hộp thư (leader) phải là Claude Code hoặc agy, vì việc chuyển thư phải chờ ô nhập liệu của nó trống, và chỉ đọc được ô nhập liệu của hai loại này; bên gửi thì agent nào cũng được.

## Vấn đề đã biết

- **Codex: chưa thể sở hữu hộp thư.** Codex 0.163 chạy mọi cuộc trò chuyện trong một máy chủ nền dùng chung, nên tích hợp Codex của Herdr báo mọi cuộc trò chuyện về pane đã khởi động máy chủ đó, còn chính pane Codex không bao giờ nhận được id cuộc trò chuyện để gắn hộp thư vào. Codex vẫn gửi thư được, và tin nhắn thường gửi tới một pane Codex không có hộp thư sẽ được ký tên và gõ thẳng vào đó một lần. Pane id của Codex trong `HERDR_PANE_ID` có thể sai, nên bên gửi là Codex phải tự chỉ rõ pane của mình bằng `--from <pane id>`.
- **agy: skill không được cài vào chỗ agy đọc.** CLI `skills` không cài được vào thư mục mà agy nạp skill, nên `npx skills add` không tới được agy. Đây là giới hạn của CLI đó; hộp thư không tìm cách lách qua.
- **agy: thấy skill nhưng không tự dùng hộp thư.** Nếu chỉ bảo nó "báo cáo cho agent-a", agy sẽ dùng công cụ nhắn tin có sẵn của nó thay vì `mailbox send`. Hãy nêu rõ lệnh trong yêu cầu ("gửi bằng `mailbox send`").

<details>
<summary>Nâng cao: cách hoạt động, trạng thái, kiểm thử</summary>

### Cách hoạt động

Một daemon nhỏ giữ tệp trạng thái và xử lý lần lượt từng yêu cầu. CLI nói chuyện với nó qua socket cục bộ và sẽ khởi động nó nếu chưa chạy. Trạng thái nằm trong thư mục trạng thái plugin của Herdr (không nằm trong thư mục mã nguồn plugin), có kèm phiên bản schema, và được ghi xuống đĩa trước khi trả về biên nhận. Mỗi session Herdr có thư mục con, daemon và hộp thư riêng, nên cùng một địa chỉ pane ở hai session không bao giờ dùng chung thư.

| Thành phần | Vai trò |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Daemon và các quy tắc về thư: biên nhận, loại trùng, sửa và thu hồi, giới hạn độ dài. |
| `src/identity.mjs` | Gắn hộp thư với người nhận, vòng đối chiếu định kỳ, nhận quyền sở hữu hộp thư. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Chuyển thư theo lô, kiểm tra ô nhập liệu, xác nhận đã đến, nội dung của lô. |
| `src/screen/` | Màn hình hộp thư, cài đặt hiển thị ngay trong đó; tệp đính kèm và liên kết được chuyển cho các chương trình mặc định của hệ thống. |
| `src/open.mjs`, `src/on-focus.mjs` | Thao tác `prefix+shift+m` và mở lại màn hình hộp thư sau khi Herdr khởi động lại. |
| `src/session-start.mjs`, `src/prompt-submit.mjs`, `src/send-guard.mjs` | Các hook của Claude Code. |

### Kiểm thử

```sh
npm test
```

Chạy CLI và daemon thật với một tệp thực thi `herdr` giả, trong một thư mục trạng thái dùng một lần.

</details>

## Giấy phép

MIT
