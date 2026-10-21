# herdr-mailbox

![License](https://img.shields.io/badge/license-MIT-blue)
![Herdr 0.9.3+](https://img.shields.io/badge/herdr-0.9.3%2B-8a2be2)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%E2%80%A2%20Linux%20%E2%80%A2%20Windows-informational)
![Runtime](https://img.shields.io/badge/runtime-Node%2018%2B-5fa04e)

[English](../README.md) | [简体中文](./zh-sc.md) | [繁體中文](./zh-tc.md) | [Español](./es.md) | [Português](./pt.md) | [Русский](./ru.md) | [日本語](./jp.md) | [Français](./fr.md) | [Deutsch](./de.md) | [Tiếng Việt](./vi.md) | [한국어](./ko.md) | [ไทย](./th.md) | [Italiano](./it.md)

<p align="center">
  <a href="#cài-đặt">cài đặt</a> · <a href="#gửi-thư">gửi thư</a> · <a href="#giới-hạn">giới hạn</a> · <a href="./guide.md">hướng dẫn đầy đủ</a>
</p>

> Bạn đang gõ dở, worker chen ngang, leader bị đánh thức lần thứ ba, mà câu hỏi lúc nãy đâu mất rồi?

Bạn chạy một multi-agent workflow trong Herdr: một leader cùng vài worker chạy Claude Code và Codex, mỗi con một việc. Hễ xong việc nào, chúng lại ném kết quả thẳng vào cuộc trò chuyện của leader. Bạn mới gõ nửa câu thì một báo cáo chen vào và bị gửi đi cùng; câu hỏi cần bạn quyết định vừa hiện ra đã bị tin nhắn kế tiếp cuốn trôi.

**Trước khi dùng**

![Không có hộp thư: báo cáo của worker bị gõ vào prompt đang viết dở rồi gửi đi cùng, sau đó mỗi báo cáo và câu hỏi lại đánh thức leader, cuộc trò chuyện đầy ắp](./media/demo-before.gif)

Mailbox cho leader một hộp thư. Ngoài tin nhắn thường (như tấm bưu thiếp), worker còn có thể gửi thẻ quyết định và thẻ thảo luận để bạn trả lời. Tin nhắn thường chỉ được đưa vào thành một lô khi bạn không đang gõ và leader đang rảnh; còn thẻ thì nằm yên trong hộp thư, chờ bạn trả lời bằng chuột.

**Sau khi dùng**

![Có hộp thư: báo cáo chờ trong hộp thư lúc bạn đang gõ, rồi đến cùng một lô; câu hỏi được trả lời bằng chuột và gửi lại một lượt](./media/demo.gif)

- **Ô nhập liệu luôn là của bạn** — không có gì bị gõ vào khi bạn đang gõ, và không có gì được đưa vào khi leader còn đang trả lời.
- **Tin nhắn thường đến cùng lúc** — tin nhắn thường chờ tối đa một phút để vào thành một lô và chỉ đánh thức leader một lần; bấm **Send now** nếu không muốn chờ.
- **Câu hỏi gom về một chỗ** — câu hỏi quyết định biến thành thẻ ngay cạnh leader; trả lời bằng chuột rồi gửi toàn bộ câu trả lời một lượt.
- **Agent nào cũng gửi được** — bên gửi chỉ cần chạy `mailbox send`, nên Claude Code, Codex và bất kỳ agent nào chạy được lệnh shell đều gửi được vào cùng một hộp thư.
- **Mỗi lần gửi đều có biên nhận** — mỗi lần gửi trả về ngay id và trạng thái của lá thư.
- **Đi theo leader** — di chuyển pane, khởi động lại Herdr hay xoá cuộc trò chuyện thì hộp thư vẫn thuộc về cùng một người nhận.

## Cài đặt

Cần Herdr 0.9.3 trở lên và Node 18 trở lên.

```sh
herdr plugin install navishachiku/herdr-mailbox
```

Phần cài đặt còn lại (lệnh `mailbox`, hooks của Claude Code, phím tắt, và nếu bạn dùng Codex thì thêm một quy tắc) cứ giao cho coding agent của bạn. Với lệnh, hooks và quy tắc Codex, nó chạy `node <plugin dir>/src/setup.mjs install`; `uninstall` hoàn tác tất cả. Dán câu này cho nó:

```
Set up herdr-mailbox by following https://github.com/navishachiku/herdr-mailbox/blob/main/AGENT-SETUP.md
```

Xong rồi thì bấm `prefix+shift+r` để tải lại Herdr, rồi bấm `prefix+shift+m` trên pane của leader để mở màn hình hộp thư ngay bên cạnh (`prefix` mặc định là `ctrl+b`). Các bước agent làm theo nằm trong [AGENT-SETUP.md](../AGENT-SETUP.md).

## Gửi thư

```sh
mailbox send --to <address|MB-id> --type note "tests pass"

mailbox send --to <address|MB-id> --type decision \
  --question "Install the skill too?" --option "Yes" --option "No" --recommend A
```

Nội dung dài hơn thì đính kèm vào thư dưới dạng tệp (`--attach <file>`); trên thẻ sẽ có một liên kết, bấm vào là tệp mở ngay trong màn hình hộp thư.

![Thẻ quyết định có kèm báo cáo kiểm thử: bấm vào liên kết, báo cáo mở trong một khung ngay trên màn hình hộp thư](./media/attachment.png)

`--to` nhận pane id, tên agent hoặc id hộp thư. Bấm `prefix+shift+m` trên pane của leader để mở màn hình hộp thư ngay bên cạnh. Câu hỏi thảo luận, cách sửa và thu hồi thư, cùng công dụng của từng nút trên màn hình đều có trong [hướng dẫn đầy đủ](./guide.md).

## Giới hạn

- Một câu hỏi dài tối đa 200 ký tự, một tin nhắn thường tối đa 500 ký tự; nội dung dài hơn thì để trong tệp và đính kèm bằng `--attach`.
- Agent sở hữu hộp thư (leader) phải là Claude Code, vì việc chuyển thư phải chờ ô nhập liệu của nó trống; bên gửi thì agent nào cũng được.

<details>
<summary>Nâng cao: cách hoạt động, trạng thái, kiểm thử</summary>

### Cách hoạt động

Một daemon nhỏ giữ tệp trạng thái và xử lý lần lượt từng yêu cầu. CLI nói chuyện với nó qua socket cục bộ và sẽ khởi động nó nếu chưa chạy. Trạng thái nằm trong thư mục trạng thái plugin của Herdr (không nằm trong thư mục mã nguồn plugin), có kèm phiên bản schema, và được ghi xuống đĩa trước khi trả về biên nhận. Mỗi session Herdr có thư mục con, daemon và hộp thư riêng, nên cùng một địa chỉ pane ở hai session không bao giờ dùng chung thư.

| Thành phần | Vai trò |
| --- | --- |
| `src/daemon.mjs`, `src/core.mjs` | Daemon và các quy tắc về thư: biên nhận, loại trùng, sửa và thu hồi, giới hạn độ dài. |
| `src/identity.mjs` | Gắn hộp thư với người nhận, vòng đối chiếu định kỳ, nhận quyền sở hữu hộp thư. |
| `src/delivery.mjs`, `src/format.mjs`, `src/input-box.mjs` | Chuyển thư theo lô, kiểm tra ô nhập liệu, xác nhận đã đến, nội dung của lô. |
| `src/screen/` | Màn hình hộp thư, cài đặt và tệp đính kèm cũng hiển thị ngay trong đó. |
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
