# Hướng Dẫn Chạy Curriculum Learning (Giai Đoạn 2 & 3) Trên Kaggle

Tài liệu này hướng dẫn bạn cách thiết lập môi trường và chạy huấn luyện mô hình PPO Block Blast từ Giai đoạn 2 (18 khối) và Giai đoạn 3 (30 khối) trên máy chủ miễn phí của **Kaggle Notebook**.

---

## 1. Chuẩn Bị Tệp Dự Án Để Đưa Lên Kaggle

Tệp checkpoint Giai đoạn 1 đã có sẵn tại máy của bạn: `outputs/ppo-five/final.zip` (kích thước chỉ ~1.1 MB).

Bạn có 2 cách đưa code và checkpoint lên Kaggle:
- **Cách 1 (Khuyên dùng - Qua GitHub)**: Đẩy code và file `outputs/ppo-five/final.zip` lên kho GitHub của bạn, sau đó `git clone` trực tiếp trong Kaggle.
- **Cách 2 (Nén file zip)**: Nén các thư mục sau thành `blockblast.zip`:
  - `blocknova_rl/`
  - `rl/`
  - `src/`
  - `outputs/ppo-five/final.zip`
  - `pyproject.toml`
  - `requirements-rl.lock.txt`
  - `package.json`
  Sau đó upload file zip này lên Kaggle Dataset hoặc kéo thả vào `/kaggle/working`.

---

## 2. Mã Nguồn Từng Cell Cho Kaggle Notebook

Mở một Notebook mới trên Kaggle (chọn Accelerator: **CPU** hoặc GPU P100/T4), sau đó tạo các cell code sau:

### Cell 1: Cài đặt Node.js 20 LTS (Bắt buộc vì môi trường chạy engine Node.js >= 20)
```bash
%%bash
# Cài đặt Node.js 20 trên môi trường Ubuntu của Kaggle
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
```

### Cell 2: Tải mã nguồn & giải nén (Chọn 1 trong 2 cách bên dưới)

**Nếu dùng GitHub:**
```bash
!git clone https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git /kaggle/working/blockblast
%cd /kaggle/working/blockblast
```

**Hoặc nếu tải file `blockblast.zip` lên Kaggle:**
```bash
!mkdir -p /kaggle/working/blockblast
!unzip -q /kaggle/input/<tên-dataset-của-bạn>/blockblast.zip -d /kaggle/working/blockblast
%cd /kaggle/working/blockblast
```

### Cell 3: Cài đặt các thư viện Python
```bash
!pip install --upgrade pip
!pip install -e ".[train]"
# Kiểm tra smoke test để bảo đảm môi trường Gymnasium và Node.js kết nối tốt
!python -m blocknova_rl.smoke --list-shapes
```

### Cell 4: Chạy Giai Đoạn 2 (18 khối — 150.000 steps)
Huấn luyện tiếp từ checkpoint Giai đoạn 1 (`outputs/ppo-five/final.zip`), mở rộng sang 18 khối với tốc độ học `0.00015`:
```bash
!python -m blocknova_rl.train \
    --steps 150000 \
    --shape-count 18 \
    --pretrained outputs/ppo-five/final.zip \
    --learning-rate 0.00015 \
    --output outputs/curriculum-eighteen
```

### Cell 5: Chạy Giai Đoạn 3 (Trọn bộ 30 khối — 200.000 steps)
Nạp checkpoint Giai đoạn 2 vừa train xong ở trên để tinh chỉnh sang toàn bộ 30 khối:
```bash
!python -m blocknova_rl.train \
    --steps 200000 \
    --shape-count 30 \
    --pretrained outputs/curriculum-eighteen/final.zip \
    --learning-rate 0.0001 \
    --output outputs/curriculum-full
```

### Cell 6: Đánh giá hiệu năng và so sánh với Random Baseline
```bash
!python -m blocknova_rl.evaluate --run outputs/curriculum-full --episodes 20
```

### Cell 7: Nén các file kết quả để tải về máy
```bash
!zip -r /kaggle/working/curriculum_results.zip \
    outputs/curriculum-eighteen/final.zip \
    outputs/curriculum-eighteen/run.json \
    outputs/curriculum-eighteen/train.monitor.csv \
    outputs/curriculum-full/final.zip \
    outputs/curriculum-full/best/ \
    outputs/curriculum-full/run.json \
    outputs/curriculum-full/train.monitor.csv \
    outputs/curriculum-full/comparison.json

print("Đã tạo file /kaggle/working/curriculum_results.zip! Bạn có thể tải về từ panel Output bên phải.")
```
