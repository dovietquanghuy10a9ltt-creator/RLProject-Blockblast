# Hướng Dẫn Thực Nghiệm Đa Seed (Multi-Seed Benchmark) Trên Kaggle GPU

Tài liệu này hướng dẫn quy trình thực nghiệm khoa học với **3 seeds độc lập (42, 123, 999)** trên máy chủ **Kaggle GPU** nhằm triệt tiêu nhiễu thống kê, kiểm định tính vượt trội của kiến trúc **2D Spatial CNN** so với baseline **MLP Curriculum**, và tìm ra checkpoint tối ưu nhất cho game.

---

## 1. Thiết Kế Thực Nghiệm Khoa Học

Để loại bỏ hoàn toàn yếu tố may mắn ngẫu nhiên (nhiễu điểm cao từ 1 ván đơn lẻ hoặc 1 seed may mắn):
- **2 Kiến trúc**: `MLP` vs `CNN (2D Spatial)`.
- **3 Seeds độc lập**: `42`, `123`, `999`.
- **Lộ trình Curriculum**: 5 khối (30k) $\rightarrow$ 18 khối (50k) $\rightarrow$ 30 khối (MLP: 200k, CNN: 500k).
- **Đánh giá chuẩn**: 200 ván held-out cố định (seeds 100.000 đến 100.199).
- **Tổng số ván đánh giá**: 6 mô hình $\times$ 200 ván = **1.200 ván** + 200 ván Random = **1.400 ván**.

---

## 2. Thiết Lập Kaggle Notebook

1. Tạo Notebook mới trên Kaggle: **File $\rightarrow$ New Notebook**.
2. Thiết lập cấu hình (**Notebook settings** bên phải):
   - **Accelerator**: **GPU T4 x2** (hoặc P100).
   - **Internet**: **ON**.
   - **Persistence**: **Variables and Files** (để giữ file khi ngắt kết nối).
3. Đẩy code mới nhất lên nhánh `dovietquanghuy`:
   ```powershell
   git add .
   git commit -m "feat: add scientific benchmark, failure analysis and multi-seed tooling"
   git push origin dovietquanghuy
   ```
   *(Lưu ý: Tuân thủ quy tắc không push lên `main`)*.

---

## 3. Các Cell Kaggle (Chạy Theo Thứ Tự)

### Cell 1: Cài đặt Node.js 20 LTS
```bash
%%bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
```

### Cell 2: Clone mã nguồn từ nhánh `dovietquanghuy`
```bash
!git clone -b dovietquanghuy https://github.com/dovietquanghuy10a9ltt-creator/RLProject-Blockblast.git /kaggle/working/blockblast
%cd /kaggle/working/blockblast
```

### Cell 3: Cài đặt thư viện & Chạy Unit Tests
```bash
!pip install --upgrade pip
!pip install -e ".[train]"

# Kiểm tra PyTorch GPU
import torch
print("CUDA Available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))

# Test kiểm thử tính tương thích
!python -m unittest discover -s tests -p "test_*.py"
```

---

### Cell 4: Chạy Huấn Luyện Đa Seed (Tự Động)

Cell này sẽ chạy toàn bộ các giai đoạn cho 3 seeds của cả 2 kiến trúc (khoảng 3.5 - 4.5 giờ trên GPU T4):

```python
import subprocess
from pathlib import Path

SEEDS = [42, 123, 999]

def run(cmd):
    print(f"\n>>> Running: {cmd}")
    res = subprocess.run(cmd, shell=True)
    if res.returncode != 0:
        raise RuntimeError(f"Command failed with code {res.returncode}: {cmd}")

for seed in SEEDS:
    print(f"\n=======================================================")
    print(f"             BẮT ĐẦU HUẤN LUYỆN VỚI SEED {seed}       ")
    print(f"=======================================================")
    
    # --- 1. MLP CURRICULUM ---
    mlp_dir = Path(f"outputs/curriculum-mlp-s{seed}")
    if not (mlp_dir / "final.zip").is_file():
        # Giai đoạn 1: 5 khối (30k)
        run(f"python -m blocknova_rl.train --shape-count 5 --steps 30000 --rollout-steps 256 --seed {seed} --device auto --output outputs/curriculum-mlp-5-s{seed}")
        # Giai đoạn 2: 18 khối (50k)
        run(f"python -m blocknova_rl.train --shape-count 18 --steps 50000 --pretrained outputs/curriculum-mlp-5-s{seed}/best/best_model.zip --seed {seed} --device auto --output outputs/curriculum-mlp-18-s{seed}")
        # Giai đoạn 3: 30 khối (200k)
        run(f"python -m blocknova_rl.train --shape-count 30 --steps 200000 --pretrained outputs/curriculum-mlp-18-s{seed}/best/best_model.zip --seed {seed} --device auto --output {mlp_dir}")

    # --- 2. CNN 2D SPATIAL CURRICULUM ---
    cnn_dir = Path(f"outputs/curriculum-cnn-s{seed}")
    if not (cnn_dir / "final.zip").is_file():
        # Giai đoạn 1: 5 khối (30k)
        run(f"python -m blocknova_rl.train --policy-type cnn --features-dim 256 --shape-count 5 --steps 30000 --rollout-steps 256 --seed {seed} --device auto --output outputs/curriculum-cnn-5-s{seed}")
        # Giai đoạn 2: 18 khối (50k)
        run(f"python -m blocknova_rl.train --policy-type cnn --features-dim 256 --shape-count 18 --steps 50000 --pretrained outputs/curriculum-cnn-5-s{seed}/best/best_model.zip --seed {seed} --device auto --output outputs/curriculum-cnn-18-s{seed}")
        # Giai đoạn 3: 30 khối (500k)
        run(f"python -m blocknova_rl.train --policy-type cnn --features-dim 256 --shape-count 30 --steps 500000 --pretrained outputs/curriculum-cnn-18-s{seed}/best/best_model.zip --seed {seed} --device auto --output {cnn_dir}")

print("\n>>> TẤT CẢ CÁC RUN ĐÃ HOÀN THÀNH!")
```

---

### Cell 5: Đánh Giá Benchmark Khoa Học Toàn Diện (200 Ván / Model)

Chạy so sánh đồng thời tất cả các model trên **cùng 200 seeds kiểm thử độc lập**:

```bash
!python -m blocknova_rl.benchmark \
    --runs outputs/curriculum-mlp-s42 outputs/curriculum-mlp-s123 outputs/curriculum-mlp-s999 \
           outputs/curriculum-cnn-s42 outputs/curriculum-cnn-s123 outputs/curriculum-cnn-s999 \
    --checkpoint best/best_model.zip \
    --episodes 200 \
    --seed 100000 \
    --output /kaggle/working/multiseed_benchmark_report.json
```

---

### Cell 6: Phân Tích Chết Sớm (Failure Mode Analysis) Cho Model CNN Tốt Nhất

```bash
!python -m blocknova_rl.analyze_failures \
    --run outputs/curriculum-cnn-s42 \
    --checkpoint best/best_model.zip \
    --episodes 200 \
    --threshold 14 \
    --output /kaggle/working/failure_analysis_cnn.json
```

---

### Cell 7: Tải File Kết Quả Về Máy Local

```python
from google.colab import files # nếu colab, hoặc zip trên Kaggle:
import shutil

shutil.make_archive('/kaggle/working/multiseed_models', 'zip', '/kaggle/working/blockblast/outputs')
print("Đã tạo file zip: /kaggle/working/multiseed_models.zip")
print("Bạn có thể tải file này từ mục File Browser bên phải giao diện Kaggle!")
```

---

## 4. Tiêu Chuẩn Kết Luận Khoa Học

Dựa trên kết quả từ `multiseed_benchmark_report.json`, ta chỉ kết luận **CNN vượt trội hơn MLP có ý nghĩa thống kê** khi:
1. **Khoảng tin cậy 95% của chênh lệch (Delta CNN - MLP) nằm hoàn toàn bên dương ($CI_{min} > 0$)**.
2. **Giá trị $p < 0.05$** (Bootstrap test hoặc paired t-test).
3. **Tính nhất quán trên các seed**: CNN vượt trội MLP trên ít nhất 2/3 seed độc lập.
