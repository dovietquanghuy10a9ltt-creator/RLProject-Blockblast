"""Inspect the catalog, check Gymnasium, and play a legal random episode."""
import argparse
import time

import numpy as np
from gymnasium.utils.env_checker import check_env

from .common import add_env_arguments, env_kwargs
from .env import BlockNovaEnv


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_env_arguments(parser)
    parser.add_argument("--list-shapes", action="store_true")
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    with BlockNovaEnv(**env_kwargs(args), render_mode="ansi") as env:
        if args.list_shapes:
            enabled = set(env.game_spec["config"]["enabledShapeIds"])
            for index, shape in enumerate(env.game_spec["shapes"], start=1):
                cells = shape["cells"]
                height = max(row for row, _ in cells) + 1
                width = max(col for _, col in cells) + 1
                print(f"{index:2}. {shape['id']:16} {len(cells)} cells  {height}x{width}  {'enabled' if shape['id'] in enabled else 'disabled'}")
            print(f"Catalog: {len(env.game_spec['shapes'])} | Enabled: {len(enabled)} | Hand: {env.hand_size}")
        # Use a separate env so the checker does not change the episode below.
        with BlockNovaEnv(**env_kwargs(args)) as checked:
            check_env(checked, skip_render_check=True)
        print("Gymnasium check_env: OK")
        _, info = env.reset(seed=args.seed)
        rng = np.random.default_rng(args.seed)
        start = time.perf_counter()
        while True:
            valid = np.flatnonzero(env.action_masks())
            if not len(valid):
                break
            _, _, terminated, truncated, info = env.step(int(rng.choice(valid)))
            if args.render:
                print(env.render())
            if terminated or truncated:
                break
        elapsed = time.perf_counter() - start
        print(f"Score: {info['score']} | Moves: {info['moves']} | Lines: {info['lines']} | Seconds: {elapsed:.3f}")


if __name__ == "__main__":
    main()
