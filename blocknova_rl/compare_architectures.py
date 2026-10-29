"""Benchmark and compare RL architectures (e.g., MLP vs 2D Spatial CNN)."""
import argparse
import csv
import json
from pathlib import Path


def parse_monitor(csv_path: Path):
    if not csv_path.is_file():
        return None
    with open(csv_path, encoding="utf-8") as f:
        rows = [r for r in csv.reader(f) if len(r) >= 6 and not r[0].startswith("#")][1:]
    if not rows:
        return None
    scores = [int(r[3]) for r in rows if r[3].isdigit()]
    moves = [int(r[4]) for r in rows if r[4].isdigit()]
    lines = [int(r[5]) for r in rows if r[5].isdigit()]
    rewards = [float(r[0]) for r in rows]
    return {
        "episodes": len(scores),
        "scores": scores,
        "moves": moves,
        "lines": lines,
        "rewards": rewards,
    }


def compute_stats(data: dict):
    scores = data["scores"]
    moves = data["moves"]
    lines = data["lines"]
    n = len(scores)
    last_100 = scores[-100:] if n >= 100 else scores
    return {
        "total_episodes": n,
        "max_score": max(scores) if scores else 0,
        "mean_score": sum(scores) / n if n else 0,
        "last_100_mean": sum(last_100) / len(last_100) if last_100 else 0,
        "max_lines": max(lines) if lines else 0,
        "mean_moves": sum(moves) / n if n else 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="+", type=Path, required=True, help="List of run directories to compare")
    parser.add_argument("--labels", nargs="+", default=None, help="Display labels for runs")
    parser.add_argument("--plot", type=Path, default=None, help="Save comparison chart to PNG (requires matplotlib)")
    args = parser.parse_args()

    labels = args.labels or [p.name for p in args.runs]
    if len(labels) != len(args.runs):
        parser.error("Number of labels must match number of runs")

    results = {}
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("\n" + "=" * 80)
    print(f"{'Run / Architecture':<25} | {'Eps':<6} | {'Mean Score':<10} | {'Last 100 Mean':<14} | {'Max Score':<10} | {'Max Lines':<10}")
    print("-" * 80)

    for run_dir, label in zip(args.runs, labels):
        monitor_path = run_dir / "train.monitor.csv"
        data = parse_monitor(monitor_path)
        if not data:
            print(f"{label:<25} | [Không tìm thấy dữ liệu train.monitor.csv]")
            continue
        stats = compute_stats(data)
        results[label] = {"stats": stats, "data": data}
        print(f"{label:<25} | {stats['total_episodes']:<6} | {stats['mean_score']:<10.1f} | {stats['last_100_mean']:<16.1f} | {stats['max_score']:<8} | {stats['max_lines']:<8}")

    print("=" * 80 + "\n")

    # Optional plotting if matplotlib is present and --plot is requested
    if args.plot:
        try:
            import matplotlib.pyplot as plt
            fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), sharex=True)
            for label, item in results.items():
                scores = item["data"]["scores"]
                # Compute rolling average
                window = 100
                rolling = [sum(scores[max(0, i - window):i + 1]) / len(scores[max(0, i - window):i + 1]) for i in range(len(scores))]
                ax1.plot(rolling, label=f"{label} (Điểm lăn)")

                lines = item["data"]["lines"]
                rolling_lines = [sum(lines[max(0, i - window):i + 1]) / len(lines[max(0, i - window):i + 1]) for i in range(len(lines))]
                ax2.plot(rolling_lines, label=f"{label} (Hàng phá)")

            ax1.set_ylabel("Điểm số (Moving Avg 100)")
            ax1.set_title("So sánh đường cong huấn luyện Block Blast RL")
            ax1.grid(True, linestyle="--", alpha=0.6)
            ax1.legend()

            ax2.set_xlabel("Số ván (Episodes)")
            ax2.set_ylabel("Số hàng phá được")
            ax2.grid(True, linestyle="--", alpha=0.6)
            ax2.legend()

            plt.tight_layout()
            args.plot.parent.mkdir(parents=True, exist_ok=True)
            plt.savefig(args.plot, dpi=200)
            print(f"Đã lưu biểu đồ so sánh: {args.plot.resolve()}")
        except ImportError:
            print("[Lưu ý] Không tìm thấy matplotlib. Hãy cài `pip install matplotlib` nếu muốn xuất biểu đồ đồ họa PNG.")


if __name__ == "__main__":
    main()
