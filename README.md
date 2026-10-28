# Block Nova

## Gymnasium và huấn luyện RL

Đã có môi trường `BlockNova-v0` dùng trực tiếp luật JavaScript của game, action masking, seed tái lập, lệnh chạy thử, huấn luyện MaskablePPO và đánh giá so với random. Xem **[hướng dẫn RL](RL_GUIDE.md)** để chạy và hiểu cách phát khối.

Hiện có **30 loại hình khối**, **6 màu** (không ảnh hưởng luật), mặc định **3 khối mỗi bộ**. Sửa **[`src/block-config.js`](src/block-config.js)** để đổi số loại (`shapeCount`), chọn chính xác hình (`enabledShapeIds`), đổi trọng số (`shapeWeights`) và số khối mỗi bộ (`handSize`, 1–9). Các môi trường mới và game trình duyệt dùng cùng cấu hình này.

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.smoke --list-shapes
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 100000 --output outputs/ppo-full
```

Game xếp khối 8×8 lấy cảm hứng từ lối chơi Block Blast, với thiết kế riêng: nền arcade tối, khối màu có chiều sâu, bóng xem trước vị trí đặt, hạt sáng khi phá hàng và âm thanh tổng hợp. Không sử dụng hình ảnh hay mã nguồn của Block Blast.

## Bản nâng cấp 1.1

- **Kéo chuột chính xác:** khối đang cầm bắt dính vào đúng ô xem trước. Tọa độ được cập nhật khi cuộn, đổi kích thước, phóng to và ngay trước lúc thả. Giữ đúng ô đã cầm, kể cả khối chữ L hoặc khối có góc trống.
- **Khối 3D bằng WebGL:** mô hình khối có mặt vát, cạnh dày, ánh sáng và phản sáng. Giữ góc nhìn từ trên xuống để dễ xếp; lối chơi vẫn là bàn 8×8. Các khối trong khay, trên bàn và đang kéo dùng cùng kiểu dựng hình.
- **Hiệu ứng mới:** khối nảy nhẹ khi đặt, tia sáng chạy dọc hàng/cột, mảnh khối và đốm sáng văng ra, vòng sáng và hiệu ứng mừng kỷ lục. Xóa sạch bảng có thông báo riêng.
- **Âm thanh mới:** tiếng chạm trầm kết hợp âm pha lê, tiếng nhấc/thả, tiếng bắt ô, hiệu ứng phát bộ mới, combo và kỷ lục; có stereo và vang ngắn. Có thanh chỉnh âm lượng.
- **Cài đặt:** bật/tắt 3D, chuyển động và âm thanh độc lập. Trình duyệt không hỗ trợ WebGL hoặc mất ngữ cảnh đồ họa sẽ dùng khối 2D để tiếp tục chơi. Hiệu ứng dừng khi trang bị ẩn; phần dựng khối ngừng vẽ khi không có thay đổi.

Ván chơi và kỷ lục cũ được giữ nguyên. Cài đặt cũ được bổ sung tùy chọn 3D và âm lượng tự động. Sau khi cập nhật mã nguồn, nhấn **Ctrl+F5** trên trang game để tải bản mới.

## Chạy trong VS Code

### Cách 1 — Không cần cài thư viện

1. Mở thư mục `D:\Blockblast` trong VS Code.
2. Mở **Terminal → New Terminal**.
3. Nếu máy đã có Node.js 20 trở lên, chạy:

   ```sh
   node server.js
   ```

4. Mở **http://localhost:5173** trong trình duyệt.

Không cần `npm install`. Nhấn `Ctrl+C` trong terminal để dừng. Nếu cổng 5173 đã được dùng, mở trang game đang chạy hoặc chọn cổng khác trong PowerShell:

```powershell
$env:PORT = '5174'
node server.js
```

### Cách 2 — Live Server

Cài tiện ích **Live Server** được gợi ý trong VS Code, mở `index.html`, rồi chọn **Open with Live Server**. Tiện ích tự tải lại trang sau khi sửa mã nguồn. Không mở `index.html` bằng cách nhấp đúp vì trình duyệt cần máy chủ cục bộ để nạp JavaScript modules.

### Cách 3 — Khởi động nhanh trên Windows

Nhấp đúp **CHOI-GAME.cmd**. Sau khi hiện thông báo game sẵn sàng, mở địa chỉ hiển thị. Trình khởi động dùng Node.js đã có trên máy, hoặc bản Node.js đi kèm Codex nếu tìm thấy.

## Cách chơi

- Kéo một trong ba khối vào bàn. Có thể chạm/chọn khối rồi chạm ô đặt **góc trên bên trái** của khung khối.
- Lấp đầy hàng ngang hoặc cột dọc để xóa chúng. Có thể xóa nhiều hàng và cột cùng một lượt.
- Mỗi ô đặt được **10 điểm**. Mỗi hàng/cột được xóa cộng **100 × combo** điểm.
- Phá hàng ở các lượt đặt liên tiếp để tăng combo. Lượt đặt không phá hàng sẽ đặt combo về 0.
- Dùng hết ba khối để nhận bộ mới. Các khối giữ nguyên hướng, không xoay.
- Ván kết thúc khi **không khối còn lại nào** đặt vừa bảng. Không giới hạn thời gian.

| Phím | Thao tác |
| --- | --- |
| `1`, `2`, `3` | Chọn khối tương ứng |
| `↑` `↓` `←` `→` | Di chuyển vị trí xem trước |
| `Enter` hoặc `Space` | Đặt khối khi đang chọn ô trên bảng |
| `Esc` | Bỏ chọn / đóng hộp thoại |
| `M` | Bật/tắt âm thanh |
| `N` | Bắt đầu ván mới |

Game hỗ trợ chuột, cảm ứng và bàn phím; tự co giao diện theo màn hình. Với cảm ứng kéo thả, khối được nâng lên phía trên ngón tay để nhìn rõ vị trí đặt.

## Lưu trữ và âm thanh

Ván chơi, kỷ lục và cài đặt được lưu trong `localStorage` của trình duyệt trên thiết bị hiện tại. Đổi trình duyệt, đổi cổng/địa chỉ hoặc xóa dữ liệu duyệt web sẽ dùng một kho lưu khác. Nếu trình duyệt chặn lưu trữ, game vẫn chạy và hiện thông báo.

Âm thanh được tạo bằng Web Audio sau thao tác đầu tiên; không tải tệp âm thanh từ mạng. Trong cài đặt, bạn có thể chỉnh âm lượng, tắt âm thanh, chuyển động hoặc 3D. Tắt âm thanh/đặt âm lượng về 0 sẽ ngắt cả tiếng vang và các nốt đang chờ. Game cũng tôn trọng chế độ giảm chuyển động của hệ điều hành. Game không cần Internet khi máy chủ cục bộ đang chạy.

## Cấu trúc

```text
index.html               Giao diện tiếng Việt, bảng chơi và hộp thoại
src/styles.css           Khối màu, bố cục responsive và hoạt ảnh
src/enhanced.css         Giao diện nâng cấp, khối nổi và chế độ 3D/2D
src/main.js              Kéo thả, cảm ứng, bàn phím, hiệu ứng và điều phối game
src/drag.js              Tính vị trí kéo, điểm cầm và tọa độ bắt ô
src/renderer3d.js        Mô hình khối, shader ánh sáng và dự phòng WebGL
src/effects.js           Hạt sáng, mảnh khối, tia sáng và hiệu ứng kỷ lục
src/engine.js            Luật chơi thuần JavaScript và phát khối
src/audio.js             Âm thanh Web Audio
src/storage.js           Kiểm tra và lưu/khôi phục dữ liệu
server.js                Máy chủ tĩnh cục bộ, không cần thư viện ngoài
tests/                   Kiểm tra luật chơi, kéo thả, âm thanh và lưu trữ
```

## Kiểm tra

```sh
node --test tests/*.test.js
```

Kiểm tra đặt khối hợp lệ, tính điểm, xóa đồng thời hàng/cột, combo, hết nước đi, bộ khối có lời giải, dữ liệu hỏng, chuyển đổi cài đặt cũ, tọa độ kéo thả và vòng đời âm thanh. Các lệnh `npm run dev`, `npm test`, `npm run check` cũng có sẵn nếu máy đã cài npm.

Kiểm tra hồi quy trên trình duyệt nằm trong `tests/browser-regression.mjs`: kiểm tra vị trí chính xác của từng ô khi cuộn, thả nhanh, đổi kích thước, phóng to, hủy kéo và sử dụng bàn phím. Bộ kiểm tra này cần **Playwright** riêng cho môi trường phát triển; game không phụ thuộc Playwright. Khi đã có Playwright và máy chủ cục bộ đang chạy:

```sh
node tests/browser-regression.mjs
```

Có thể đặt `BLOCKNOVA_MODULES` đến thư mục chứa gói Playwright, `BLOCKNOVA_BROWSER` đến trình duyệt Chromium, và `BLOCKNOVA_URL` nếu game dùng địa chỉ khác. Mặc định bộ kiểm tra dùng Edge trên Windows nếu tìm thấy, hoặc trình duyệt Chromium của Playwright.

Để thay màu khối, sửa `.color-violet`, `.color-cyan` và các lớp `.color-*` trong `src/enhanced.css`. Renderer 3D đọc cùng biến màu CSS. Thêm hình khối tại `SHAPES` trong `src/engine.js`.
