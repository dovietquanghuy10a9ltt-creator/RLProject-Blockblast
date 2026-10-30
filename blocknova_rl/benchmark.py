"""Scientific benchmark tool to compare multiple RL models side-by-side with statistical rigor."""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from .common import write_json
from .env import BlockNovaEnv
from .evaluate import compute_detailed_stats


def compute_paired_difference_ci(scores_a: list[float], scores_b: list[float], ci_level: float = 0.95) -> dict:
    """Compute statistics and bootstrap CI on paired seed-by-seed differences (B - A)."""
    n = len(scores_a)
    diffs = np.array(scores_b, dtype=float) - np.array(scores_a, dtype=float)
    mean_diff = float(np.mean(diffs))
    std_diff = float(np.std(diffs, ddof=1)) if n > 1 else 0.0
    sem_diff = float(std_diff / math.sqrt(n)) if n > 1 else 0.0

    # Bootstrap CI for mean difference
    rng = np.random.default_rng(seed=42)
    boot_indices = rng.integers(0, n, size=(2000, n))
    boot_means = np.sort(np.mean(diffs[boot_indices], axis=1))
    alpha = (1.0 - ci_level) / 2.0
    ci_lo = float(boot_means[int(alpha * 2000)])
    ci_hi = float(boot_means[int((1.0 - alpha) * 2000)])

    # Standard paired t-statistic
    t_stat = float(mean_diff / sem_diff) if sem_diff > 0 else 0.0
    # Two-sided empirical bootstrap p-value for mean_diff != 0
    p_boot = float(2.0 * min(np.mean(boot_means <= 0), np.mean(boot_means >= 0)))
    p_boot = min(1.0, max(0.0, p_boot))

    return {
        "mean_delta": mean_diff,
        "sem_delta": sem_diff,
        "ci_95": [ci_lo, ci_hi],
        "significant_p05": bool(ci_lo > 0 or ci_hi < 0),
        "t_stat": t_stat,
        "bootstrap_p_val": p_boot,
    }


def load_env_config(run_path: Path) -> dict:
    run_json = run_path / "run.json"
    if run_json.is_file():
        return json.loads(run_json.read_text(encoding="utf-8"))["env"]
    comp_json = run_path / "comparison.json"
    if comp_json.is_file():
        return json.loads(comp_json.read_text(encoding="utf-8"))["env"]
    raise FileNotFoundError(f"Neither run.json nor comparison.json found in {run_path}")


def evaluate_policy_on_seeds(
    run_path: Path,
    checkpoint: str,
    seeds: list[int],
    deterministic: bool = True,
) -> tuple[list[int], list[int], list[int]]:
    env_cfg = load_env_config(run_path)
    model = MaskablePPO.load(run_path / checkpoint, device="cpu")
    scores, moves, lines = [], [], []

    with BlockNovaEnv(**env_cfg) as env:
        for seed in seeds:
            obs, info = env.reset(seed=seed)
            while True:
                mask = env.action_masks()
                if not mask.any():
                    break
                action, _ = model.predict(obs, deterministic=deterministic, action_masks=mask)
                obs, _, term, trunc, info = env.step(int(action))
                if term or trunc:
                    break
            scores.append(info["score"])
            moves.append(info["moves"])
            lines.append(info["lines"])

    return scores, moves, lines


def evaluate_random_on_seeds(
    env_config: dict,
    seeds: list[int],
) -> tuple[list[int], list[int], list[int]]:
    scores, moves, lines = [], [], []
    with BlockNovaEnv(**env_config) as env:
        for seed in seeds:
            obs, info = env.reset(seed=seed)
            rng = np.random.default_rng(seed)
            while True:
                mask = env.action_masks()
                if not mask.any():
                    break
                action = int(rng.choice(np.flatnonzero(mask)))
                obs, _, term, trunc, info = env.step(action)
                if term or trunc:
                    break
            scores.append(info["score"])
            moves.append(info["moves"])
            lines.append(info["lines"])
    return scores, moves, lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="+", type=Path, required=True, help="List of run directories to compare")
    parser.add_argument("--checkpoint", default="best/best_model.zip", help="Checkpoint inside each run")
    parser.add_argument("--episodes", type=int, default=100, help="Number of held-out episodes")
    parser.add_argument("--seed", type=int, default=100_000, help="Base evaluation seed")
    parser.add_argument("--deterministic", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--output", type=Path, default=Path("benchmark_report.json"))
    args = parser.parse_args()

    seeds = [args.seed + i for i in range(args.episodes)]
    results = {}

    print(f"\n====================== BENCHMARK EVALUATION ======================")
    print(f"Episodes:      {args.episodes}")
    print(f"Seeds:         [{args.seed} .. {args.seed + args.episodes - 1}]")
    print(f"Deterministic: {args.deterministic}")
    print(f"Checkpoint:    {args.checkpoint}")
    print("------------------------------------------------------------------")

    # Evaluate baseline random using first run's env config
    first_run_config = load_env_config(args.runs[0])
    print("Evaluating: RANDOM baseline...")
    r_scores, r_moves, r_lines = evaluate_random_on_seeds(first_run_config, seeds)
    results["random"] = {
        "stats": compute_detailed_stats(r_scores, r_moves),
        "scores": r_scores,
        "moves": r_moves,
    }

    # Evaluate each run
    for run_path in args.runs:
        label = run_path.name
        print(f"Evaluating: {label} ({run_path})...")
        ckpt_path = run_path / args.checkpoint
        if not ckpt_path.is_file():
            # Fall back to final.zip if specified checkpoint does not exist
            if (run_path / "final.zip").is_file():
                ckpt_path = run_path / "final.zip"
                print(f"  (Note: using final.zip for {label})")
            else:
                print(f"  [ERROR] No checkpoint found in {run_path}")
                continue

        p_scores, p_moves, p_lines = evaluate_policy_on_seeds(
            run_path, str(ckpt_path.relative_to(run_path)), seeds, deterministic=args.deterministic
        )
        results[label] = {
            "stats": compute_detailed_stats(p_scores, p_moves),
            "scores": p_scores,
            "moves": p_moves,
        }

    # Print summary table
    print("\n------------------------- SUMMARY TABLE --------------------------")
    header = f"{'Model':<22} | {'Mean +/- SEM':<18} | {'Median':<8} | {'95% CI':<19} | {'Early Death':<12} | {'Long (>50)':<10}"
    print(header)
    print("-" * len(header))
    for name, data in results.items():
        st = data["stats"]
        mean_sem = f"{st['mean_score']:.1f} +/- {st['sem_score']:.1f}"
        ci_str = f"[{st['ci_95'][0]:.0f}, {st['ci_95'][1]:.0f}]"
        early_str = f"{st['early_death_rate']:.1f}%"
        long_str = f"{st['long_game_rate']:.1f}%"
        print(f"{name:<22} | {mean_sem:<18} | {st['median_score']:<8.0f} | {ci_str:<19} | {early_str:<12} | {long_str:<10}")

    # Pairwise statistical comparisons
    pairwise = {}
    model_names = [r.name for r in args.runs if r.name in results]
    if len(model_names) >= 2:
        print("\n----------------- PAIRWISE STATISTICAL COMPARISONS ---------------")
        for i in range(len(model_names)):
            for j in range(i + 1, len(model_names)):
                name_a, name_b = model_names[i], model_names[j]
                diff_stats = compute_paired_difference_ci(results[name_a]["scores"], results[name_b]["scores"])
                pair_key = f"{name_b}_vs_{name_a}"
                pairwise[pair_key] = diff_stats
                print(f"\nComparison: [{name_b}] minus [{name_a}] (n={args.episodes} identical seeds):")
                print(f"  Mean Delta:    {diff_stats['mean_delta']:+.1f} (SEM: {diff_stats['sem_delta']:.1f})")
                print(f"  95% CI Delta:  [{diff_stats['ci_95'][0]:+.1f}, {diff_stats['ci_95'][1]:+.1f}]")
                print(f"  Bootstrap p:   {diff_stats['bootstrap_p_val']:.4f}")
                sig_note = "YES (p < 0.05)" if diff_stats["significant_p05"] else "NO (95% CI contains 0)"
                print(f"  Significant?   {sig_note}")

    report = {
        "episodes": args.episodes,
        "base_seed": args.seed,
        "deterministic": args.deterministic,
        "models": {name: d["stats"] for name, d in results.items()},
        "pairwise": pairwise,
    }
    write_json(args.output, report)
    print(f"\nSaved benchmark report to {args.output.resolve()}\n")


if __name__ == "__main__":
    main()
