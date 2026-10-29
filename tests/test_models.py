"""Unit tests for Block Nova RL custom neural network models."""
import unittest

import torch
import gymnasium as gym

import blocknova_rl
from blocknova_rl.env import BlockNovaEnv
from blocknova_rl.models import BlockNovaCNNExtractor
from sb3_contrib import MaskablePPO


class TestBlockNovaCNNExtractor(unittest.TestCase):
    def setUp(self):
        self.env = BlockNovaEnv(hand_size=3, max_steps=10)
        self.extractor = BlockNovaCNNExtractor(self.env.observation_space, features_dim=256)

    def tearDown(self):
        self.env.close()

    def test_forward_output_shape(self):
        obs, _ = self.env.reset(seed=42)
        # Convert single observation to batch tensor (B=1)
        torch_obs = {
            k: torch.as_tensor(v).unsqueeze(0) for k, v in obs.items()
        }
        features = self.extractor(torch_obs)
        self.assertEqual(features.shape, (1, 256))

    def test_batch_forward_and_gradient_flow(self):
        batch_size = 4
        dummy_obs = {
            "board": torch.randint(0, 2, (batch_size, 8, 8), dtype=torch.int8),
            "pieces": torch.randint(0, 2, (batch_size, 3, 5, 5), dtype=torch.int8),
            "available": torch.ones((batch_size, 3), dtype=torch.int8),
            "combo": torch.zeros((batch_size, 1), dtype=torch.float32),
        }
        features = self.extractor(dummy_obs)
        self.assertEqual(features.shape, (batch_size, 256))

        # Backward test
        loss = features.sum()
        loss.backward()

        # Check gradients on conv stem, detectors, and heads
        for name, param in self.extractor.named_parameters():
            self.assertIsNotNone(param.grad, f"Gradient is None for parameter: {name}")
            self.assertTrue(torch.isfinite(param.grad).all(), f"Gradient has NaN/inf in {name}")

    def test_unavailable_piece_masking(self):
        # When available is 0, changing piece cells should NOT change the output features
        obs1 = {
            "board": torch.zeros((1, 8, 8)),
            "pieces": torch.zeros((1, 3, 5, 5)),
            "available": torch.zeros((1, 3)),  # All unavailable
            "combo": torch.zeros((1, 1)),
        }
        obs2 = {
            "board": torch.zeros((1, 8, 8)),
            "pieces": torch.ones((1, 3, 5, 5)),  # Changed to 1s
            "available": torch.zeros((1, 3)),  # But still unavailable
            "combo": torch.zeros((1, 1)),
        }
        with torch.no_grad():
            f1 = self.extractor(obs1)
            f2 = self.extractor(obs2)
        self.assertTrue(torch.allclose(f1, f2, atol=1e-5), "Unavailable pieces leaked into features")

    def test_maskable_ppo_initialization_with_cnn(self):
        # Verify SB3-contrib MaskablePPO accepts BlockNovaCNNExtractor seamlessly
        policy_kwargs = {
            "features_extractor_class": BlockNovaCNNExtractor,
            "features_extractor_kwargs": {"features_dim": 256},
            "net_arch": {"pi": [128], "vf": [128]},
        }
        model = MaskablePPO(
            "MultiInputPolicy",
            self.env,
            policy_kwargs=policy_kwargs,
            n_steps=16,
            batch_size=16,
            device="cpu",
        )
        obs, info = self.env.reset(seed=100)
        action, _ = model.predict(obs, deterministic=True, action_masks=self.env.action_masks())
        self.assertTrue(self.env.action_space.contains(action))


if __name__ == "__main__":
    unittest.main()
