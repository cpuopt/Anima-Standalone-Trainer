"""CPU integration checks on a tiny Krea2; no downloaded model weights required.

Exercises the real DiT, LoKR, Accelerate state and RAW/Turbo loader/sampler.
The VAE is replaced only at the decode boundary; this does not validate image quality.
"""

import copy

import pytest
import torch
from accelerate import Accelerator
from safetensors.torch import load_file, save_file

from musubi_tuner.krea2 import krea2_sampling as sampling
from musubi_tuner.krea2.krea2_mmdit import SingleMMDiTConfig, SingleStreamDiT
from musubi_tuner.krea2.krea2_utils import load_krea2_dit, single_mmdit_large_wide
from musubi_tuner.networks import lokr


def model():
    torch.manual_seed(42)
    cfg = SingleMMDiTConfig(features=32, tdim=32, txtdim=32, heads=2, multiplier=1,
                           layers=2, patch=2, channels=4, bias=False, theta=1e3,
                           kvheads=None, txtlayers=1, txtheads=2, txtkvheads=2)
    return SingleStreamDiT(cfg, attn_mode="torch")


def inputs(dit):
    torch.manual_seed(123)
    noise = torch.randn(1, 4, 8, 8)
    txt = torch.randn(1, 3, 1, 32)
    txtmask = torch.ones(1, 3, dtype=torch.bool)
    img, pos, mask = sampling.prepare(noise, 3, dit.config.patch, txtmask)
    return dict(img=img, context=txt, t=torch.tensor([0.5]), pos=pos, mask=mask)


def attach(dit, **kwargs):
    dit.requires_grad_(False)
    network = lokr.create_arch_network(1, 1, 0.5, None, None, dit, **kwargs)
    network.apply_to(None, dit, apply_text_encoder=False, apply_unet=True)
    return network


def step(dit, network, optimizer, batch):
    optimizer.zero_grad()
    loss = (dit(**batch) - 0.25).square().mean()
    loss.backward()
    assert torch.isfinite(loss)
    assert any(p.grad is not None and p.grad.abs().sum() > 0 for p in network.parameters())
    optimizer.step()
    return loss.detach()


@pytest.mark.parametrize("factor,full", [(-1, False), (4, False), (4, True)])
def test_train_save_reconstruct_and_resume(tmp_path, factor, full):
    dit = model()
    base = copy.deepcopy(dit.state_dict())
    expected = {"lora_unet_" + name.replace(".", "_") for name, layer in dit.named_modules()
                if isinstance(layer, torch.nn.Linear)}
    batch = inputs(dit)
    initial = dit(**batch).detach()
    network = attach(dit, factor=str(factor), full_matrix=str(full))
    assert {layer.lora_name for layer in network.unet_loras} == expected
    torch.testing.assert_close(dit(**batch), initial)
    if full:
        assert all(layer.use_w2 and layer.scale == 1 for layer in network.unet_loras)
    else:
        assert any(not layer.use_w2 for layer in network.unet_loras)
    dit.train().enable_gradient_checkpointing()
    optimizer = torch.optim.AdamW(network.parameters(), lr=1e-3)
    accelerator = Accelerator(cpu=True)
    network, optimizer = accelerator.prepare(network, optimizer)
    step(dit, network, optimizer, batch)
    assert all(p.grad is None for p in dit.parameters())
    trained = dit(**batch).detach()
    assert not torch.equal(trained, initial)
    weights = tmp_path / "adapter.safetensors"
    network.save_weights(str(weights), torch.float32, {"ss_network_module": "musubi_tuner.networks.lokr"})
    checkpoint = load_file(str(weights))
    accelerator.save_state(str(tmp_path / "state"))
    expected_loss = step(dit, network, optimizer, batch)
    expected_weights = copy.deepcopy(network.state_dict())

    # Deliberately omit factor/rank/full_matrix: the saved shapes must suffice.
    restored_dit = model()
    restored_dit.load_state_dict(base)
    restored_dit.requires_grad_(False)
    restored = lokr.create_arch_network_from_weights(1, checkpoint, unet=restored_dit)
    restored.apply_to(None, restored_dit, apply_text_encoder=False, apply_unet=True)
    restored.load_state_dict(checkpoint, strict=True)
    torch.testing.assert_close(restored_dit(**batch), trained)
    restored_optimizer = torch.optim.AdamW(restored.parameters(), lr=1e-3)
    resumed_accelerator = Accelerator(cpu=True)
    restored, restored_optimizer = resumed_accelerator.prepare(restored, restored_optimizer)
    resumed_accelerator.load_state(str(tmp_path / "state"))
    actual_loss = step(restored_dit, restored, restored_optimizer, batch)
    torch.testing.assert_close(actual_loss, expected_loss)
    for key, value in restored.state_dict().items():
        torch.testing.assert_close(value, expected_weights[key])


class DecodeBoundary(torch.nn.Module):
    temperal_downsample = [False, True, True]
    z_dim = 4

    def decode_to_pixels(self, latent):
        self.latent = latent.detach().float()
        return latent[:, :3, 0].float().sigmoid()


@pytest.mark.parametrize("base", ["raw", "turbo"])
@pytest.mark.parametrize("full", [False, True])
def test_training_preview_and_saved_adapter_loader_sample_equivalence(tmp_path, base, full):
    dit = model().eval()
    # Different checkpoint weights exercise application to RAW and a separate Turbo base.
    if base == "turbo":
        with torch.no_grad():
            for parameter in dit.parameters():
                parameter.mul_(0.9)
    config = dit.config
    original = copy.deepcopy(dit.state_dict())
    base_path = tmp_path / f"{base}.safetensors"
    save_file(original, str(base_path))
    network = attach(dit, factor="4", full_matrix=str(full))
    with torch.no_grad():
        for layer in network.unet_loras:
            torch.nn.init.normal_(layer.lokr_w2 if layer.use_w2 else layer.lokr_w2_b, std=0.05)
    network.eval()
    live_weights = copy.deepcopy(network.state_dict())
    weights = tmp_path / "lokr.safetensors"
    network.save_weights(str(weights), torch.float32, {})
    state = load_file(str(weights))
    merged = load_krea2_dit(str(base_path), device="cpu", dtype=torch.float32, config=config,
                            lora_weights=[state], lora_multipliers=[1.0]).eval()
    torch.testing.assert_close(dit(**inputs(dit)), merged(**inputs(merged)), atol=2e-5, rtol=2e-5)
    batch = inputs(dit)
    txt = batch["context"]
    mask = torch.ones(1, txt.shape[1], dtype=torch.bool)
    options = dict(device="cpu", dtype=torch.bfloat16, width=64, height=64, steps=2,
                   cfg_scale=3.5 if base == "raw" else 1, mu=None if base == "raw" else 1.15,
                   untxt=torch.zeros_like(txt), untxtmask=mask, seed=0)
    preview_vae, saved_vae = DecodeBoundary(), DecodeBoundary()
    sampling.sample(dit, preview_vae, txt, mask, **options)
    sampling.sample(merged, saved_vae, txt, mask, **options)
    assert torch.isfinite(saved_vae.latent).all()
    torch.testing.assert_close(preview_vae.latent, saved_vae.latent, atol=0.04, rtol=0.04)
    # Preview mode must keep the trained adapter and base intact for the next step.
    for key, value in dit.state_dict().items():
        torch.testing.assert_close(value, original[key])
    for key, value in network.state_dict().items():
        torch.testing.assert_close(value, live_weights[key])


def test_mixed_dtype_preview_4d_projector_and_dropout_reload():
    dit = model().to(torch.bfloat16)
    network = attach(dit, factor="4", neuron_dropout=0.1, rank_dropout="0.2", module_dropout="0.3")
    network.float().eval()
    batch = inputs(dit)
    for key in ["img", "context", "t"]:
        batch[key] = batch[key].to(torch.bfloat16)
    with torch.no_grad():
        result = dit(**batch)
    assert result.dtype == torch.bfloat16 and torch.isfinite(result).all()
    restored = lokr.create_arch_network_from_weights(1, network.state_dict(), unet=model(),
                neuron_dropout=0.1, rank_dropout="0.2", module_dropout="0.3")
    assert all(layer.dropout == 0.1 and layer.rank_dropout == 0.2 and layer.module_dropout == 0.3
               for layer in restored.unet_loras)


def test_filters_match_krea2_linear_names():
    dit = model()
    network = attach(dit, exclude_patterns="['.*']", include_patterns="[r'blocks\\.0\\.attn\\.wq']")
    assert [layer.lora_name for layer in network.unet_loras] == ["lora_unet_blocks_0_attn_wq"]


@pytest.mark.parametrize("full", [False, True])
def test_lokr_merges_before_dynamic_fp8_quantization(tmp_path, full):
    dit = model()
    base = copy.deepcopy(dit.state_dict())
    base_path = tmp_path / "base.safetensors"
    save_file(base, str(base_path))
    network = attach(dit, factor="4", full_matrix=str(full))
    with torch.no_grad():
        for layer in network.unet_loras:
            torch.nn.init.normal_(layer.lokr_w2 if layer.use_w2 else layer.lokr_w2_b, std=0.05)
    # Independently materialize a merged checkpoint, then quantize it without adapters.
    manual = copy.deepcopy(base)
    by_name = {"lora_unet_" + name[:-7].replace(".", "_"): name
               for name in base if name.endswith(".weight")}
    for layer in network.unet_loras:
        manual[by_name[layer.lora_name]] += 0.5 * layer.get_diff_weight().detach()
    manual_path = tmp_path / "merged.safetensors"
    save_file(manual, str(manual_path))
    actual = load_krea2_dit(str(base_path), config=dit.config, fp8_scaled=True,
                            lora_weights=[network.state_dict()], lora_multipliers=[0.5])
    expected = load_krea2_dit(str(manual_path), config=dit.config, fp8_scaled=True)
    assert any(value.dtype == torch.float8_e4m3fn for value in actual.state_dict().values())
    for key, value in actual.state_dict().items():
        torch.testing.assert_close(value.float(), expected.state_dict()[key].float())


def test_disable_and_zero_strength_leave_base_output():
    dit = model().eval()
    batch = inputs(dit)
    base = dit(**batch).detach()
    network = attach(dit, factor="4")
    with torch.no_grad():
        for layer in network.unet_loras:
            torch.nn.init.normal_(layer.lokr_w2 if layer.use_w2 else layer.lokr_w2_b)
    network.eval()
    assert not torch.equal(dit(**batch), base)
    network.set_enabled(False)
    torch.testing.assert_close(dit(**batch), base)
    network.set_enabled(True)
    network.set_multiplier(0)
    torch.testing.assert_close(dit(**batch), base)


def test_production_krea2_targets_all_264_linears_on_meta():
    with torch.device("meta"):
        dit = SingleStreamDiT(single_mmdit_large_wide, attn_mode="torch")
        network = attach(dit, factor="4")
    expected = {"lora_unet_" + name.replace(".", "_") for name, layer in dit.named_modules()
                if isinstance(layer, torch.nn.Linear)}
    assert len(expected) == 264
    assert {layer.lora_name for layer in network.unet_loras} == expected
