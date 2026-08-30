"""Small, dependency-free localization layer for user-facing training logs."""

from __future__ import annotations

import os
from typing import Dict


SUPPORTED_LANGUAGES = ("zh_CN", "en", "ja")
DEFAULT_LANGUAGE = "zh_CN"
LANGUAGE_ENV_VAR = "ANIMA_LOG_LANGUAGE"

_LANGUAGE_ALIASES = {
    "zh": "zh_CN",
    "zh_cn": "zh_CN",
    "zh-cn": "zh_CN",
    "cn": "zh_CN",
    "chinese": "zh_CN",
    "en": "en",
    "en_us": "en",
    "en-us": "en",
    "english": "en",
    "ja": "ja",
    "ja_jp": "ja",
    "ja-jp": "ja",
    "jp": "ja",
    "japanese": "ja",
}


def normalize_language(language: str | None) -> str:
    if language is None:
        return DEFAULT_LANGUAGE
    normalized = str(language).strip()
    if normalized in SUPPORTED_LANGUAGES:
        return normalized
    return _LANGUAGE_ALIASES.get(normalized.lower(), DEFAULT_LANGUAGE)


_current_language = normalize_language(os.environ.get(LANGUAGE_ENV_VAR))


def set_language(language: str | None) -> str:
    global _current_language
    _current_language = normalize_language(language)
    return _current_language


def get_language() -> str:
    return _current_language


MESSAGES: Dict[str, Dict[str, str]] = {
    "cache_latents_to_disk_enabled": {
        "zh_CN": "已启用 cache_latents_to_disk，因此同时启用 cache_latents",
        "en": "cache_latents_to_disk is enabled, so cache_latents is also enabled",
        "ja": "cache_latents_to_disk が有効なため、cache_latents も有効にします",
    },
    "loading_dataset_config": {
        "zh_CN": "正在加载数据集配置：{path}",
        "en": "Loading dataset config from {path}",
        "ja": "データセット設定を読み込んでいます：{path}",
    },
    "loading_settings": {
        "zh_CN": "正在加载训练设置：{path}",
        "en": "Loading settings from {path}...",
        "ja": "学習設定を読み込んでいます：{path}",
    },
    "ignoring_config_options": {
        "zh_CN": "检测到配置文件，忽略以下命令行选项：{options}",
        "en": "Ignoring the following options because a config file is used: {options}",
        "ja": "設定ファイルを使用するため、次のオプションを無視します：{options}",
    },
    "using_dreambooth": {
        "zh_CN": "使用 DreamBooth 数据集方式",
        "en": "Using DreamBooth method.",
        "ja": "DreamBooth 方式を使用します",
    },
    "training_with_captions": {
        "zh_CN": "使用 caption 进行训练",
        "en": "Training with captions.",
        "ja": "caption を使用して学習します",
    },
    "building_resolution_dataset": {
        "zh_CN": "[分辨率计划] 正在构建 {resolution}px 阶段的数据集",
        "en": "[resolution_schedule] building dataset for {resolution}px phase",
        "ja": "[解像度スケジュール] {resolution}px フェーズのデータセットを構築しています",
    },
    "preparing_accelerator": {
        "zh_CN": "正在准备 Accelerate 运行环境",
        "en": "Preparing accelerator",
        "ja": "Accelerate 実行環境を準備しています",
    },
    "no_training_data": {
        "zh_CN": "未找到训练数据。请确认数据集配置和图片目录是否正确",
        "en": "No training data found. Check the dataset configuration and image directories",
        "ja": "学習データが見つかりません。データセット設定と画像ディレクトリを確認してください",
    },
    "vae_dtype_from_model": {
        "zh_CN": "cast_vae=false，因此使用模型的 VAE dtype：{dtype}",
        "en": "cast_vae=false; using the model VAE dtype: {dtype}",
        "ja": "cast_vae=false のため、モデルの VAE dtype を使用します：{dtype}",
    },
    "caching_phase_latents": {
        "zh_CN": "[分辨率计划] 正在缓存阶段数据集的 latents（分辨率={resolution}）",
        "en": "[resolution_schedule] caching latents for phase dataset (resolution={resolution})",
        "ja": "[解像度スケジュール] フェーズデータセットの latents をキャッシュ中（解像度={resolution}）",
    },
    "import_network_module": {
        "zh_CN": "正在导入网络模块：{module}",
        "en": "Import network module: {module}",
        "ja": "ネットワークモジュールを読み込んでいます：{module}",
    },
    "load_network_weights": {
        "zh_CN": "已从 {path} 加载网络权重：{info}",
        "en": "Load network weights from {path}: {info}",
        "ja": "{path} からネットワーク重みを読み込みました：{info}",
    },
    "prepare_optimizer_data": {
        "zh_CN": "正在准备优化器、数据加载器和学习率调度器",
        "en": "Prepare optimizer, data loader, and scheduler",
        "ja": "オプティマイザ、データローダー、スケジューラを準備しています",
    },
    "scale_weight_norm_unsupported": {
        "zh_CN": "已指定 scale_weight_norms，但当前网络不支持；将禁用该选项",
        "en": "scale_weight_norms was specified but is unsupported by this network; disabling it",
        "ja": "scale_weight_norms が指定されましたが、このネットワークは未対応のため無効化します",
    },
    "training_start": {
        "zh_CN": "开始训练",
        "en": "Running training",
        "ja": "学習を開始します",
    },
    "train_images": {
        "zh_CN": "  训练图片数 × 重复次数：{count}",
        "en": "  Number of training images × repeats: {count}",
        "ja": "  学習画像の数 × 繰り返し回数：{count}",
    },
    "validation_images": {
        "zh_CN": "  验证图片数 × 重复次数：{count}",
        "en": "  Number of validation images × repeats: {count}",
        "ja": "  検証画像の数 × 繰り返し回数：{count}",
    },
    "reg_images": {
        "zh_CN": "  正则化图片数：{count}",
        "en": "  Number of regularization images: {count}",
        "ja": "  正則化画像の数：{count}",
    },
    "batches_per_epoch": {
        "zh_CN": "  每个 epoch 的批次数：{count}",
        "en": "  Number of batches per epoch: {count}",
        "ja": "  1 epoch のバッチ数：{count}",
    },
    "epochs": {
        "zh_CN": "  epoch 数：{count}",
        "en": "  Number of epochs: {count}",
        "ja": "  epoch 数：{count}",
    },
    "batch_sizes": {
        "zh_CN": "  每台设备的 batch size：{values}",
        "en": "  Batch size per device: {values}",
        "ja": "  デバイスごとのバッチサイズ：{values}",
    },
    "gradient_accumulation": {
        "zh_CN": "  梯度累积步数：{count}",
        "en": "  Gradient accumulation steps: {count}",
        "ja": "  勾配累積ステップ数：{count}",
    },
    "optimization_steps": {
        "zh_CN": "  总优化步数：{count}",
        "en": "  Total optimization steps: {count}",
        "ja": "  総最適化ステップ数：{count}",
    },
    "epoch_progress": {
        "zh_CN": "\nepoch {current}/{total}\n",
        "en": "\nepoch {current}/{total}\n",
        "ja": "\nepoch {current}/{total}\n",
    },
    "loading_image_sizes": {
        "zh_CN": "正在读取图片尺寸",
        "en": "Loading image sizes",
        "ja": "画像サイズを読み込んでいます",
    },
    "image_size_workers": {
        "zh_CN": "使用 {count} 个 worker 读取图片尺寸",
        "en": "Using {count} workers for image size loading",
        "ja": "{count} worker で画像サイズを読み込んでいます",
    },
    "loading_image_sizes_progress": {
        "zh_CN": "读取图片尺寸",
        "en": "Loading image sizes",
        "ja": "画像サイズを読み込み中",
    },
    "making_buckets": {
        "zh_CN": "正在创建 buckets",
        "en": "Making buckets",
        "ja": "bucket を作成しています",
    },
    "preparing_dataset": {
        "zh_CN": "正在准备数据集",
        "en": "Preparing dataset",
        "ja": "データセットを準備しています",
    },
    "bucket_no_upscale_ignores_limits": {
        "zh_CN": "启用 bucket_no_upscale 后，bucket 分辨率由图片尺寸自动决定，因此忽略 min_bucket_reso 和 max_bucket_reso",
        "en": "bucket_no_upscale determines bucket resolution from image sizes, so min_bucket_reso and max_bucket_reso are ignored",
        "ja": "bucket_no_upscale では画像サイズから bucket 解像度を決めるため、min_bucket_reso と max_bucket_reso は無視されます",
    },
    "bucket_image_counts": {
        "zh_CN": "各 bucket 的图片数（包含重复次数）",
        "en": "Number of images in each bucket (including repeats)",
        "ja": "各 bucket の画像枚数（繰り返し回数を含む）",
    },
    "bucket_summary": {
        "zh_CN": "bucket {index}：分辨率 {resolution}，数量 {count}",
        "en": "Bucket {index}: resolution {resolution}, count {count}",
        "ja": "bucket {index}：解像度 {resolution}、枚数 {count}",
    },
    "mean_aspect_ratio_error": {
        "zh_CN": "平均宽高比误差（不含重复）：{value}",
        "en": "Mean aspect-ratio error (without repeats): {value}",
        "ja": "平均アスペクト比誤差（繰り返しを除く）：{value}",
    },
    "found_images": {
        "zh_CN": "目录 {path} 中找到 {count} 张图片",
        "en": "Found {count} image files in directory {path}",
        "ja": "ディレクトリ {path} に {count} 枚の画像が見つかりました",
    },
    "caption_workers": {
        "zh_CN": "使用 {count} 个 worker 读取 captions",
        "en": "Using {count} workers for caption reading",
        "ja": "{count} worker で caption を読み込んでいます",
    },
    "reading_captions_progress": {
        "zh_CN": "读取 captions",
        "en": "Reading captions",
        "ja": "caption を読み込み中",
    },
    "missing_caption_for_image": {
        "zh_CN": "图片既没有 caption 文件也没有 class token，将使用空 caption：{path}",
        "en": "No caption file or class token was found; using an empty caption for {path}",
        "ja": "caption ファイルも class token もないため、空の caption を使用します：{path}",
    },
    "missing_captions_summary": {
        "zh_CN": "{count} 张图片没有 caption 文件；这些图片将继续训练，若存在 class token 则使用它",
        "en": "{count} images have no caption file; training will continue and class tokens will be used when available",
        "ja": "{count} 枚の画像に caption ファイルがありません。class token があれば使用して学習を続行します",
    },
    "preparing_images": {
        "zh_CN": "正在准备图片",
        "en": "Preparing images",
        "ja": "画像を準備しています",
    },
    "training_images_with_repeats": {
        "zh_CN": "{count} 张训练图片（包含重复次数）",
        "en": "{count} training images with repeats",
        "ja": "{count} 枚の学習画像（繰り返しを含む）",
    },
    "validation_images_with_repeats": {
        "zh_CN": "{count} 张验证图片（包含重复次数）",
        "en": "{count} validation images with repeats",
        "ja": "{count} 枚の検証画像（繰り返しを含む）",
    },
    "regularization_images_with_repeats": {
        "zh_CN": "{count} 张正则化图片（包含重复次数）",
        "en": "{count} regularization images with repeats",
        "ja": "{count} 枚の正則化画像（繰り返しを含む）",
    },
    "no_regularization_images": {
        "zh_CN": "未找到正则化图片",
        "en": "No regularization images were found",
        "ja": "正則化画像が見つかりませんでした",
    },
    "epoch_changed": {
        "zh_CN": "epoch 已更新：原值 {previous}，当前值 {current}",
        "en": "Epoch incremented: previous={previous}, current={current}",
        "ja": "epoch が更新されました：前回 {previous}、現在 {current}",
    },
    "epoch_not_incremented": {
        "zh_CN": "epoch 未递增：原值 {previous}，当前值 {current}",
        "en": "Epoch did not increment: previous={previous}, current={current}",
        "ja": "epoch が増加していません：前回 {previous}、現在 {current}",
    },
    "high_vram_enabled": {
        "zh_CN": "已启用 highvram",
        "en": "highvram is enabled",
        "ja": "highvram を有効化しました",
    },
    "v2_clip_skip_warning": {
        "zh_CN": "v2 与 clip_skip 同时使用可能产生非预期结果",
        "en": "Using clip_skip with v2 may produce unexpected results",
        "ja": "v2 で clip_skip を使用すると想定外の結果になる可能性があります",
    },
    "loading_qwen3": {
        "zh_CN": "正在加载 Qwen3 文本编码器",
        "en": "Loading Qwen3 text encoder",
        "ja": "Qwen3 テキストエンコーダーを読み込んでいます",
    },
    "loading_anima_dit": {
        "zh_CN": "正在加载 Anima DiT",
        "en": "Loading Anima DiT",
        "ja": "Anima DiT を読み込んでいます",
    },
    "loading_anima_vae": {
        "zh_CN": "正在加载 Anima VAE",
        "en": "Loading Anima VAE",
        "ja": "Anima VAE を読み込んでいます",
    },
    "block_swap_enabled": {
        "zh_CN": "启用 block swap：blocks_to_swap={count}",
        "en": "Enable block swap: blocks_to_swap={count}",
        "ja": "block swap を有効化：blocks_to_swap={count}",
    },
    "caption_dropout_migrated": {
        "zh_CN": "将 subset caption dropout（{rate}）迁移为 Anima 全局 embedding dropout",
        "en": "Migrating subset caption dropout ({rate}) to global embedding dropout for Anima",
        "ja": "subset caption dropout（{rate}）を Anima のグローバル embedding dropout に移行します",
    },
    "global_caption_dropout": {
        "zh_CN": "使用全局 embedding dropout：{rate}",
        "en": "Using global embedding-level caption dropout: {rate}",
        "ja": "グローバル embedding dropout を使用：{rate}",
    },
    "flash_attention_enabled": {
        "zh_CN": "DiT blocks 已启用 Flash Attention（{backend}）",
        "en": "Flash Attention enabled for DiT blocks ({backend})",
        "ja": "DiT blocks で Flash Attention を有効化しました（{backend}）",
    },
    "flash_attention_fallback": {
        "zh_CN": "未安装可用的 Flash Attention，回退到 PyTorch SDPA",
        "en": "Flash Attention is unavailable; falling back to PyTorch SDPA",
        "ja": "Flash Attention が利用できないため、PyTorch SDPA にフォールバックします",
    },
    "unsloth_enables_gradient_checkpointing": {
        "zh_CN": "已启用 unsloth_offload_checkpointing，因此同时启用 gradient_checkpointing",
        "en": "unsloth_offload_checkpointing is enabled, so gradient_checkpointing is also enabled",
        "ja": "unsloth_offload_checkpointing が有効なため、gradient_checkpointing も有効にします",
    },
    "cpu_offload_enables_gradient_checkpointing": {
        "zh_CN": "已启用 cpu_offload_checkpointing，因此同时启用 gradient_checkpointing",
        "en": "cpu_offload_checkpointing is enabled, so gradient_checkpointing is also enabled",
        "ja": "cpu_offload_checkpointing が有効なため、gradient_checkpointing も有効にします",
    },
    "cache_text_outputs_to_disk_enabled": {
        "zh_CN": "已启用 cache_text_encoder_outputs_to_disk，因此同时启用 cache_text_encoder_outputs",
        "en": "cache_text_encoder_outputs_to_disk is enabled, so cache_text_encoder_outputs is also enabled",
        "ja": "cache_text_encoder_outputs_to_disk が有効なため、cache_text_encoder_outputs も有効にします",
    },
    "loading_tokenizers": {
        "zh_CN": "正在加载 tokenizers",
        "en": "Loading tokenizers",
        "ja": "tokenizer を読み込んでいます",
    },
    "move_models_to_cpu": {
        "zh_CN": "将 VAE 和 DiT 移到 CPU 以节省显存",
        "en": "Moving VAE and DiT to CPU to save VRAM",
        "ja": "VRAM 節約のため VAE と DiT を CPU に移動します",
    },
    "move_text_encoder_to_gpu": {
        "zh_CN": "将文本编码器移到 GPU",
        "en": "Moving text encoder to GPU",
        "ja": "テキストエンコーダーを GPU に移動します",
    },
    "move_text_encoder_to_cpu": {
        "zh_CN": "将文本编码器移回 CPU",
        "en": "Moving text encoder back to CPU",
        "ja": "テキストエンコーダーを CPU に戻します",
    },
    "move_models_back": {
        "zh_CN": "将 VAE 和 DiT 移回原设备",
        "en": "Moving VAE and DiT back to their original devices",
        "ja": "VAE と DiT を元のデバイスに戻します",
    },
    "saving_checkpoint": {
        "zh_CN": "正在保存 checkpoint：{path}",
        "en": "Saving checkpoint: {path}",
        "ja": "checkpoint を保存しています：{path}",
    },
    "model_saved": {
        "zh_CN": "模型保存完成",
        "en": "Model saved",
        "ja": "モデルを保存しました",
    },
    "config_not_found": {
        "zh_CN": "找不到配置文件：{path}",
        "en": "Config file not found: {path}",
        "ja": "設定ファイルが見つかりません：{path}",
    },
    "config_saved": {
        "zh_CN": "配置文件已保存：{path}",
        "en": "Config file saved: {path}",
        "ja": "設定ファイルを保存しました：{path}",
    },
    "config_already_exists": {
        "zh_CN": "配置文件已存在，中止操作：{path}",
        "en": "Config file already exists; aborting: {path}",
        "ja": "設定ファイルが既に存在するため中止します：{path}",
    },
    "loading_model_from": {
        "zh_CN": "正在从 {path} 加载 {model}",
        "en": "Loading {model} from {path}",
        "ja": "{path} から {model} を読み込んでいます",
    },
    "model_loaded": {
        "zh_CN": "{model} 加载完成，参数量：{count}",
        "en": "{model} loaded successfully. Parameters: {count}",
        "ja": "{model} の読み込みが完了しました。パラメータ数：{count}",
    },
    "model_loaded_simple": {
        "zh_CN": "{model} 加载完成",
        "en": "{model} loaded successfully",
        "ja": "{model} の読み込みが完了しました",
    },
    "dit_config": {
        "zh_CN": "DiT 配置：model_channels={channels}，num_blocks={blocks}，num_heads={heads}，use_llm_adapter={adapter}",
        "en": "DiT config: model_channels={channels}, num_blocks={blocks}, num_heads={heads}, use_llm_adapter={adapter}",
        "ja": "DiT 設定：model_channels={channels}、num_blocks={blocks}、num_heads={heads}、use_llm_adapter={adapter}",
    },
    "checkpoint_missing_keys": {
        "zh_CN": "checkpoint 缺少以下键：{keys}",
        "en": "Missing keys in checkpoint: {keys}",
        "ja": "checkpoint に次のキーがありません：{keys}",
    },
    "checkpoint_unexpected_keys": {
        "zh_CN": "checkpoint 中以下未预期键已忽略：{keys}",
        "en": "Unexpected checkpoint keys were ignored: {keys}",
        "ja": "checkpoint の次の未使用キーを無視しました：{keys}",
    },
    "state_dict_loaded": {
        "zh_CN": "{model} state dict 加载结果：{info}",
        "en": "{model} state dict load result: {info}",
        "ja": "{model} state dict 読み込み結果：{info}",
    },
    "anima_model_saved": {
        "zh_CN": "Anima 模型已保存到 {path}",
        "en": "Anima model saved to {path}",
        "ja": "Anima モデルを {path} に保存しました",
    },
    "parameter_groups": {
        "zh_CN": "参数分组：",
        "en": "Parameter groups:",
        "ja": "パラメータグループ：",
    },
    "parameter_group": {
        "zh_CN": "  {name}：{count} 个参数（lr={lr}）",
        "en": "  {name}: {count} parameters (lr={lr})",
        "ja": "  {name}：{count} パラメータ（lr={lr}）",
    },
    "frozen_parameter_group": {
        "zh_CN": "  已冻结 {name}（{count} 个参数）",
        "en": "  Frozen {name} ({count} parameters)",
        "ja": "  {name} を凍結しました（{count} パラメータ）",
    },
    "total_trainable_parameters": {
        "zh_CN": "可训练参数总量：{count}",
        "en": "Total trainable parameters: {count}",
        "ja": "学習可能パラメータ総数：{count}",
    },
    "generating_samples": {
        "zh_CN": "[GPU {rank}] 正在第 {steps} 步生成采样图片",
        "en": "[GPU {rank}] Generating sample images at step {steps}",
        "ja": "[GPU {rank}] ステップ {steps} でサンプル画像を生成しています",
    },
    "no_prompt_file": {
        "zh_CN": "找不到 prompt 文件：{path}",
        "en": "Prompt file not found: {path}",
        "ja": "prompt ファイルが見つかりません：{path}",
    },
    "assigned_prompts": {
        "zh_CN": "[GPU {rank}] 分配到 {assigned}/{total} 条 prompts",
        "en": "[GPU {rank}] Assigned {assigned}/{total} prompts",
        "ja": "[GPU {rank}] {assigned}/{total} 件の prompt を割り当てました",
    },
    "no_assigned_prompts": {
        "zh_CN": "[GPU {rank}] 没有分配到 prompt（prompt 数少于 GPU 数），等待其他进程",
        "en": "[GPU {rank}] No prompts assigned (fewer prompts than GPUs); waiting",
        "ja": "[GPU {rank}] prompt が割り当てられていないため待機します",
    },
    "sample_prompt_summary": {
        "zh_CN": "  prompt：{prompt}，尺寸：{width}x{height}，步数：{steps}，CFG：{scale}",
        "en": "  Prompt: {prompt}, size: {width}x{height}, steps: {steps}, CFG: {scale}",
        "ja": "  prompt：{prompt}、サイズ：{width}x{height}、ステップ：{steps}、CFG：{scale}",
    },
    "cannot_encode_prompt": {
        "zh_CN": "无法编码 prompt，跳过本次采样",
        "en": "Cannot encode prompt; skipping this sample",
        "ja": "prompt をエンコードできないため、このサンプルをスキップします",
    },
    "disable_block_swap_for_sampling": {
        "zh_CN": "为加快采样，临时禁用 block swap",
        "en": "Temporarily disabling block swap for faster sampling",
        "ja": "サンプリング高速化のため block swap を一時的に無効化します",
    },
    "sampling_oom_fallback": {
        "zh_CN": "采样时显存不足，回退到 block swap",
        "en": "Sampling ran out of memory; falling back to block swap",
        "ja": "サンプリング中に OOM が発生したため block swap にフォールバックします",
    },
    "restore_block_swap": {
        "zh_CN": "采样结束，恢复 block swap",
        "en": "Restoring block swap after sampling",
        "ja": "サンプリング後に block swap を復元します",
    },
    "cache_unconditional_embeddings": {
        "zh_CN": "正在为 caption dropout 缓存无条件 embedding（编码空 caption）",
        "en": "Caching unconditional embeddings for caption dropout (encoding an empty caption)",
        "ja": "caption dropout 用の無条件 embedding をキャッシュしています（空 caption をエンコード）",
    },
    "unconditional_embeddings_cached": {
        "zh_CN": "无条件 embedding 缓存完成",
        "en": "Unconditional embeddings cached successfully",
        "ja": "無条件 embedding のキャッシュが完了しました",
    },
    "unconditional_embeddings_missing": {
        "zh_CN": "无条件 embedding 未缓存，caption dropout 将回退为零向量",
        "en": "Unconditional embeddings are not cached; using zeros for caption dropout",
        "ja": "無条件 embedding が未キャッシュのため、caption dropout にゼロを使用します",
    },
    "invalid_user_config": {
        "zh_CN": "用户配置格式无效",
        "en": "Invalid user configuration",
        "ja": "ユーザー設定の形式が正しくありません",
    },
    "prepare_dataset_index": {
        "zh_CN": "[准备数据集 {index}]",
        "en": "[Prepare dataset {index}]",
        "ja": "[データセット {index} を準備]",
    },
    "prepare_validation_dataset_index": {
        "zh_CN": "[准备验证数据集 {index}]",
        "en": "[Prepare validation dataset {index}]",
        "ja": "[検証データセット {index} を準備]",
    },
    "create_network_from_weights": {
        "zh_CN": "正在根据权重创建 {network} 网络",
        "en": "Creating {network} network from weights",
        "ja": "重みから {network} ネットワークを作成しています",
    },
    "create_network": {
        "zh_CN": "正在创建 {network} 网络，基础 dim（rank）：{dim}，alpha：{alpha}",
        "en": "Creating {network} network. Base dim (rank): {dim}, alpha: {alpha}",
        "ja": "{network} ネットワークを作成しています。基本 dim（rank）：{dim}、alpha：{alpha}",
    },
    "network_dropout": {
        "zh_CN": "neuron dropout：{neuron}，rank dropout：{rank}，module dropout：{module}",
        "en": "Neuron dropout: {neuron}, rank dropout: {rank}, module dropout: {module}",
        "ja": "neuron dropout：{neuron}、rank dropout：{rank}、module dropout：{module}",
    },
    "dora_enabled": {
        "zh_CN": "已启用 DoRA，将保存兼容 ComfyUI 的 dora_scale 张量",
        "en": "DoRA enabled; ComfyUI-compatible dora_scale tensors will be saved",
        "ja": "DoRA を有効化し、ComfyUI 互換の dora_scale テンソルを保存します",
    },
    "dokr_enabled": {
        "zh_CN": "已启用 DoKr，将保存兼容 ComfyUI 的 dora_scale 张量",
        "en": "DoKr enabled; ComfyUI-compatible dora_scale tensors will be saved",
        "ja": "DoKr を有効化し、ComfyUI 互換の dora_scale テンソルを保存します",
    },
    "dokr_scale_fp32_enabled": {
        "zh_CN": "DoKr 的 dora_scale 和 alpha 张量将以 FP32 保存",
        "en": "DoKr dora_scale and alpha tensors will be saved in FP32",
        "ja": "DoKr の dora_scale と alpha テンソルを FP32 で保存します",
    },
    "dora_scale_fp32_enabled": {
        "zh_CN": "DoRA 的 dora_scale 和 alpha 张量将以 FP32 保存",
        "en": "DoRA dora_scale and alpha tensors will be saved in FP32",
        "ja": "DoRA の dora_scale と alpha テンソルを FP32 で保存します",
    },
    "created_network_modules": {
        "zh_CN": "已为 {target} 创建 {count} 个 {network} 模块",
        "en": "Created {count} {network} modules for {target}",
        "ja": "{target} 用に {count} 個の {network} モジュールを作成しました",
    },
    "enabled_network_modules": {
        "zh_CN": "已为 {target} 启用 {count} 个 {network} 模块",
        "en": "Enabled {count} {network} modules for {target}",
        "ja": "{target} 用に {count} 個の {network} モジュールを有効化しました",
    },
    "zero_rank_modules_skipped": {
        "zh_CN": "dim（rank）为 0，跳过 {count} 个 {network} 模块",
        "en": "dim (rank) is 0; skipped {count} {network} modules",
        "ja": "dim（rank）が 0 のため、{count} 個の {network} モジュールをスキップしました",
    },
    "weights_merged": {
        "zh_CN": "权重合并完成",
        "en": "Weights merged",
        "ja": "重みのマージが完了しました",
    },
}


def tr(message_id: str, **kwargs) -> str:
    translations = MESSAGES.get(message_id)
    if translations is None:
        return message_id.format(**kwargs) if kwargs else message_id
    template = translations.get(_current_language) or translations.get("en") or message_id
    try:
        return template.format(**kwargs)
    except (KeyError, ValueError):
        return template
