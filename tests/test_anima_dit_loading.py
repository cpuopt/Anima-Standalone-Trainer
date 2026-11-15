import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import torch
from safetensors.torch import save_file

from library import anima_models, anima_utils


class AnimaDiTLoadingTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(
            max_img_h=8, max_img_w=8, max_frames=2,
            in_channels=16, out_channels=16, patch_spatial=2,
            patch_temporal=1, model_channels=48, num_blocks=1,
            num_heads=4, crossattn_emb_channels=32, pos_emb_cls="rope3d",
            rope_enable_fps_modulation=False,
        )
        torch.manual_seed(123)
        self.reference = anima_models.MiniTrainDIT(**self.config).eval()
        # The default output projection is zero; use nonzero weights so a
        # forward comparison can actually catch a loading/buffer regression.
        with torch.no_grad():
            for parameter in self.reference.parameters():
                parameter.uniform_(-0.1, 0.1)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "dit.safetensors")

    def load(self, state, **kwargs):
        save_file(state, self.path)
        with patch.object(anima_models, "get_dit_config", return_value=self.config.copy()):
            return anima_utils.load_anima_dit(self.path, torch.float32, **kwargs).eval()

    def test_checkpoint_without_rope_buffers_matches_forward(self):
        state = {"net." + k: v for k, v in self.reference.state_dict().items()
                 if not k.startswith("pos_embedder.")}
        # Even an environment requesting meta buffers must not destroy RoPE.
        with patch.dict("os.environ", {"ACCELERATE_INIT_INCLUDE_BUFFERS": "true"}):
            loaded = self.load(state)
        for name, expected in self.reference.named_parameters():
            torch.testing.assert_close(dict(loaded.named_parameters())[name], expected)
        for name, expected in self.reference.named_buffers():
            actual = dict(loaded.named_buffers())[name]
            self.assertFalse(actual.is_meta, name)
            torch.testing.assert_close(actual, expected)
        x = torch.randn(1, 16, 1, 4, 4)
        time = torch.ones(1, 1)
        context = torch.randn(1, 3, 32)
        mask = torch.zeros(1, 1, 4, 4)
        with torch.no_grad():
            torch.testing.assert_close(loaded(x, time, context, padding_mask=mask),
                                       self.reference(x, time, context, padding_mask=mask))

    def test_separate_transformer_dtype_and_no_mmap(self):
        loaded = self.load(self.reference.state_dict(), transformer_dtype=torch.bfloat16, disable_mmap=True)
        for name, parameter in loaded.named_parameters():
            high_precision = parameter.ndim == 1 or any(k in name for k in anima_utils.KEEP_IN_HIGH_PRECISION)
            self.assertEqual(parameter.dtype, torch.float32 if high_precision else torch.bfloat16, name)
            self.assertFalse(parameter.is_meta, name)

    def test_missing_parameter_reports_checkpoint_error(self):
        state = self.reference.state_dict()
        del state["blocks.0.self_attn.q_proj.weight"]
        with self.assertRaisesRegex(ValueError, "missing model parameters.*blocks.0.self_attn.q_proj.weight"):
            self.load(state)


if __name__ == "__main__":
    unittest.main()
