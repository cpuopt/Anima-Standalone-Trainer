import copy
import json
import os
import tempfile
import unittest

import torch
from networks import lora_anima, loha, lokr
from networks.layer_configs import LayerConfigs


class Block(torch.nn.Module):
    def __init__(self):
        super().__init__()
        for kind in ("self_attn", "cross_attn"):
            attn = torch.nn.Module()
            for name in ("q_proj", "k_proj", "v_proj", "output_proj"):
                setattr(attn, name, torch.nn.Linear(64, 64, bias=False))
            setattr(self, kind, attn)
        self.mlp = torch.nn.Sequential(torch.nn.Linear(64, 128), torch.nn.Linear(128, 64))
        self.adaln_modulation_self_attn = torch.nn.Sequential(torch.nn.SiLU(), torch.nn.Linear(64, 64))


class PatchEmbed(torch.nn.Module):
    pass


class FinalLayer(torch.nn.Module):
    pass


class TinyAnima(torch.nn.Module):
    def __init__(self, count=2):
        super().__init__()
        self.blocks = torch.nn.ModuleList([Block() for _ in range(count)])
        self.patch = PatchEmbed()
        self.final_layer = FinalLayer()


def settings(**overrides):
    return dict(version=1, mode="layer", default_rank=2, default_factor=4, **overrides)


class LayerConfigTests(unittest.TestCase):
    def test_all_networks_rank_alpha_and_disabled_layers(self):
        data = settings(types={"cross_attn": {"enabled": False}, "modulation": {"rank": 3}},
                        layers={"blocks.0.self_attn.q_proj": {"rank": 3, "alpha": 1.5}})
        for module, extra in ((lora_anima, {}), (loha, {}), (lokr, {}), (lokr, {"use_dora": "true"})):
            with self.subTest(module=module.__name__, extra=extra):
                model = TinyAnima()
                net = module.create_network(1, 9, 9, None, [], model, layer_configs=json.dumps(data), **extra)
                entries = {m.lora_name: m for m in net.unet_loras}
                self.assertEqual(len(entries), 14)
                selected = entries["lora_unet_blocks_0_self_attn_q_proj"]
                self.assertEqual(selected.lora_dim, 3)
                self.assertAlmostEqual(float(selected.alpha), 1.5)
                ordinary = entries["lora_unet_blocks_1_self_attn_q_proj"]
                self.assertEqual(ordinary.lora_dim, 2)
                self.assertEqual(float(ordinary.alpha), 2)
                modulation = entries["lora_unet_blocks_0_adaln_modulation_self_attn_1"]
                self.assertEqual(modulation.lora_dim, 3)

    def test_lokr_factors_full_matrix_and_checkpoint_roundtrip(self):
        for dora in (False, True):
            for full in (False, True):
                for extension in (".pt", ".safetensors"):
                    with self.subTest(dora=dora, full=full, extension=extension):
                        model = TinyAnima(1)
                        clone = copy.deepcopy(model)
                        data = settings(layers={"blocks.0.self_attn.q_proj": {"factor": 2, "rank": 3, "alpha": 1.5},
                                                "blocks.0.self_attn.k_proj": {"enabled": False}})
                        net = lokr.create_network(1, 2, 2, None, [], model, layer_configs=json.dumps(data),
                                                  use_dora=str(dora), full_matrix=str(full))
                        net.apply_to([], model)
                        with torch.no_grad():
                            for param in net.parameters():
                                param.add_(torch.randn_like(param) * 0.001)
                        expected = net.unet_loras[0].get_diff_weight().detach()
                        self.assertEqual(net.unet_loras[0].factor, 2)
                        with tempfile.TemporaryDirectory() as temp:
                            filename = os.path.join(temp, "adapter" + extension)
                            net.save_weights(filename, None, {})
                            restored, _ = lokr.create_network_from_weights(1, filename, None, [], clone)
                            restored.apply_to([], clone)
                            restored.load_weights(filename)
                            self.assertEqual(len(restored.unet_loras), len(net.unet_loras))
                            actual = restored.unet_loras[0].get_diff_weight().detach()
                            self.assertTrue(torch.allclose(expected, actual, atol=1e-6))
                            inputs = torch.randn(2, 64)
                            out = clone.blocks[0].self_attn.q_proj(inputs)
                            self.assertTrue(torch.allclose(model.blocks[0].self_attn.q_proj(inputs), out, atol=1e-5, rtol=1e-5))
                            out.sum().backward()
                            self.assertTrue(any(p.grad is not None for p in restored.parameters()))
                            if full:
                                self.assertTrue(all(m.use_w2 and m.scale == 1 for m in restored.unet_loras))

    def test_validation_and_block_counts(self):
        for count in (20, 28, 36):
            model = TinyAnima(count)
            self.assertEqual(len(LayerConfigs(settings(), model).names), count * 11)
        model = TinyAnima()
        invalid = [settings(default_rank_unused=1, layers={"blocks.99.self_attn.q_proj": {"rank": 2}}),
                   settings(layers={"blocks.0.self_attn.q_proj": {"rank": 0}}),
                   settings(types={"mlp": {"factor": 0}}), settings(types={"mlp": {"alpha": -1}})]
        for data in invalid:
            with self.assertRaises(ValueError):
                LayerConfigs(data, model, allow_factor=True)

    def test_legacy_default_modulation_exclusion_is_unchanged(self):
        plain = lokr.create_network(1, 2, 2, None, [], TinyAnima(1))
        self.assertFalse(any("adaln_modulation" in m.lora_name for m in plain.unet_loras))
        advanced = lokr.create_network(1, 2, 2, None, [], TinyAnima(1), layer_configs=json.dumps(settings()))
        self.assertTrue(any("adaln_modulation" in m.lora_name for m in advanced.unet_loras))

    def test_invalid_checkpoint_partition_fails_clearly(self):
        with self.assertRaisesRegex(ValueError, "incompatible checkpoint factorization"):
            lokr.LoKrModule("bad", torch.nn.Linear(64, 64), factorization_shape=(3, 3))


if __name__ == "__main__":
    unittest.main()
