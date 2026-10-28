"""Shared command-line configuration and reproducible run metadata."""
import argparse
import json
from pathlib import Path

from .env import BlockNovaEnv


def add_env_arguments(parser: argparse.ArgumentParser):
    parser.add_argument("--hand-size", type=int, default=None, help="Pieces per hand, 1-9")
    pool = parser.add_mutually_exclusive_group()
    pool.add_argument("--shape-count", type=int, default=None, help="Use first N shapes from the catalog")
    pool.add_argument("--shapes", nargs="+", default=None, help="Exact shape IDs to enable")
    parser.add_argument("--max-steps", type=int, default=1000, help="Attempt limit per episode")
    parser.add_argument("--seed", type=int, default=42)


def env_kwargs(args):
    return {
        "hand_size": args.hand_size, "shape_count": args.shape_count,
        "enabled_shape_ids": args.shapes, "max_steps": args.max_steps,
    }


def frozen_env_kwargs(env: BlockNovaEnv):
    config = env.game_spec["config"]
    return {
        "hand_size": config["handSize"], "enabled_shape_ids": config["enabledShapeIds"],
        "shape_weights": config["shapeWeights"], "max_steps": env.max_steps,
        "reward_scale": env.reward_scale,
    }


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
