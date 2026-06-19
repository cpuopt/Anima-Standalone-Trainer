import os
import tempfile
import unittest

import torch

from networks import lora_anima


class Block(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = torch.nn.Linear(4, 6)
        self.fc2 = torch.nn.Linear(6, 4)

    def forward(self, x):
        return self.fc2(torch.relu(self.fc1(x)))


class TinyAnima(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.blocks = torch.nn.ModuleList([Block()])

    def forward(self, x):
        return self.blocks[0](x)


class DoRALoRAAnimaTests(unittest.TestCase):
    def test_plain_lora_state_dict_does_not_get_dora_key(self):
        model = TinyAnima()
        network = lora_anima.create_network(1.0, 2, 2, None, [], model)
        network.apply_to([], model)

        keys = list(network.state_dict().keys())
        self.assertTrue(any(key.endswith("lora_down.weight") for key in keys))
        self.assertFalse(any("dora" in key.lower() for key in keys))
        self.assertFalse(any("magnitude" in key.lower() for key in keys))

    def test_dora_initial_forward_is_base_equivalent(self):
        torch.manual_seed(1)
        model = TinyAnima()
        x = torch.randn(3, 4)
        with torch.no_grad():
            expected = model(x).detach().clone()

        network = lora_anima.create_network(1.0, 2, 2, None, [], model, use_dora="true")
        network.apply_to([], model)

        with torch.no_grad():
            actual = model(x)
        self.assertTrue(torch.allclose(actual, expected, atol=1e-6, rtol=1e-6))

    def test_dora_save_load_uses_comfyui_dora_scale_key(self):
        try:
            from safetensors.torch import load_file
        except ImportError:
            self.skipTest("safetensors is not installed")

        torch.manual_seed(2)
        model = TinyAnima()
        base_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        x = torch.randn(2, 4)

        network = lora_anima.create_network(1.0, 2, 2, None, [], model, use_dora="true")
        network.apply_to([], model)
        with torch.no_grad():
            for module in network.unet_loras:
                module.lora_up.weight.normal_(mean=0.0, std=0.05)
                module.dora_scale.mul_(1.05)
        expected = model(x).detach().clone()

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "dora.safetensors")
            network.save_weights(path, torch.float32, {})
            sd = load_file(path)
            keys = list(sd.keys())
            dora_keys = [key for key in keys if key.endswith(".dora_scale")]
            self.assertTrue(dora_keys)
            self.assertFalse(any("magnitude" in key.lower() for key in keys))
            for key in dora_keys:
                self.assertEqual(2, sd[key].ndim)
                self.assertEqual(1, sd[key].shape[1])

            reloaded = TinyAnima()
            reloaded.load_state_dict(base_state)
            network2, _ = lora_anima.create_network_from_weights(1.0, path, None, [], reloaded)
            network2.apply_to([], reloaded)
            info = network2.load_weights(path)
            self.assertEqual([], info.unexpected_keys)
            with torch.no_grad():
                actual = reloaded(x)
            self.assertTrue(torch.allclose(actual, expected, atol=1e-6, rtol=1e-6))


if __name__ == "__main__":
    unittest.main()
