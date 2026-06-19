from safetensors.torch import load_file
import torch
import sys

path = sys.argv[1]

sd = load_file(path)

dora_keys = []
magnitude_keys = []

for k in sd.keys():
    kl = k.lower()

    if "dora_scale" in kl:
        dora_keys.append(k)

    if "magnitude" in kl:
        magnitude_keys.append(k)

print("=" * 60)
print("File:", path)
print("Tensor Count:", len(sd))
print("=" * 60)

if not dora_keys and not magnitude_keys:
    print("❌ NOT A DORA MODEL")
    exit()

print("✅ DORA DETECTED")

all_keys = dora_keys + magnitude_keys

print("DoRA Layers:", len(all_keys))
print()

for k in all_keys[:10]:
    print(k)

print()

all_values = []

for k in all_keys:
    v = sd[k].float().flatten()

    if len(v) > 0:
        all_values.append(v)

if len(all_values) == 0:
    print("❌ No magnitude tensors found")
    exit()

all_values = torch.cat(all_values)

mean = all_values.mean().item()
std = all_values.std().item()
vmin = all_values.min().item()
vmax = all_values.max().item()

print("Magnitude Statistics")
print("--------------------")
print(f"mean : {mean:.6f}")
print(f"std  : {std:.6f}")
print(f"min  : {vmin:.6f}")
print(f"max  : {vmax:.6f}")

print()

if std < 1e-5:
    print("⚠️ Magnitude almost constant")
    print("⚠️ DoRA may not have learned anything")

elif abs(mean - 1.0) < 0.001 and std < 0.01:
    print("⚠️ Magnitude very close to 1")
    print("⚠️ Looks similar to untrained DoRA")

else:
    print("✅ Magnitude learned successfully")

print()

# 检测LoRA部分
lora_up = len([k for k in sd if "lora_up" in k.lower()])
lora_down = len([k for k in sd if "lora_down" in k.lower()])

print("LoRA Layers")
print("-----------")
print("lora_up   :", lora_up)
print("lora_down :", lora_down)

if lora_up == 0 or lora_down == 0:
    print("❌ LoRA weights missing")
else:
    print("✅ LoRA weights present")