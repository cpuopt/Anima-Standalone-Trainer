"""Project-side entrypoint. Never import the project's Anima library/networks."""
import argparse
import gc
import importlib
import json
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor' / 'sd-scripts'
REVISION = '11d8cedd0c67b93a10f8b2d75f43554f6f12c794'


def isolate():
    sys.path[:] = [str(VENDOR)] + [p for p in sys.path if p and Path(p).resolve() not in {ROOT, ROOT / 'scripts', VENDOR}]
    manifest = json.loads((ROOT / 'vendor' / 'SD_SCRIPTS_VERSION.json').read_text('utf-8'))
    if manifest['revision'] != REVISION:
        raise RuntimeError('MOSS backend revision mismatch; reinstall the pinned backend')
    # Verify the exported source, not just its version label.
    runpy.run_path(str(ROOT / 'scripts' / 'setup_moss.py'))['verify_vendor']()
    for name in ('library', 'networks'):
        mod = importlib.import_module(name)
        locations = [mod.__file__] if mod.__file__ else list(mod.__path__)
        if not locations or any(not Path(p).resolve().is_relative_to(VENDOR) for p in locations):
            raise RuntimeError(f'Imported {name} outside pinned sd-scripts: {locations}')


def check(cuda=False):
    import torch
    import accelerate
    import diffusers
    import transformers
    import tensorboard
    import moss_image_train_network
    import moss_image_minimal_inference
    from transformers import Qwen3_5TextModel
    from networks import lora_generic, loha, lokr
    if cuda and (not torch.cuda.is_available() or not torch.cuda.is_bf16_supported()):
        raise RuntimeError('MOSS requires a CUDA GPU with BF16 support')
    print(json.dumps({'dependencies': True, 'cuda': torch.cuda.is_available(), 'torch': torch.__version__, 'revision': REVISION}))


def attach_adapter(model, module_name, file, multiplier, device, network_args=None):
    """Attach residual modules, never merge into a quantized base checkpoint."""
    import torch
    from safetensors.torch import load_file
    if module_name not in {'networks.lora_generic', 'networks.loha', 'networks.lokr'}:
        raise ValueError('Unsupported MOSS adapter module')
    weights = load_file(file, device='cpu')
    if not weights or any(not k.startswith('lora_unet_') for k in weights):
        raise ValueError('Expected a MOSS DiT-only adapter checkpoint')
    expected = {'networks.lora_generic': '.lora_down.', 'networks.loha': '.hada_w1_a', 'networks.lokr': '.lokr_w1'}[module_name]
    if not any(expected in key for key in weights):
        raise ValueError('Checkpoint adapter type does not match this MOSS job')
    module = importlib.import_module(module_name)
    kwargs = dict(network_args or {})
    network, state = module.create_network_from_weights(multiplier, file, None, [], model,
        weights_sd=weights, for_inference=True, **kwargs)
    if not network.unet_loras:
        raise ValueError('Adapter matched no MOSS modules')
    network.apply_to([], model, apply_text_encoder=False, apply_unet=True)
    info = network.load_state_dict(state, strict=True)
    network.to(device=device, dtype=torch.bfloat16).eval().requires_grad_(False)
    print(f'MOSS adapter attached: {module_name}, {len(network.unet_loras)} modules, strength={multiplier}, {info}')
    return network


def generate(spec):
    import torch
    import moss_image_minimal_inference as inference
    from library import moss_image_utils
    from library.device_utils import clean_memory_on_device
    device = torch.device('cuda')
    torch.cuda.reset_peak_memory_stats()
    args = argparse.Namespace(dit=spec['dit'], text_encoder=spec['text_encoder'], vae=spec['vae'],
        tokenizer_cache_dir=spec.get('tokenizer') or None, lora_weight=None, lora_multiplier=1.0,
        max_token_length=spec.get('moss_max_token_length', 4096), text_encoder_cpu=False,
        convrot_int8=spec.get('convrot_int8', False), convrot_int8_text_encoder=spec.get('convrot_int8_text_encoder', False),
        blocks_to_swap=spec.get('blocks_to_swap', 0), attn_mode='torch', device=device,
        uncond_skip_layers='22', flow_shift=spec['flow_shift'], save_path=spec['output'],
        output_type='images', no_metadata=False, prompt='', negative_prompt='')
    # Independent generation is a short-lived subprocess, never a persistent sampler.
    # Keep stages disjoint: GPU text encoding -> release TE -> DiT -> release DiT -> VAE.
    tokenizer = encoder = model = adapter = vae = None
    embeddings = positive = negative = latent = pixels = None
    cache, prompts, latents = {}, [], []
    try:
        tokenizer = moss_image_utils.load_tokenizer(args.tokenizer_cache_dir)
        print('MOSS standalone: encoding prompts on CUDA', flush=True)
        encoder = inference.load_text_encoder(args, device)
        for prompt in spec['prompts']:
            item = argparse.Namespace(**vars(args))
            item.prompt = prompt['prompt']; item.negative_prompt = prompt['negative_prompt']
            item.image_size = [prompt['height'], prompt['width']]
            item.seed = prompt['seed']; item.infer_steps = prompt['sample_steps']; item.guidance_scale = prompt['scale']
            inference.check_inputs(item)
            # Upstream returns CPU embeddings, so no GPU text tensors survive this stage.
            embeddings = inference.prepare_text_inputs(item, tokenizer, encoder, device, cache)
            prompts.append((item, embeddings))
        encoder = tokenizer = None
        cache.clear()
        gc.collect(); clean_memory_on_device(device)
        print('MOSS standalone: text encoder released; loading DiT', flush=True)
        model = inference.load_dit_model(args, device)
        if spec.get('network_weights'):
            adapter = attach_adapter(model, spec['network_module'], spec['network_weights'], spec['multiplier'], device, spec.get('network_args'))
        for item, (positive, negative) in prompts:
            latents.append(inference.generate_latents(item, model, positive, negative, device, item.seed).cpu())
        model = adapter = None
        gc.collect(); clean_memory_on_device(device)
        vae = inference.load_vae(args, 'cpu')
        for i, ((item, _), latent) in enumerate(zip(prompts, latents)):
            pixels = inference.decode_latents(vae, latent.to(device), device)
            output = inference.save_image(pixels, item, f'moss_{i:03d}')
            Path(output + '.json').write_text(json.dumps({'prompt': item.prompt, 'negative_prompt': item.negative_prompt,
                'seed': item.seed, 'width': item.image_size[1], 'height': item.image_size[0], 'steps': item.infer_steps,
                'cfg': item.guidance_scale, 'flow_shift': item.flow_shift, 'adapter': spec.get('network_weights'),
                'multiplier': spec['multiplier'], 'revision': REVISION}, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        encoder = tokenizer = model = adapter = vae = None
        embeddings = positive = negative = latent = pixels = None
        cache.clear(); prompts.clear(); latents.clear()
        gc.collect(); clean_memory_on_device(device)
        print('MOSS standalone: models released; CUDA cache cleared', flush=True)
    print(f'MOSS peak CUDA allocated: {torch.cuda.max_memory_allocated() / 2**20:.0f} MiB')


def main():
    action = sys.argv[1]
    isolate()
    if action in {'check', 'preflight'}:
        check(cuda=action == 'preflight')
    elif action == 'train':
        sys.argv = [str(VENDOR / 'moss_image_train_network.py')] + sys.argv[2:]
        runpy.run_path(sys.argv[0], run_name='__main__')
    elif action == 'generate':
        parser = argparse.ArgumentParser(); parser.add_argument('--spec', required=True)
        args = parser.parse_args(sys.argv[2:])
        generate(json.loads(Path(args.spec).read_text('utf-8')))
    else:
        raise ValueError(f'Unknown MOSS action: {action}')


if __name__ == '__main__':
    main()
