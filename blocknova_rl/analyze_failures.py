"""Analyze early deaths and terminal board states to diagnose failure modes."""
import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from .common import write_json
from .env import BlockNovaEnv


def count_isolated_empty_cells(board: list[list[int]]) -> int:
    """Count empty cells (0) that have no orthogonal empty neighbors."""
    isolated = 0
    for r in range(8):
        for c in range(8):
            if board[r][c] == 0:
                has_empty_neighbor = False
                for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < 8 and 0 <= nc < 8 and board[nr][nc] == 0:
                        has_empty_neighbor = True
                        break
                if not has_empty_neighbor:
                    isolated += 1
    return isolated


def analyze_run(
    run_dir: Path,
    checkpoint: str = "best/best_model.zip",
    episodes: int = 50,
    threshold: int = 14,
    start_seed: int = 100_000,
    deterministic: bool = True,
) -> dict:
    config = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    model = MaskablePPO.load(run_dir / checkpoint, device="cpu")

    all_episodes = []
    failed_episodes = []
    stuck_shapes_counter = Counter()

    with BlockNovaEnv(**config["env"]) as env:
        for ep in range(episodes):
            seed = start_seed + ep
            obs, info = env.reset(seed=seed)
            step_count = 0

            while True:
                mask = env.action_masks()
                if not mask.any():
                    break
                action, _ = model.predict(obs, deterministic=deterministic, action_masks=mask)
                obs, reward, terminated, truncated, info = env.step(int(action))
                step_count += 1
                if terminated or truncated:
                    break

            ep_record = {
                "seed": seed,
                "score": info["score"],
                "moves": info["moves"],
                "lines": info["lines"],
            }
            all_episodes.append(ep_record)

            if info["moves"] <= threshold:
                # Capture terminal board and hand details from raw env snapshot
                snapshot = env._state
                board_matrix = snapshot["board"]
                filled_cells = sum(row.count(1) for row in board_matrix)
                empty_cells = 64 - filled_cells
                isolated_holes = count_isolated_empty_cells(board_matrix)

                hand_shapes = []
                for piece in snapshot["hand"]:
                    if piece is not None:
                        hand_shapes.append(piece["shapeId"])
                        stuck_shapes_counter[piece["shapeId"]] += 1

                failed_episodes.append({
                    "seed": seed,
                    "score": info["score"],
                    "moves": info["moves"],
                    "lines": info["lines"],
                    "filled_cells": filled_cells,
                    "empty_cells": empty_cells,
                    "isolated_holes": isolated_holes,
                    "hand_shapes": hand_shapes,
                })

    n_fail = len(failed_episodes)
    summary = {
        "total_episodes": episodes,
        "early_death_threshold": threshold,
        "early_death_count": n_fail,
        "early_death_rate": (n_fail / episodes * 100.0) if episodes > 0 else 0.0,
        "mean_filled_at_failure": float(np.mean([f["filled_cells"] for f in failed_episodes])) if n_fail > 0 else 0.0,
        "mean_isolated_holes": float(np.mean([f["isolated_holes"] for f in failed_episodes])) if n_fail > 0 else 0.0,
        "most_common_stuck_shapes": stuck_shapes_counter.most_common(10),
    }

    report = {
        "summary": summary,
        "failed_episodes": failed_episodes,
        "all_episodes": all_episodes,
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, default=Path("outputs/cnn-full"))
    parser.add_argument("--checkpoint", default="best/best_model.zip")
    parser.add_argument("--episodes", type=int, default=50)
    parser.add_argument("--threshold", type=int, default=14, help="Moves threshold to classify early death")
    parser.add_argument("--seed", type=int, default=100_000)
    parser.add_argument("--deterministic", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--output", type=Path, default=None, help="Where to save failure_analysis.json")
    args = parser.parse_args()

    report = analyze_run(
        args.run,
        checkpoint=args.checkpoint,
        episodes=args.episodes,
        threshold=args.threshold,
        start_seed=args.seed,
        deterministic=args.deterministic,
    )

    s = report["summary"]
    print(f"\n=================== FAILURE MODE ANALYSIS ===================")
    print(f"Run:                  {args.run}")
    print(f"Total Episodes:       {s['total_episodes']}")
    print(f"Early Deaths (<= {s['early_death_threshold']} moves): {s['early_death_count']}/{s['total_episodes']} ({s['early_death_rate']:.1f}%)")
    if s["early_death_count"] > 0:
        print(f"Mean Filled Cells:    {s['mean_filled_at_failure']:.1f}/64 ({s['mean_filled_at_failure']/64*100:.1f}%)")
        print(f"Mean Isolated Holes:  {s['mean_isolated_holes']:.2f}")
        print("Top Stuck Shapes in Hand:")
        for shape_id, count in s["most_common_stuck_shapes"]:
            print(f"  - {shape_id:<16}: {count} times")
    print("=============================================================\n")

    out_file = args.output or (args.run / "failure_analysis.json")
    write_json(out_file, report)
    print(f"Saved failure report to {out_file.resolve()}")


if __name__ == "__main__":
    main()
