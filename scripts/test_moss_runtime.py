"""Synthetic upstream-adapter tests. These are NOT full MOSS model training tests."""
import copy
import importlib
from pathlib import Path
import tempfile
import unittest

import moss_runtime
moss_runtime.isolate()
import torch
from safetensors.torch import save_file
from library.moss_image_models import MossImageBlock
from library import convrot_int8_utils as quant


class TinyMoss(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = torch.nn.ModuleList([MossImageBlock(256, 512, 4)])

    def forward(self, x):
        return self.layers[0].proj.q(x)


class AdapterTests(unittest.TestCase):
    def test_three_adapters_affect_forward_and_zero_strength_is_identity(self):
        for module in ['networks.lora_generic', 'networks.loha', 'networks.lokr']:
            for quantized in [False, True]:
                for full in ([False, True] if module.endswith('lokr') else [False]):
                    with self.subTest(module=module, quantized=quantized, full=full):
                        torch.manual_seed(0)
                        base = TinyMoss().to(dtype=torch.bfloat16).requires_grad_(False)
                        train_model = copy.deepcopy(base)
                        options = {'factor': 3, 'full_matrix': str(full).lower()} if module.endswith('lokr') else {}
                        net = importlib.import_module(module).create_network(1.0, 4, 4, None, [], train_model, **options)
                        net.apply_to([], train_model, False, True)
                        with torch.no_grad():
                            for parameter in net.parameters():
                                parameter.fill_(0.1)
                        weights = net.state_dict()
                        if quantized:
                            sd = base.state_dict()
                            for key in list(sd):
                                if key.endswith('.weight') and '.proj.' in key:
                                    q, scale, group = quant.quantize_weight_convrot(key, sd[key])
                                    sd[key] = q; sd[key[:-len('weight')] + 'scale_weight'] = scale
                            quant.apply_convrot_int8_monkey_patch(base, sd)
                            base.load_state_dict(sd, assign=True)
                        x = torch.ones(1, 2, 256, dtype=torch.bfloat16)
                        before = base(x).detach()
                        original = base.layers[0].proj.q.weight.clone()
                        with tempfile.TemporaryDirectory(prefix='moss-adapter-') as directory:
                            file = str(Path(directory) / 'adapter.safetensors')
                            save_file({k: v.contiguous() for k, v in weights.items()}, file)
                            attached = moss_runtime.attach_adapter(base, module, file, 0, torch.device('cpu'), {'factor': 3} if module.endswith('lokr') else {})
                            torch.testing.assert_close(base(x), before, atol=0, rtol=0)
                            for layer in attached.unet_loras:
                                layer.multiplier = 1
                            self.assertFalse(torch.equal(base(x), before), 'Adapter silently had no effect')
                            torch.testing.assert_close(base.layers[0].proj.q.weight, original, atol=0, rtol=0)
                            if quantized:
                                self.assertEqual(base.layers[0].proj.q.weight.dtype, torch.int8)

    def test_wrong_adapter_type_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            file = str(Path(directory) / 'wrong.safetensors')
            save_file({'lora_unet_layers_0_proj_q.hada_w1_a': torch.ones(2, 2)}, file)
            with self.assertRaisesRegex(ValueError, 'type'):
                moss_runtime.attach_adapter(TinyMoss(), 'networks.lora_generic', file, 1, torch.device('cpu'))


if __name__ == '__main__':
    unittest.main()
