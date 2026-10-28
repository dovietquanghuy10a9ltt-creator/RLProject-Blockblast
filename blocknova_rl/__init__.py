"""Import this package before calling gymnasium.make('BlockNova-v0')."""
from gymnasium.envs.registration import register, registry

from .env import BlockNovaEnv

if "BlockNova-v0" not in registry:
    register(id="BlockNova-v0", entry_point="blocknova_rl:BlockNovaEnv")

__all__ = ["BlockNovaEnv"]
