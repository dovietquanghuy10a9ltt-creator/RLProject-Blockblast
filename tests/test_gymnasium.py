"""Run with: .venv/Scripts/python -m unittest discover -s tests -p test_*.py"""
import unittest

import gymnasium as gym
import numpy as np
from gymnasium.utils.env_checker import check_env

import blocknova_rl
from blocknova_rl import BlockNovaEnv


class GymnasiumTests(unittest.TestCase):
    def test_api_and_registration(self):
        with BlockNovaEnv() as env:
            check_env(env, skip_render_check=True)
        with gym.make("BlockNova-v0", hand_size=4, shape_count=5) as env:
            obs, info = env.reset(seed=42)
            self.assertTrue(env.observation_space.contains(obs))
            self.assertEqual(env.action_space.n, 256)
            self.assertEqual(len(info["action_mask"]), 256)

    def test_seed_reproducibility_and_independent_instances(self):
        with BlockNovaEnv() as left, BlockNovaEnv() as right:
            lo, li = left.reset(seed=123)
            ro, ri = right.reset(seed=123)
            for _ in range(30):
                for key in lo:
                    np.testing.assert_array_equal(lo[key], ro[key])
                self.assertEqual(li["shape_ids"], ri["shape_ids"])
                np.testing.assert_array_equal(left.action_masks(), right.action_masks())
                action = int(np.flatnonzero(left.action_masks())[0])
                lo, lr, lt, lx, li = left.step(action)
                ro, rr, rt, rx, ri = right.step(action)
                self.assertEqual((lr, lt, lx), (rr, rt, rx))
                if lt or lx:
                    break

    def test_invalid_action_time_limit_and_reset(self):
        with BlockNovaEnv(enabled_shape_ids=["square3"], max_steps=2) as env:
            obs, _ = env.reset(seed=42)
            new_obs, reward, terminated, truncated, info = env.step(63)
            np.testing.assert_array_equal(obs["board"], new_obs["board"])
            self.assertEqual(reward, 0)
            self.assertFalse(terminated or truncated)
            self.assertTrue(info["invalid_action"])
            _, _, terminated, truncated, _ = env.step(63)
            self.assertFalse(terminated)
            self.assertTrue(truncated)
            with self.assertRaises(RuntimeError):
                env.step(0)
            env.reset(seed=42)
            with self.assertRaises(ValueError):
                env.step(env.action_space.n)

    def test_legal_rollout_score_and_pool(self):
        with BlockNovaEnv(hand_size=2, shape_count=5, max_steps=100, reward_scale=100) as env:
            _, info = env.reset(seed=42)
            score = 0
            for _ in range(100):
                self.assertTrue(set(filter(None, info["shape_ids"])) <= {"single", "domino-h", "domino-v", "line3-h", "line3-v"})
                action = int(np.flatnonzero(env.action_masks())[0])
                obs, reward, terminated, truncated, info = env.step(action)
                self.assertTrue(env.observation_space.contains(obs))
                self.assertFalse(info["invalid_action"])
                score += reward * 100
                self.assertAlmostEqual(score, info["score"])
                if terminated or truncated:
                    if terminated:
                        self.assertFalse(env.action_masks().any())
                    break

    def test_invalid_configuration_and_close(self):
        for kwargs in ({"hand_size": 0}, {"shape_count": 31}, {"enabled_shape_ids": []}, {"max_steps": 0}):
            with self.assertRaises(ValueError):
                BlockNovaEnv(**kwargs)
        env = BlockNovaEnv()
        process = env._process
        env.close()
        env.close()
        self.assertIsNotNone(process.poll())
        with self.assertRaises(RuntimeError):
            env.reset()

    def test_natural_game_over(self):
        with BlockNovaEnv(enabled_shape_ids=["square3"], hand_size=1) as env:
            env.reset(seed=8)
            for _ in range(4):
                action = int(np.flatnonzero(env.action_masks())[0])
                _, _, terminated, truncated, info = env.step(action)
            self.assertTrue(terminated)
            self.assertFalse(truncated)
            self.assertFalse(info["action_mask"].any())
            self.assertEqual(info["moves"], 4)


if __name__ == "__main__":
    unittest.main()
