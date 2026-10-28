"""Gymnasium adapter around the game's persistent Node.js process."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

ROOT = Path(__file__).resolve().parents[1]


class BlockNovaEnv(gym.Env):
    """Action = slot*64 + row*8 + col; reward = original score increment.

    Defaults come from src/block-config.js. Configuration overrides affect only
    this instance. max_steps is a collection time limit (truncated), not a loss.
    Install in editable mode from the game checkout: pip install -e '.[train]'.
    """

    metadata = {"render_modes": ["ansi"], "render_fps": 4}

    def __init__(
        self,
        *,
        hand_size: int | None = None,
        shape_count: int | None = None,
        enabled_shape_ids: list[str] | None = None,
        shape_weights: dict[str, float] | None = None,
        max_steps: int = 1000,
        reward_scale: float = 1.0,
        render_mode: str | None = None,
        node_executable: str | None = None,
    ):
        super().__init__()
        if render_mode not in (None, "ansi"):
            raise ValueError("render_mode must be None or 'ansi'")
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 1:
            raise ValueError("max_steps must be a positive integer")
        if not np.isfinite(reward_scale) or reward_scale <= 0:
            raise ValueError("reward_scale must be positive and finite")
        self.render_mode = render_mode
        self.max_steps = max_steps
        self.reward_scale = float(reward_scale)
        self._process = None
        self._state = None
        self._done = True
        self._attempts = 0
        config = {}
        if hand_size is not None:
            config["handSize"] = hand_size
        if shape_count is not None:
            config["shapeCount"] = shape_count
            config["enabledShapeIds"] = None
        if enabled_shape_ids is not None:
            config["enabledShapeIds"] = enabled_shape_ids
        if shape_weights is not None:
            config["shapeWeights"] = shape_weights
        executable = node_executable or shutil.which("node")
        if not executable:
            raise FileNotFoundError("Install Node.js >=20 or pass node_executable")
        bridge = ROOT / "rl" / "bridge.mjs"
        if not bridge.is_file():
            raise FileNotFoundError("Use pip install -e . from the Block Nova checkout; rl/bridge.mjs is required")
        self._process = subprocess.Popen(
            [executable, str(bridge)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            self.game_spec = self._request({"op": "init", "config": config})
            enabled = set(self.game_spec["config"]["enabledShapeIds"])
            if any(
                row >= 5 or col >= 5
                for shape in self.game_spec["shapes"] if shape["id"] in enabled
                for row, col in shape["cells"]
            ):
                raise ValueError("Enabled shapes exceed the 5x5 observation encoder; update the encoder before training")
        except Exception:
            self.close()
            raise
        self.hand_size = self.game_spec["config"]["handSize"]
        self.action_space = spaces.Discrete(self.hand_size * 64)
        self.observation_space = spaces.Dict({
            "board": spaces.MultiBinary((8, 8)),
            "pieces": spaces.MultiBinary((self.hand_size, 5, 5)),
            "available": spaces.MultiBinary(self.hand_size),
            "combo": spaces.Box(0, np.finfo(np.float32).max, shape=(1,), dtype=np.float32),
        })

    def _request(self, message: dict[str, Any]) -> dict[str, Any]:
        process = self._process
        if process is None:
            raise RuntimeError("Environment is closed")
        try:
            process.stdin.write(json.dumps(message, allow_nan=False) + "\n")
            process.stdin.flush()
            line = process.stdout.readline()
        except (OSError, BrokenPipeError) as exc:
            raise RuntimeError("Block Nova engine stopped unexpectedly") from exc
        if not line:
            detail = process.stderr.read() if process.poll() is not None else ""
            raise RuntimeError(f"Block Nova engine returned no response: {detail}")
        response = json.loads(line)
        if not response["ok"]:
            raise ValueError(response["error"])
        return response["result"]

    def _observation(self):
        pieces = np.zeros((self.hand_size, 5, 5), dtype=np.int8)
        available = np.zeros(self.hand_size, dtype=np.int8)
        for slot, piece in enumerate(self._state["hand"]):
            if piece:
                available[slot] = 1
                for row, col in piece["cells"]:
                    pieces[slot, row, col] = 1
        return {
            "board": np.asarray(self._state["board"], dtype=np.int8),
            "pieces": pieces,
            "available": available,
            "combo": np.asarray([self._state["combo"]], dtype=np.float32),
        }

    def _info(self):
        return {
            **{key: self._state[key] for key in ("score", "moves", "lines", "combo")},
            "attempts": self._attempts,
            "invalid_action": self._state.get("invalid_action", False),
            "action_mask": self.action_masks(),
            "shape_ids": [piece["shapeId"] if piece else None for piece in self._state["hand"]],
        }

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if options:
            raise ValueError("No reset options are supported; configure the environment in its constructor")
        engine_seed = int(self.np_random.integers(0, 2**32, dtype=np.uint64))
        self._state = self._request({"op": "reset", "seed": engine_seed})
        self._attempts = 0
        self._done = bool(self._state["terminated"])
        return self._observation(), self._info()

    def step(self, action):
        if self._done:
            raise RuntimeError("Call reset before stepping a new episode")
        if not self.action_space.contains(action):
            raise ValueError(f"Action must be in [0, {self.action_space.n - 1}]")
        self._state = self._request({"op": "step", "action": int(action)})
        self._attempts += 1
        terminated = bool(self._state["terminated"])
        truncated = self._attempts >= self.max_steps and not terminated
        self._done = terminated or truncated
        return (
            self._observation(), float(self._state["reward"]) / self.reward_scale,
            terminated, truncated, self._info(),
        )

    def action_masks(self):
        if self._state is None:
            raise RuntimeError("Call reset before requesting action masks")
        return np.asarray(self._state["action_mask"], dtype=bool).copy()

    def render(self):
        if self.render_mode != "ansi" or self._state is None:
            return None
        board = "\n".join(" ".join("#" if cell else "." for cell in row) for row in self._state["board"])
        hand = ", ".join(piece["shapeId"] if piece else "used" for piece in self._state["hand"])
        return f"{board}\nHand: {hand}\nScore: {self._state['score']} | Combo: {self._state['combo']}"

    def close(self):
        process = self._process
        if process is None:
            return
        self._process = None
        try:
            process.stdin.close()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
            process.wait(timeout=2)
        finally:
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()

    def __del__(self):
        if getattr(self, "_process", None) is not None:
            self.close()
