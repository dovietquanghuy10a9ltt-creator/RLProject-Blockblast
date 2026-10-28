# Huấn luyện AI chơi Block Nova

## Có bao nhiêu loại khối?

Danh mục `SHAPES` trong `src/engine.js` hiện có **30 hình dạng**, tính từng hướng là một loại riêng vì game không cho xoay khối.

| Nhóm | ID | Số loại |
| --- | --- | ---: |
| Một ô | `single` | 1 |
| Hai ô | `domino-h`, `domino-v` | 2 |
| Thanh dài 3, 4, 5 ô | `line3-h/v`, `line4-h/v`, `line5-h/v` | 6 |
| Vuông 2×2 và 3×3 | `square2`, `square3` | 2 |
| Chữ nhật 2×3 và 3×2 | `rectangle-h`, `rectangle-v` | 2 |
| Góc nhỏ 3 ô | `corner-ne`, `corner-nw`, `corner-se`, `corner-sw` | 4 |
| Chữ L 4 ô | `ell-se`, `ell-sw`, `ell-ne`, `ell-nw` | 4 |
| Chữ T | `tee-down`, `tee-up`, `tee-right`, `tee-left` | 4 |
| Chữ S/Z | `zigzag-h`, `zigzag-v`, `zagzig-h`, `zagzig-v` | 4 |
| Góc lớn 5 ô | `big-corner` | 1 |
| **Tổng** | | **30** |

`line3-h/v` trong bảng là viết tắt của hai ID `line3-h` và `line3-v`, tương tự với `line4` và `line5`.

Mặc định mỗi bộ có **3 khối**, được phép trùng hình. Có 6 màu; màu chỉ để hiển thị, không ảnh hưởng luật. Như vậy có 180 tổ hợp hình–màu cho một khối, nhưng chỉ có 30 loại có ý nghĩa với AI. Với bộ ba có thứ tự, `30³ = 27.000` là số tổ hợp hình lý thuyết trước khi áp dụng các ràng buộc của bộ phát; không phải 27.000 tổ hợp đồng xác suất.

## Khối được chọn ngẫu nhiên như thế nào?

Đây **không phải** chọn đều một loại trong 30 loại:

1. Lọc các hình đặt được trên một bàn mô phỏng.
2. Gán trọng số ban đầu: một ô `0.25`; hai ô `0.65`; hình khác `1`.
3. Nếu hình có ít nhất 6 ô và bàn mô phỏng còn hơn 36 ô trống, nhân `1.6`.
4. Nếu hình đã được chọn trong bộ đang phát, nhân `0.35` (vẫn có thể trùng).
5. Nhân thêm `shapeWeights[id]` nếu được cấu hình.
6. Chọn theo trọng số, rồi mô phỏng đặt khối và phá hàng để chọn khối tiếp theo.

Với cấu hình mặc định, **lần chọn đầu tiên trên bàn trống**, tổng trọng số là `30.35`: khối một ô khoảng `0.824%`; mỗi hình hai ô khoảng `2.142%`; mỗi hình từ 6 ô trở lên khoảng `5.272%`; mỗi hình còn lại khoảng `3.295%`. Những lần chọn sau thay đổi theo bàn mô phỏng và các hình đã chọn.

Bộ phát mặc định bảo đảm có một chuỗi đặt hết bộ khi bàn còn ô trống. Nếu bỏ bớt hình, đặc biệt bỏ `single`, tính chất này không còn được bảo đảm. Khi không hình nào trong danh sách đặt vừa bàn mô phỏng, bộ phát vẫn chỉ chọn trong danh sách cho phép và ván có thể kết thúc vì hết nước đi. Trường hợp dự phòng này chọn đều từ danh sách cho phép.

## Chỉnh số loại khối và số khối mỗi bộ

Sửa **`src/block-config.js`** để áp dụng cho cả game trình duyệt và các môi trường Gymnasium mới:

```js
export const BLOCK_CONFIG = Object.freeze({
  handSize: 3,            // Số khối mỗi bộ: 1–9.
  shapeCount: 30,         // Lấy N hình đầu tiên trong SHAPES; null = tất cả.
  enabledShapeIds: null,  // Nếu có danh sách thì ưu tiên danh sách, bỏ qua shapeCount.
  shapeWeights: {},       // Hệ số dương nhân trọng số gốc, không phải xác suất %.
});
```

Ví dụ chỉ dùng 5 hình đầu (một ô, đôi ngang/dọc, ba ô ngang/dọc): đổi `shapeCount: 5`.

Ví dụ chọn chính xác 4 loại và ưu tiên vuông nhỏ:

```js
enabledShapeIds: ['single', 'domino-h', 'domino-v', 'square2'],
shapeWeights: { square2: 2 },
```

Khởi động lại môi trường Python sau khi sửa. Với game: tải lại bằng Ctrl+F5 rồi bắt đầu ván mới để áp dụng trọn bộ luật. Ván lưu có số ô khay hoặc loại khối không còn phù hợp sẽ được bỏ qua. Kỷ lục trình duyệt hiện được giữ chung giữa các cấu hình, nên không dùng kỷ lục đó để so sánh thí nghiệm.

Game hỗ trợ phím 1–9 theo số khối trong khay. Với hơn 3 khối, khay xuống dòng, tối đa 3 ô mỗi hàng. Muốn tạo hình mới thực sự, thêm mục vào `SHAPES`, rồi tăng `shapeCount` hoặc đặt `null`. Bộ mã hóa Gymnasium hiện hỗ trợ khung hình tối đa 5×5; thêm hình lớn hơn cần cập nhật observation trước khi train.

## Cài đặt và kiểm tra

Môi trường `.venv` riêng được dùng cho dự án. Cần Node.js >=20 và Python >=3.10; Python 3.12 được dùng trong lần thiết lập này.

Nếu cần thiết lập lại từ đầu, dùng một bản Python 3.12 đã cài:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[train]"
```

Không cần kích hoạt `.venv`, cứ gọi trực tiếp Python bên trong:

VS Code cũng đã được cấu hình ưu tiên `.venv/Scripts/python.exe`. File `requirements-rl.lock.txt` ghi lại đúng phiên bản thư viện đã cài trong lần thiết lập này. Nếu muốn tái lập các phiên bản đó trên Python 3.12, dùng `python -m pip install -r requirements-rl.lock.txt` trong môi trường riêng, sau đó `python -m pip install -e . --no-deps`.

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.smoke --list-shapes
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --test tests/*.test.js
```

`--list-shapes` in đủ ID, số ô, kích thước khung và trạng thái bật/tắt, sau đó chạy kiểm tra chuẩn Gymnasium và một ván random hợp lệ. Thêm `--render` để in từng bàn chơi bằng ký tự.

Có thể chỉnh riêng từng thí nghiệm mà không sửa cấu hình game:

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.smoke --shape-count 5 --hand-size 3
.\.venv\Scripts\python.exe -m blocknova_rl.smoke --shapes single domino-h domino-v square2 --hand-size 2
```

`--shape-count` và `--shapes` là hai cách chọn thay thế nhau; không truyền đồng thời.

## Dùng Gymnasium trong Python

```python
import gymnasium as gym
import numpy as np
import blocknova_rl  # Đăng ký BlockNova-v0.

with gym.make('BlockNova-v0', shape_count=5, hand_size=3) as env:
    observation, info = env.reset(seed=42)
    while True:
        valid_actions = np.flatnonzero(env.unwrapped.action_masks())
        action = int(env.np_random.choice(valid_actions))
        observation, reward, terminated, truncated, info = env.step(action)
        if terminated or truncated:
            print(info['score'])
            break
```

- **Action:** `slot * 64 + row * 8 + col`, đánh số từ 0. Ba khối tương ứng `Discrete(192)`; đổi số loại hình không đổi kích thước action, đổi `hand_size` thì có.
- **Observation:** dictionary gồm `board` (8×8, trống/có khối), `pieces` (mỗi hình trong khung 5×5), `available` (khối còn trong khay) và `combo`. Khối dùng rồi được mã hóa bằng toàn số 0.
- **Reward:** điểm thật tăng ở lượt vừa đặt; tùy chọn `reward_scale=100` chia reward cho 100. `info['score']` luôn là điểm thật.
- **Mask:** `action_masks()` trả mảng bool; `True` là hợp lệ. Mask có trong `info['action_mask']` nữa. Phải truyền mask khi gọi mô hình dự đoán.
- **Nước không hợp lệ trong action space:** không đổi bàn, không tăng số lượt đặt, reward 0; vẫn tính một lần thử trong giới hạn thời gian để tránh lặp vô hạn. Action ngoài không gian bị báo lỗi.
- **`terminated`:** không còn khối nào đặt được. **`truncated`:** đạt `max_steps` (mặc định 1.000 lần thử), là giới hạn thu thập trải nghiệm, không phải luật thua. Đây chưa phải nhiệm vụ hữu hạn có số lượt còn lại trong observation.
- **Seed:** điều khiển bộ phát riêng của từng môi trường, không dùng RNG chung. Cùng seed và cùng chuỗi hành động cho cùng kết quả; chính sách khác có thể nhận bộ khối tương lai khác vì bộ phát phụ thuộc bàn.
- **Render:** `render_mode='ansi'` cho bàn dạng chuỗi; môi trường không tự điều khiển giao diện trình duyệt.

Mỗi môi trường giữ một tiến trình Node.js sống liên tục và gọi trực tiếp `src/engine.js`, không viết lại luật bằng Python. Cách này ưu tiên đồng nhất với game; nếu về sau train quy mô lớn, cần đo tốc độ trước khi cân nhắc môi trường native tối ưu hơn. Gọi `close()` hoặc dùng `with` để đóng tiến trình.

## Huấn luyện và đánh giá

Thử nhanh đường chạy huấn luyện, chưa nhằm đạt điểm cao:

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 256 --max-steps 64 --eval-freq 256 --eval-episodes 2 --output outputs/smoke-ppo
```

Huấn luyện lâu hơn với đầy đủ 30 hình theo cấu hình mặc định:

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 100000 --output outputs/ppo-full
```

Hoặc bắt đầu từ 5 hình:

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 100000 --shape-count 5 --output outputs/ppo-five
```

### Huấn luyện theo lộ trình tăng dần độ khó (Curriculum Learning)

Vì không gian quan sát (khung 5×5) và không gian hành động (`Discrete(192)`) độc lập với số loại khối, ta có thể dùng `--pretrained` để chuyển giao kiến thức (transfer learning) từ các hình dễ sang toàn bộ hình phức tạp:

```powershell
# Giai đoạn 1: 5 khối cơ bản (nền tảng tạo combo, dọn hàng)
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 100000 --shape-count 5 --output outputs/curriculum-five

# Giai đoạn 2: Nạp checkpoint giai đoạn 1, mở rộng lên 18 khối cân bằng
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 150000 --shape-count 18 --pretrained outputs/curriculum-five/final.zip --learning-rate 0.00015 --output outputs/curriculum-eighteen

# Giai đoạn 3: Nạp checkpoint giai đoạn 2, mở rộng lên trọn bộ 30 khối
.\.venv\Scripts\python.exe -m blocknova_rl.train --steps 200000 --shape-count 30 --pretrained outputs/curriculum-eighteen/final.zip --learning-rate 0.0001 --output outputs/curriculum-full
```

Đánh giá và so với random hợp lệ trên seed khác:

```powershell
.\.venv\Scripts\python.exe -m blocknova_rl.evaluate --run outputs/ppo-full --episodes 20
```

Mỗi thư mục chạy chứa `run.json` (cấu hình cụ thể và phiên bản thư viện), `final.zip`, `result.json` (số bước thực chạy), log huấn luyện, checkpoint tốt nhất nếu đã đến mốc đánh giá, và `comparison.json` sau khi đánh giá. Mặc định PPO dùng CPU, MLP với đầu vào dictionary và action masking; reward được chia 100. PPO thu thập đủ rollout nên số bước thực tế có thể lớn hơn `--steps`. Thư mục kết quả phải trống để tránh ghi đè lần chạy trước.

Đánh giá đọc cấu hình đã lưu, nên thay đổi `src/block-config.js` không âm thầm thay danh sách khối của mô hình cũ. Luật engine vẫn lấy từ checkout hiện tại; cần giữ phiên bản mã nguồn khi so sánh hoặc tái lập thí nghiệm. Đổi `hand_size` cần train lại vì kích thước đầu vào/đầu ra thay đổi. Chưa có checkpoint nào được bảo đảm mạnh chỉ từ việc thiết lập môi trường.

Tài liệu chuẩn: [Gymnasium Env API](https://gymnasium.farama.org/api/env/), [MaskablePPO và công cụ đánh giá có mask](https://sb3-contrib.readthedocs.io/en/master/modules/ppo_mask.html).
