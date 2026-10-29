# Hướng Dẫn Huấn Luyện Kiến Trúc 2D Spatial CNN (1.000.000 Steps) Trên Kaggle GPU

Tài liệu này hướng dẫn bạn từng bước cách thiết lập và chạy huấn luyện mô hình **2D Spatial CNN (Mạng nơ-ron tích chập không gian)** trên máy chủ **Kaggle GPU (T4 x2 hoặc P100)** để đạt điểm số kỷ lục và so sánh trực tiếp với mô hình MLP cũ.

---

## 1. Thiết Lập Kaggle Notebook

1. Tạo một Notebook mới trên Kaggle: **File $\rightarrow$ New Notebook**.
2. Ở bảng điều khiển bên phải (**Notebook settings**):
   - **Accelerator**: Chọn **GPU T4 x2** (hoặc GPU P100).
   - **Internet**: Bật **ON** (để cài đặt Node.js và thư viện).
3. Đẩy code từ nhánh phụ `dovietquanghuy` lên GitHub:
   ```powershell
   git checkout -b dovietquanghuy
   git add .
   git commit -m "feat: add 2D spatial CNN architecture and comparison tooling"
   git push -u origin dovietquanghuy
   ```

---

## 2. Mã Nguồn Từng Cell (Copy & Chạy Theo Thứ Tự)

### Cell 1: Cài đặt Node.js 20 LTS
```bash
%%bash
# Cài đặt Node.js 20 LTS cho môi trường Ubuntu của Kaggle
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
```

### Cell 2: Tải mã nguồn dự án từ nhánh `dovietquanghuy` trên GitHub
```bash
!git clone -b dovietquanghuy https://github.com/dovietquanghuy10a9ltt-creator/RLProject-Blockblast.git /kaggle/working/blockblast
%cd /kaggle/working/blockblast
```

### Cell 3: Cài đặt thư viện & Kiểm tra kết nối GPU
```bash
!pip install --upgrade pip
!pip install -e ".[train]"
!pip install matplotlib

# Kiểm tra nhận diện GPU T4 của PyTorch
import torch
print("PyTorch Version:", torch.__version__)
print("CUDA Available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("Device Name:", torch.cuda.get_device_name(0))

# Chạy test kiểm thử kiến trúc CNN
!python -m unittest tests/test_models.py
```

---

### Cell 4: Chạy Lộ Trình 1 Triệu Steps Với Kiến Trúc 2D Spatial CNN

Chúng ta áp dụng kỹ thuật **Curriculum Learning** trên kiến trúc CNN mới để tối ưu hóa hiệu quả:

#### Giai đoạn 1: Khởi động với 5 khối (150.000 steps - ~5 phút trên GPU)
```bash
!python -m blocknova_rl.train \
    --steps 150000 \
    --shape-count 5 \
    --policy-type cnn \
    --features-dim 256 \
    --device cuda \
    --output outputs/cnn-five
```

#### Giai đoạn 2: Mở rộng lên 18 khối (350.000 steps - ~12 phút trên GPU)
Fine-tune từ checkpoint Giai đoạn 1 với tốc độ học $1.5 \times 10^{-4}$:
```bash
!python -m blocknova_rl.train \
    --steps 350000 \
    --shape-count 18 \
    --policy-type cnn \
    --features-dim 256 \
    --pretrained outputs/cnn-five/final.zip \
    --learning-rate 0.00015 \
    --device cuda \
    --output outputs/cnn-eighteen
```

#### Giai đoạn 3: Trọn vẹn 30 khối (500.000 steps - ~18 phút trên GPU)
Fine-tune tiếp từ Giai đoạn 2 với toàn bộ 30 khối của game:
```bash
!python -m blocknova_rl.train \
    --steps 500000 \
    --shape-count 30 \
    --policy-type cnn \
    --features-dim 256 \
    --pretrained outputs/cnn-eighteen/final.zip \
    --learning-rate 0.0001 \
    --device cuda \
    --output outputs/cnn-full
```

*(Tổng cộng cả 3 giai đoạn là **1.000.000 steps**, chỉ mất khoảng 35–45 phút trên GPU T4).*

---

### Cell 5: Đánh Giá Độc Lập Trên 50 Ván (Held-Out Seeds)
```bash
!python -m blocknova_rl.evaluate --run outputs/cnn-full --checkpoint best/best_model.zip --episodes 50
```

---

### Cell 6: Bảng So Sánh Đối Đầu & Vẽ Đồ Thị Học Tập (MLP vs CNN)
```bash
!python -m blocknova_rl.compare_architectures \
    --runs outputs/curriculum-full outputs/cnn-full \
    --labels "Curriculum-MLP (30 shapes)" "Curriculum-CNN (30 shapes)" \
    --plot outputs/mlp_vs_cnn_comparison.png
```

---

### Cell 7: Nén Kết Quả Để Tải Về Máy Tính
```bash
!zip -r /kaggle/working/cnn_1m_results.zip \
    outputs/cnn-full/final.zip \
    outputs/cnn-full/best/ \
    outputs/cnn-full/run.json \
    outputs/cnn-full/train.monitor.csv \
    outputs/cnn-full/comparison.json \
    outputs/mlp_vs_cnn_comparison.png

print("ĐÃ NÉN XONG! Tải file cnn_1m_results.zip từ panel bên phải màn hình Kaggle.")
```
