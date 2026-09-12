import os
import tempfile
import unittest

import torch

from networks import lokr


class Block(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = torch.nn.Linear(4, 6)
        self.fc2 = torch.nn.Linear(6, 4)

    def forward(self, x):
        return self.fc2(torch.relu(self.fc1(x)))


class PatchEmbed(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.proj = torch.nn.Linear(4, 4)

    def forward(self, x):
        return self.proj(x)


class FinalLayer(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.proj = torch.nn.Linear(4, 4)

    def forward(self, x):
        return self.proj(x)


class TinyAnima(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.blocks = torch.nn.ModuleList([Block()])
        self.patch = PatchEmbed()
        self.final_layer = FinalLayer()

    def forward(self, x):
        return self.patch(self.blocks[0](x))


class DoKrTests(unittest.TestCase):
    def test_full_matrix_switch_forces_full_w2_independent_of_rank(self):
        modules = [
            lokr.LoKrModule(
                f"test_{rank}",
                torch.nn.Linear(8, 8),
                lora_dim=rank,
                alpha=rank,
                factor=2,
                full_matrix=True,
            )
            for rank in (1, 3)
        ]

        for module in modules:
            self.assertTrue(module.full_matrix)
            self.assertTrue(module.use_w2)
            self.assertEqual((4, 4), tuple(module.lokr_w2.shape))
            self.assertFalse(hasattr(module, "lokr_w2_a"))
            self.assertFalse(hasattr(module, "lokr_w2_b"))
            self.assertEqual(1.0, module.scale)

    def test_create_network_accepts_full_matrix_with_dokr(self):
        model = TinyAnima()
        network = lokr.create_network(
            1.0,
            1,
            1,
            None,
            [],
            model,
            factor="2",
            full_matrix="true",
            use_dora="true",
        )

        self.assertTrue(network.unet_loras)
        for module in network.unet_loras:
            self.assertTrue(module.full_matrix)
            self.assertTrue(module.use_w2)
            self.assertTrue(hasattr(module, "lokr_w2"))
            self.assertTrue(hasattr(module, "dora_scale"))

    def test_plain_lokr_has_no_dora_scale(self):
        linear = torch.nn.Linear(4, 6)
        module = lokr.LoKrModule("test", linear, lora_dim=1, alpha=1, factor=-1)
        self.assertFalse(any(key.endswith("dora_scale") for key in module.state_dict()))

    def test_dokr_initial_forward_is_base_equivalent_and_has_gradients(self):
        torch.manual_seed(1)
        linear = torch.nn.Linear(4, 6)
        x = torch.randn(3, 4)
        expected = linear(x).detach().clone()
        module = lokr.LoKrModule(
            "test", linear, lora_dim=1, alpha=1, factor=-1, use_dora=True
        )
        module.apply_to()

        actual = linear(x)
        self.assertTrue(torch.allclose(actual, expected, atol=1e-6, rtol=1e-6))
        self.assertEqual((6, 1), tuple(module.dora_scale.shape))
        self.assertEqual(torch.float32, module.dora_scale.dtype)

        with torch.no_grad():
            module.lokr_w2_b.normal_(mean=0.0, std=0.1)
            module.dora_scale.mul_(1.05)
        linear(x).square().mean().backward()
        self.assertIsNotNone(module.dora_scale.grad)
        self.assertIsNotNone(module.lokr_w2_b.grad)
        self.assertGreater(module.dora_scale.grad.abs().sum().item(), 0.0)
        self.assertGreater(module.lokr_w2_b.grad.abs().sum().item(), 0.0)

    def test_dokr_multiplier_blends_from_base_to_effective_weight(self):
        torch.manual_seed(2)
        linear = torch.nn.Linear(4, 6)
        weight = linear.weight.detach().clone()
        bias = linear.bias.detach().clone()
        x = torch.randn(2, 4)
        module = lokr.LoKrModule(
            "test", linear, lora_dim=1, alpha=1, factor=-1, use_dora=True
        )
        module.apply_to()
        with torch.no_grad():
            module.lokr_w2_b.normal_(mean=0.0, std=0.1)
            module.dora_scale.mul_(1.1)

        diff = module.get_diff_weight().detach()
        merged = lokr._merge_dokr_weight(weight, diff, module.dora_scale.detach())
        for multiplier in (0.0, 0.5, 1.0):
            module.multiplier = multiplier
            expected_weight = weight + (merged - weight) * multiplier
            expected = torch.nn.functional.linear(x, expected_weight, bias)
            actual = linear(x)
            self.assertTrue(torch.allclose(actual, expected, atol=1e-5, rtol=1e-5))

    def test_dokr_rejects_conv2d(self):
        with self.assertRaisesRegex(ValueError, "ordinary Linear"):
            lokr.LoKrModule(
                "test", torch.nn.Conv2d(4, 4, 1), lora_dim=1, alpha=1, use_dora=True
            )

    def test_dokr_bfloat16_autocast_is_finite(self):
        linear = torch.nn.Linear(4, 6)
        module = lokr.LoKrModule(
            "test", linear, lora_dim=1, alpha=1, factor=-1, use_dora=True
        )
        module.apply_to()
        with torch.autocast("cpu", dtype=torch.bfloat16):
            output = linear(torch.randn(2, 4))
        self.assertEqual(torch.bfloat16, output.dtype)
        self.assertTrue(torch.isfinite(output).all())

    def test_raw_pt_checkpoint_round_trip_and_dim_from_weights(self):
        torch.manual_seed(3)
        model = TinyAnima()
        base_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        x = torch.randn(2, 4)
        network = lokr.create_network(1.0, 1, 1, None, [], model, use_dora="true")
        network.apply_to([], model)
        with torch.no_grad():
            for module in network.unet_loras:
                if hasattr(module, "lokr_w2_b"):
                    module.lokr_w2_b.normal_(mean=0.0, std=0.05)
                module.dora_scale.mul_(1.03)
        expected = model(x).detach().clone()

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "dokr.pt")
            network.save_weights(path, torch.float32, {})
            reloaded = TinyAnima()
            reloaded.load_state_dict(base_state)
            network2, _ = lokr.create_network_from_weights(1.0, path, None, [], reloaded)
            network2.apply_to([], reloaded)
            info = network2.load_weights(path)
            self.assertEqual([], info.unexpected_keys)
            actual_tensor = reloaded(x)
            actual = actual_tensor.detach()
            actual_tensor.square().mean().backward()
            self.assertTrue(
                all(module.dora_scale.grad is not None for module in network2.unet_loras)
            )

        self.assertTrue(network2.use_dora)
        self.assertTrue(torch.allclose(actual, expected, atol=1e-5, rtol=1e-5))

    def test_safetensors_is_comfy_compatible_and_reloadable(self):
        try:
            from safetensors import safe_open
            from safetensors.torch import load_file
        except ImportError:
            self.skipTest("safetensors is not installed")

        torch.manual_seed(4)
        model = TinyAnima()
        base_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
        x = torch.randn(2, 4)
        network = lokr.create_network(
            1.0,
            1,
            1,
            None,
            [],
            model,
            use_dora="true",
            dora_scale_fp32="true",
        )
        network.apply_to([], model)
        with torch.no_grad():
            for module in network.unet_loras:
                if hasattr(module, "lokr_w2_b"):
                    module.lokr_w2_b.normal_(mean=0.0, std=0.05)
                module.dora_scale.mul_(1.07)
        expected = model(x).detach().clone()

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "dokr.safetensors")
            network.save_weights(path, torch.bfloat16, {})
            saved = load_file(path)
            with safe_open(path, framework="pt") as handle:
                metadata = handle.metadata() or {}
            self.assertEqual("comfy_weight_norm", metadata.get("ss_dora_scale_format"))
            for key, value in saved.items():
                if key.endswith(".dora_scale") or key.endswith(".alpha"):
                    self.assertEqual(torch.float32, value.dtype, key)
                elif ".lokr_" in key:
                    self.assertEqual(torch.bfloat16, value.dtype, key)

            trained_module = network.unet_loras[0]
            prefix = trained_module.lora_name
            local_saved = {
                key[len(prefix) + 1 :]: value.to(torch.float32)
                for key, value in saved.items()
                if key.startswith(prefix + ".")
            }
            base_weight = trained_module.org_module_ref[0].weight.detach().to(torch.float32)
            saved_diff = lokr._rebuild_lokr_weight_from_state(local_saved, base_weight.shape)
            base_norm = lokr._weight_row_norm(base_weight)
            comfy_merged = (base_weight + saved_diff) * (
                local_saved["dora_scale"].reshape(base_norm.shape) / base_norm
            )
            raw_merged = lokr._merge_dokr_weight(
                base_weight, saved_diff, trained_module.dora_scale.detach()
            )
            self.assertTrue(
                torch.allclose(comfy_merged, raw_merged, atol=3e-3, rtol=3e-3)
            )

            reloaded = TinyAnima()
            reloaded.load_state_dict(base_state)
            network2, _ = lokr.create_network_from_weights(1.0, path, None, [], reloaded)
            network2.apply_to([], reloaded)
            info = network2.load_weights(path)
            self.assertEqual([], info.unexpected_keys)
            actual = reloaded(x).detach()

        self.assertTrue(torch.allclose(actual, expected, atol=3e-3, rtol=3e-3))

    def test_direct_merge_consumes_raw_and_comfy_dora_scale(self):
        torch.manual_seed(5)
        linear = torch.nn.Linear(4, 6, bias=False)
        module = lokr.LoKrModule(
            "test", linear, lora_dim=1, alpha=1, factor=-1, use_dora=True
        )
        module.apply_to()
        with torch.no_grad():
            module.lokr_w2_b.normal_(mean=0.0, std=0.1)
            module.dora_scale.mul_(1.04)
        local = module.state_dict()
        diff = module.get_diff_weight().detach()
        expected = lokr._merge_dokr_weight(
            linear.weight.detach(), diff, module.dora_scale.detach()
        )

        raw_sd = {f"test.{key}": value.detach().clone() for key, value in local.items()}
        raw_keys = set(raw_sd)
        raw_merged = lokr.merge_weights_to_tensor(
            linear.weight.detach().clone(), "test", raw_sd, raw_keys, 1.0, torch.device("cpu")
        )
        self.assertTrue(torch.allclose(raw_merged, expected, atol=1e-5, rtol=1e-5))
        self.assertFalse(raw_keys)

        comfy_sd = dict(raw_sd)
        comfy_sd["test.dora_scale"] = lokr._raw_dokr_scale_to_comfy(
            linear.weight.detach(), diff, module.dora_scale.detach()
        )
        comfy_keys = set(comfy_sd)
        comfy_merged = lokr.merge_weights_to_tensor(
            linear.weight.detach().clone(),
            "test",
            comfy_sd,
            comfy_keys,
            1.0,
            torch.device("cpu"),
            dora_scale_format="comfy_weight_norm",
        )
        self.assertTrue(torch.allclose(comfy_merged, expected, atol=1e-5, rtol=1e-5))
        self.assertFalse(comfy_keys)

        bf16_keys = set(raw_sd)
        bf16_merged = lokr.merge_weights_to_tensor(
            linear.weight.detach().to(torch.bfloat16),
            "test",
            raw_sd,
            bf16_keys,
            1.0,
            torch.device("cpu"),
        )
        self.assertEqual(torch.bfloat16, bf16_merged.dtype)


if __name__ == "__main__":
    unittest.main()
