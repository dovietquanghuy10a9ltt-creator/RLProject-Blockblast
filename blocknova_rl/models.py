"""Custom PyTorch feature extractors for Block Nova RL agents."""
from __future__ import annotations

import torch
import torch.nn as nn
from gymnasium import spaces
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class BlockNovaCNNExtractor(BaseFeaturesExtractor):
    """2D Spatial Convolutional Feature Extractor for BlockNova-v0.

    Constructs a 4-channel 8x8 spatial tensor:
    - Channel 0: Current 8x8 board state (0 = empty, 1 = occupied)
    - Channel 1..3: Upcoming pieces (5x5 padded into 8x8), zeroed if unavailable

    Processes through:
    1. Multi-scale Conv2D stem (3x3 kernels)
    2. Dedicated geometric line detectors:
       - 1x8 horizontal kernel (captures completed or near-completed rows)
       - 8x1 vertical kernel (captures completed or near-completed columns)
       - 3x3 pocket kernel (detects contiguous open areas for big shapes)
    3. Auxiliary projection for hand availability and current combo
    """

    def __init__(self, observation_space: spaces.Dict, features_dim: int = 256):
        super().__init__(observation_space, features_dim)

        board_space = observation_space["board"]
        pieces_space = observation_space["pieces"]
        available_space = observation_space["available"]
        combo_space = observation_space["combo"]

        self.hand_size = pieces_space.shape[0]  # Typically 3
        in_channels = 1 + self.hand_size        # 1 board + hand_size pieces = 4

        # 1. 2D Convolutional Stem
        self.conv_stem = nn.Sequential(
            nn.Conv2d(in_channels, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
        )

        # 2. Specialized Line & Geometry Detectors
        # Horizontal row detector: kernel (1, 8) over 8x8 -> output (B, 32, 8, 1) -> 256 features
        self.line_h = nn.Sequential(
            nn.Conv2d(64, 32, kernel_size=(1, 8), stride=1),
            nn.ReLU(),
        )
        # Vertical column detector: kernel (8, 1) over 8x8 -> output (B, 32, 1, 8) -> 256 features
        self.line_v = nn.Sequential(
            nn.Conv2d(64, 32, kernel_size=(8, 1), stride=1),
            nn.ReLU(),
        )
        # Pocket / contiguous area detector: 3x3 over 8x8 -> output (B, 32, 8, 8) -> 2048 features
        self.pocket = nn.Sequential(
            nn.Conv2d(64, 32, kernel_size=3, padding=1),
            nn.ReLU(),
        )

        # 3. Spatial Flatten & Projection
        # Flattened dimensions:
        # stem: 64 * 8 * 8 = 4096
        # line_h: 32 * 8 * 1 = 256
        # line_v: 32 * 1 * 8 = 256
        # pocket: 32 * 8 * 8 = 2048
        # Total spatial = 4096 + 256 + 256 + 2048 = 6656
        total_spatial_dim = 6656
        self.spatial_fc = nn.Sequential(
            nn.Linear(total_spatial_dim, 256),
            nn.ReLU(),
        )

        # 4. Auxiliary scalar inputs (hand availability + combo)
        aux_dim = self.hand_size + combo_space.shape[0]  # 3 + 1 = 4
        self.aux_fc = nn.Sequential(
            nn.Linear(aux_dim, 16),
            nn.ReLU(),
        )

        # 5. Final joint projection
        self.out_fc = nn.Sequential(
            nn.Linear(256 + 16, features_dim),
            nn.ReLU(),
        )

    def forward(self, observations: dict[str, torch.Tensor]) -> torch.Tensor:
        # observations['board']: (B, 8, 8)
        # observations['pieces']: (B, hand_size, 5, 5)
        # observations['available']: (B, hand_size)
        # observations['combo']: (B, 1)
        board = observations["board"].float()
        pieces = observations["pieces"].float()
        available = observations["available"].float()
        combo = observations["combo"].float()

        batch_size = board.shape[0]

        # Ensure board has channel dimension: (B, 1, 8, 8)
        if board.dim() == 3:
            board_ch = board.unsqueeze(1)
        else:
            board_ch = board

        # Pad pieces from (B, hand_size, 5, 5) to (B, hand_size, 8, 8)
        # Center-pad or top-left pad: top-left pad (0..5) with 3 padding on right/bottom
        # F.pad format: (left, right, top, bottom)
        pieces_padded = nn.functional.pad(pieces, (0, 3, 0, 3), mode="constant", value=0.0)

        # Zero out pieces that are already placed / unavailable
        # available: (B, hand_size) -> (B, hand_size, 1, 1)
        available_mask = available.view(batch_size, self.hand_size, 1, 1)
        pieces_ch = pieces_padded * available_mask

        # Concat along channel dimension: (B, 1 + hand_size, 8, 8)
        spatial_tensor = torch.cat([board_ch, pieces_ch], dim=1)

        # Forward through CNN stem
        stem_out = self.conv_stem(spatial_tensor)  # (B, 64, 8, 8)

        # Multi-branch geometry detection
        feat_h = self.line_h(stem_out).flatten(1)       # (B, 256)
        feat_v = self.line_v(stem_out).flatten(1)       # (B, 256)
        feat_p = self.pocket(stem_out).flatten(1)       # (B, 2048)
        feat_s = stem_out.flatten(1)                    # (B, 4096)

        # Merge spatial features
        spatial_cat = torch.cat([feat_s, feat_h, feat_v, feat_p], dim=1)
        spatial_emb = self.spatial_fc(spatial_cat)      # (B, 256)

        # Merge auxiliary inputs
        aux_input = torch.cat([available, combo], dim=1)
        aux_emb = self.aux_fc(aux_input)                # (B, 16)

        # Final joint representation
        combined = torch.cat([spatial_emb, aux_emb], dim=1)
        return self.out_fc(combined)                    # (B, features_dim)
