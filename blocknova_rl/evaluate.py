"""Compare a saved policy with legal random actions on held-out seeds."""
import argparse
import json
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from .common import write_json
from .env import BlockNovaEnv


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, default=Path("outputs/ppo"))
    parser.add_argument("--checkpoint", default="final.zip", help="Relative to --run, e.g. best/best_model.zip")
    parser.add_argument("--episodes", type=int, default=20)
    parser.add_argument("--seed", type=int, default=100_000)
    args = parser.parse_args()
    if args.episodes < 1:
        parser.error("episodes must be positive")
    config = json.loads((args.run / "run.json").read_text(encoding="utf-8"))
    model = MaskablePPO.load(args.run / args.checkpoint, device="cpu")
    report = {"seed": args.seed, "episodes": args.episodes, "checkpoint": args.checkpoint, "env": config["env"]}
    for name in ("random", "ppo"):
        rows = []
        with BlockNovaEnv(**config["env"]) as env:
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
                        action, _ = model.predict(obs, deterministic=True, action_masks=mask)
                    obs, _, terminated, truncated, info = env.step(int(action))
                    if terminated or truncated:
                        break
                rows.append({"seed": seed, **{key: info[key] for key in ("score", "moves", "lines")}})
        scores = [row["score"] for row in rows]
        summary = {"mean_score": float(np.mean(scores)), "median_score": float(np.median(scores)),
                   "std_score": float(np.std(scores)), "mean_moves": float(np.mean([row["moves"] for row in rows]))}
        report[name] = {"summary": summary, "episodes": rows}
        print(f"{name}: {summary}")
    write_json(args.run / "comparison.json", report)


if __name__ == "__main__":
    main()
