"""Compare a saved policy with legal random actions on held-out seeds."""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from .common import write_json
from .env import BlockNovaEnv


def compute_detailed_stats(scores: list[int | float], moves: list[int | float], ci_level: float = 0.95) -> dict:
    """Calculate thorough statistical metrics including percentiles and bootstrap CI."""
    n = len(scores)
    if n == 0:
        return {}
    scores_arr = np.array(scores, dtype=float)
    moves_arr = np.array(moves, dtype=float)
    mean = float(np.mean(scores_arr))
    median = float(np.median(scores_arr))
    std = float(np.std(scores_arr, ddof=1)) if n > 1 else 0.0
    sem = float(std / math.sqrt(n)) if n > 1 else 0.0

    # Bootstrap 95% CI for the mean
    rng = np.random.default_rng(seed=42)
    boot_indices = rng.integers(0, n, size=(1000, n))
    boot_means = np.sort(np.mean(scores_arr[boot_indices], axis=1))
    alpha = (1.0 - ci_level) / 2.0
    ci_lo = float(boot_means[int(alpha * 1000)])
    ci_hi = float(boot_means[int((1.0 - alpha) * 1000)])

    p10 = float(np.percentile(scores_arr, 10))
    p25 = float(np.percentile(scores_arr, 25))
    p75 = float(np.percentile(scores_arr, 75))
    p90 = float(np.percentile(scores_arr, 90))
    p95 = float(np.percentile(scores_arr, 95))

    early_deaths = int(np.sum(moves_arr <= 14))
    long_games = int(np.sum(moves_arr >= 50))

    return {
        "n": n,
        "mean_score": mean,
        "median_score": median,
        "std_score": std,
        "sem_score": sem,
        "ci_95": [ci_lo, ci_hi],
        "min_score": float(np.min(scores_arr)),
        "max_score": float(np.max(scores_arr)),
        "p10": p10,
        "p25": p25,
        "p75": p75,
        "p90": p90,
        "p95": p95,
        "mean_moves": float(np.mean(moves_arr)),
        "early_death_count": early_deaths,
        "early_death_rate": float(early_deaths / n * 100.0),
        "long_game_count": long_games,
        "long_game_rate": float(long_games / n * 100.0),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, default=Path("outputs/ppo"))
    parser.add_argument("--checkpoint", default="final.zip", help="Relative to --run, e.g. best/best_model.zip")
    parser.add_argument("--episodes", type=int, default=20)
    parser.add_argument("--seed", type=int, default=100_000)
    parser.add_argument("--deterministic", action=argparse.BooleanOptionalAction, default=True,
                        help="Whether to sample deterministically (default: True)")
    parser.add_argument("--detailed", action="store_true",
                        help="Print and save detailed scientific statistics (percentiles, CI, early death)")
    args = parser.parse_args()

    if args.episodes < 1:
        parser.error("episodes must be positive")

    run_json = args.run / "run.json"
    if run_json.is_file():
        env_config = json.loads(run_json.read_text(encoding="utf-8"))["env"]
    elif (args.run / "comparison.json").is_file():
        env_config = json.loads((args.run / "comparison.json").read_text(encoding="utf-8"))["env"]
    else:
        parser.error(f"Neither run.json nor comparison.json found in {args.run}")

    model = MaskablePPO.load(args.run / args.checkpoint, device="cpu")
    report = {
        "seed": args.seed,
        "episodes": args.episodes,
        "checkpoint": args.checkpoint,
        "deterministic": args.deterministic,
        "env": env_config,
    }

    for name in ("random", "ppo"):
        rows = []
        with BlockNovaEnv(**env_config) as env:
            for episode in range(args.episodes):
                seed = args.seed + episode
                obs, info = env.reset(seed=seed)
                random = np.random.default_rng(seed)
                while True:
                    mask = env.action_masks()
                    if not mask.any():
                        break
                    if name == "random":
                        action = int(random.choice(np.flatnonzero(mask)))
                    else:
                        action, _ = model.predict(obs, deterministic=args.deterministic, action_masks=mask)
                    obs, _, terminated, truncated, info = env.step(int(action))
                    if terminated or truncated:
                        break
                rows.append({"seed": seed, **{key: info[key] for key in ("score", "moves", "lines")}})

        scores = [row["score"] for row in rows]
        moves = [row["moves"] for row in rows]

        if args.detailed:
            stats = compute_detailed_stats(scores, moves)
            report[name] = {"summary": stats, "episodes": rows}
            print(f"\n=== Detailed Evaluation: {name.upper()} (n={len(scores)}, deterministic={args.deterministic}) ===")
            print(f"  Mean Score:    {stats['mean_score']:.1f} (SEM: {stats['sem_score']:.1f}) | 95% CI: [{stats['ci_95'][0]:.1f}, {stats['ci_95'][1]:.1f}]")
            print(f"  Median Score:  {stats['median_score']:.1f} | Std: {stats['std_score']:.1f}")
            print(f"  Percentiles:   P10={stats['p10']:.0f} | P25={stats['p25']:.0f} | P75={stats['p75']:.0f} | P90={stats['p90']:.0f} | P95={stats['p95']:.0f}")
            print(f"  Range:         Min={stats['min_score']:.0f} | Max={stats['max_score']:.0f}")
            print(f"  Game Length:   Mean moves={stats['mean_moves']:.1f} | Early deaths (<=14): {stats['early_death_rate']:.1f}% | Long (>=50): {stats['long_game_rate']:.1f}%")
        else:
            summary = {
                "mean_score": float(np.mean(scores)),
                "median_score": float(np.median(scores)),
                "std_score": float(np.std(scores, ddof=1)) if len(scores) > 1 else 0.0,
                "mean_moves": float(np.mean(moves)),
            }
            report[name] = {"summary": summary, "episodes": rows}
            print(f"{name}: {summary}")

    write_json(args.run / "comparison.json", report)


if __name__ == "__main__":
    main()
