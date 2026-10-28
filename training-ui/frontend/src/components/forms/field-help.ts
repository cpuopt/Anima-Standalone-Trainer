import type { HelpScope } from './help-context'

export interface FieldExplanation { title: string; meaning: string; effect: string; notes: string[] }
type Entry = [title: string, meaning: string, effect: string, ...notes: string[]]
// Descriptions follow this repository's trainer implementations and UI validators,
// not generic guarantees about every PyTorch version or third-party backend.
const training: Record<string, Entry> = {
  learning_rate: ['学习率', '每次优化器更新的基础步幅。', '调节模型学习新概念的速度；过大可能不稳定，过小可能学不充分。', '与 Batch Size、梯度累积及训练步数共同影响训练；自适应优化器的学习率语义需按其实现理解。'],
  text_encoder_lr: ['文本编码器学习率', '为实际参与训练的文本编码器参数指定学习率。', '与图像主干学习率分开控制文本侧的更新。', '仅训练 DiT 或缓存文本输出、冻结文本编码器时，不会因此让文本编码器自动参与训练。'],
  optimizer_type: ['优化器', '根据梯度更新可训练参数的算法。', '影响显存占用、收敛方式及可接受的附加参数。', '8bit / Paged 实现需要对应依赖；不同优化器的 optimizer_args 不可直接混用。'],
  lr_scheduler: ['学习率调度器', '控制学习率随训练进度的变化曲线。', '例如 cosine 后期降低学习率，constant 保持基础水平。', '不能替代 weight_decay；ScheduleFree 优化器应使用与其实现相容的调度配置，不宜盲目叠加衰减。'],
  lr_warmup_steps: ['学习率预热步数', '在训练开始的一段更新步内逐渐升高学习率。', '减少起步时过大的参数更新；0 表示无预热。', '是否生效取决于所选调度器；单位为优化器更新步，不是图片数。'],
  lr_scheduler_num_cycles: ['调度周期数', '周期调度器在整个训练内使用的循环次数。', '调节余弦重启等调度器的循环频率。', '只对读取此参数的调度器有效，不是额外增加训练轮数。'],
  lr_scheduler_min_lr_ratio: ['最低学习率比例', '最低学习率与基础学习率的比值。', '为支持最低学习率的调度器设置衰减下限。', '0 表示允许降至零；仅对支持该参数的调度器生效。'],
  weight_decay: ['权重衰减', '优化器对可训练权重施加的收缩约束。', '限制权重增长，提供正则化；不是学习率衰减。', '可与 cosine 同用。AdamW 的每步收缩量与当前学习率有关；关闭应明确设置为 0，留空可能恢复优化器默认值。'],
  decouple: ['解耦权重衰减', '控制支持此选项的优化器如何应用 weight decay。', '将权重衰减与梯度自适应处理分开。', '仅用于支持 decouple 的优化器；不能作为通用参数传给所有优化器。'],
  optimizer_args: ['优化器附加参数', '由 key=value 字符串组成的 JSON 数组。', '向所选优化器传递 weight_decay、betas 等细节。', '示例：["weight_decay=0.01"]。参数名称、类型和取值必须由当前优化器支持；切换后清理不兼容参数。'],
  seed: ['随机种子', '初始化随机数生成器的数值。', '便于在相同环境下比较配置，0 也是有效种子。', '多进程、不同算子或软件版本仍可能产生差异，不保证逐位复现。'],
  duration_unit: ['训练时长单位', '选择按 Epochs（轮）还是 Steps（更新步）控制训练。', '切换训练终点以及保存、采样间隔所使用的单位。', '界面会清理另一单位的相关字段；改变数据量、batch 或累积步数会改变每轮更新次数。'],
  max_train_epochs: ['最大训练轮数', '遍历数据集的最大轮数。', '结合数据量、重复次数和采样比例决定训练量。', '本界面与 Steps 模式择一；启用渐进分辨率时，阶段边界最终按总更新步计算。'],
  max_train_steps: ['最大更新步数', '优化器完成参数更新的最大次数。', '直接限制训练长度；并非每读入一张图片就增加一步。', '梯度累积会合并多个小批次才更新一次；本界面与 Epochs 模式择一。'],
  save_every_n_epochs: ['按轮保存间隔', '每经过指定轮数保存一次模型权重。', '保留中间检查点，便于比较或回退。', '普通模型权重不等于完整 Resume 状态；频繁保存会增加磁盘占用。'],
  save_every_n_steps: ['按步保存间隔', '每完成指定优化器更新步数保存一次权重。', '在 Steps 模式下控制检查点密度。', '不是微批次间隔；完整断点恢复还需要另行保存训练状态。'],
  output_name: ['输出名称', '模型和训练输出文件的名称前缀。', '区分不同实验的产物。', '不要填写路径分隔符或系统不允许的文件名字符；输出目录由任务另行管理。'],
  save_model_as: ['模型保存格式', '训练权重的序列化文件格式。', '选择下游工具可读取的文件类型。', '保存格式不改变训练算法；不同模型及加载器对 ckpt 支持不同。'],
  mixed_precision: ['混合精度', '前向与反向计算使用的精度模式。', 'BF16 / FP16 通常可节省显存并加速计算。', '需要硬件及算子支持；Krea 2 与 MOSS 当前界面限定 BF16。保存精度是另一项设置。'],
  save_precision: ['权重保存精度', '写入检查点的浮点数精度。', '影响输出体积与保存时的量化舍入，不直接改变训练计算精度。', '恢复完整 optimizer 状态与仅加载低精度权重不同；必须由下游加载器支持。'],
  max_data_loader_n_workers: ['数据加载进程数', '用于读取、预处理训练样本的 worker 数量。', '可减少等待数据的时间，但会增加 CPU 和内存负担。', '0 表示在主进程加载，此时不能启用 Persistent DataLoader Workers。'],
  persistent_data_loader_workers: ['持久数据加载进程', '跨训练轮保留 DataLoader worker。', '减少每轮重新创建进程的开销，同时持续占用内存。', '必须 DataLoader Workers > 0。'],
  gradient_accumulation_steps: ['梯度累积步数', '累积多个微批次的梯度后再更新参数。', '在较低单批显存下提高有效批量；单卡有效批量约为 batch × 累积步数。', '不等同于提高单次 batch；同样 Epochs 下更新次数会减少。部分特殊融合优化器要求为 1。'],
  gradient_checkpointing: ['梯度检查点', '反向传播时重算部分激活，而不是全部保留。', '以额外计算换取显存，通常使每步变慢。', 'Activation Offload 依赖此开关；普通 checkpointing 不与 Torch Compile 天然互斥，但组合仍需实测。'],
  flash_attn: ['FlashAttention', '使用独立 FlashAttention 算子计算注意力。', '在匹配的形状和设备上降低注意力显存开销并可能加速。', '需要兼容的 flash-attn、PyTorch、CUDA 与 GPU；不是安装 Triton 就会自动获得。与 Compile 的具体组合需验证。'],
  torch_compile: ['Torch Compile', '通过编译后端优化模型计算图。', '首次及新形状编译需要时间，长训练可能受益，也可能增加内存。', '本项目 Anima 与 CUDA Direct、TP/SP 明确互斥。默认 inductor 的 GPU 编译依赖可用 Triton。', 'Bucket、分辨率或 batch 变化可能触发重编译；Block / Activation Offload 可能产生图断开，需实测，不保证加速。'],
  lowram: ['低内存加载', '使用训练器的低系统内存模型加载路径。', '减少加载过程中的部分 CPU RAM 峰值。', '不是显存卸载开关，不能替代 Blocks to Swap 或梯度检查点。'],
  blocks_to_swap: ['交换到 CPU 的 Block 数量', '将部分主干模块按执行顺序在 CPU 与 GPU 间交换。', '降低显存常驻权重，代价是 RAM、传输与同步开销；0 关闭。', 'Anima / MOSS 与 Activation Offload 互斥；Anima FSDP 模式不允许手动 Block Swap。', '与 Compile 组合可能图断开或失去加速；不同架构允许的 Block 数不同。'],
  activation_offload: ['激活卸载方式', '选择将检查点相关激活转存 CPU 的实现。', '减少 GPU 激活驻留，增加 RAM 和设备传输。', '需要 Gradient Checkpointing；CPU 与 Unsloth 只能择一。Anima 与 Blocks to Swap、FSDP 手动卸载限制联动。'],
  cache_latents_to_disk: ['磁盘 Latent 缓存', '将 VAE 编码后的图像潜变量保存到磁盘。', '避免训练时反复编码图像，消耗缓存空间与初始化时间。', '缓存不适合每次都改变图像的随机裁剪、颜色增强；修改图像或预处理后应重新检查缓存。多分辨率会增加缓存。'],
  vae_batch_size: ['VAE 缓存批量', '预编码图像 Latent 时一次处理的图片数量。', '较大可提高缓存速度，但增加缓存阶段显存。', '仅影响缓存阶段，不是训练 Batch Size，也不会改变训练的有效批量。'],
  cache_text_encoder_outputs_to_disk: ['文本输出磁盘缓存', '将文本编码器输出保存，训练时直接复用。', '减少重复文本编码，并可卸载冻结的文本编码器。', '不适用于训练文本编码器或需要每步重新编码的动态文本增强。Anima 的 embedding 级 Caption Dropout 是特殊支持，不能据此推断 Tag Dropout / Shuffle 也兼容。'],
  timestep_sample_method: ['训练噪声时间步采样', '决定各噪声程度在训练中被抽到的概率。', 'logit_normal 偏向中间阶段；uniform 在应用 shift 前均匀抽样。', '不是推理采样器。最终分布还受 sigmoid_scale 与 discrete_flow_shift 影响。'],
  timestep_sampling: ['训练时间步分布', '选择当前架构的训练噪声抽样策略。', '改变不同噪声阶段的训练机会，不是图片生成的 sampler。', '可选策略由架构决定，Anima、Krea 2、MOSS 的名称不能直接互换。'],
  discrete_flow_shift: ['训练 Flow Shift', '对训练噪声时间步的分布施加偏移。', '在 Anima 的该变换中，1 不偏移，大于 1 偏向更高噪声，小于 1 偏向更低噪声。', '应为正数；与采样方法共同生效。并非推理 CFG，也不要求训练和推理所有采样参数同名同值。'],
  fp8_scaled: ['动态缩放 FP8', 'Krea 2 对底模权重采用动态缩放的 FP8 加载策略。', '减少权重占用，涉及精度及算子兼容性取舍。', '使用原始 BF16 模型文件；此界面将 fp8_base 与 fp8_scaled 成对设置，不是训练输出保存精度。'],
  attention: ['注意力后端', '选择 SDPA、FlashAttention 或 xformers。', '影响注意力计算实现、性能和显存。', 'Krea 2 必须恰好选择一个后端；Flash / xformers 需要相应依赖。'],
  split_attn: ['拆分注意力', '启用训练后端的分段注意力路径。', '改变注意力计算组织方式，可能降低某些尺寸的内存压力。', '需要所选注意力后端支持；不能保证对所有输入都更快。'],
  text_encoder_batch_size: ['文本缓存批量', '预计算文本嵌入时每批处理的文本数量。', '提高缓存吞吐量，同时增加编码阶段显存。', '不改变训练图片批量；长文本会进一步提高缓存内存需求。'],
  max_grad_norm: ['最大梯度范数', '用于梯度裁剪的范数上限。', '限制过大的梯度，帮助控制更新稳定性。', '实际裁剪方式取决于优化器和训练器；部分优化器使用自己的裁剪机制。'],
  flavour: ['MOSS 底模版本', '选择 Base 或 SFT 训练入口。', '匹配所加载的模型分支及其配置。', '需提供对应权重，不是同一权重的画风开关；不能混用不兼容模型。'],
  weighting_scheme: ['损失加权', '按噪声时间步调整训练损失的权重。', '改变不同噪声阶段对更新的贡献，与时间步采样不同。', '仅支持当前架构的实现；Krea 2 当前限定 none，不应照搬其他模型选项。'],
  moss_max_token_length: ['MOSS 最大文本长度', '文本编码阶段允许的最大 Token 数量。', '限制长 Caption 的截断位置及编码开销。', 'Token 不是字数；提高上限增加内存与计算，改动后应重新检查文本缓存。'],
  convrot_int8: ['DiT ConvRot INT8', 'MOSS 使用 ConvRot 对主干权重进行 INT8 处理。', '降低底模权重显存，存在精度与速度取舍。', '需要匹配的 Triton；与 Compile 同用时会排除对应 Linear 层，不代表整图都被编译。'],
  convrot_int8_text_encoder: ['文本编码器 ConvRot INT8', '对冻结的 MOSS 文本编码器使用 ConvRot INT8。', '降低文本编码与缓存阶段的权重显存。', '依赖 Triton；不是训练文本编码器，也不改变最终保存 Adapter 的精度。'],
  block_swap_ring_size: ['Block Swap 环形缓冲大小', 'MOSS 交换块使用的环形缓冲槽位数量。', '调节交换预取与缓冲资源的折中。', '主要在启用 Block Swap 时有意义；较大不一定更快，可能增加内存。'],
  block_swap_h2d_only: ['仅主机到设备交换', 'MOSS Block Swap 的 H2D-only 路径。', '改变权重交换与反向重算的组织方式。', '必须开启 Gradient Checkpointing；仅在使用 Block Swap 时有实际意义。'],
  use_pinned_memory_for_block_swap: ['锁页交换内存', '为 Block Swap 的主机侧数据使用 pinned memory。', '可能改善 CPU/GPU 传输，但增加被锁定的 RAM。', '不是直接减少显存；仅在交换启用时有意义。'],
  cpu_offload_checkpointing: ['CPU 激活卸载', '将检查点激活转存 CPU 的卸载实现。', '以主机内存和传输换取显存。', '需要 Gradient Checkpointing；与 Unsloth 卸载、Blocks to Swap 互斥。'],
  unsloth_offload_checkpointing: ['Unsloth 激活卸载', '采用 Unsloth 风格的检查点激活卸载实现。', '降低激活显存，增加重算与 CPU/GPU 传输。', '需要 Gradient Checkpointing；与 CPU 卸载、Blocks to Swap 互斥，Compile 组合需实测。'],
  compile_backend: ['编译后端', 'MOSS 按 DiT Block 编译时使用的后端。', 'inductor 用于优化计算，eager / aot_eager 主要用于诊断。', '非 inductor 后端必须使用 default 模式；GPU inductor 需要匹配的 Triton 和编译工具链。'],
  compile_mode: ['编译优化模式', '选择编译时间、运行开销及自动调优之间的取舍。', 'max-autotune 等模式可能花更多预热时间，并增加内存需求。', 'eager / aot_eager 后端只允许 default；涉及 CUDA Graph 的模式与动态搬运需实测。'],
  compile_dynamic: ['编译动态形状', '控制编译器对变化的张量尺寸如何处理。', 'auto 自动尝试动态形状，false 可能为新形状重编译，true 尝试动态编译。', '不保证消除所有重编译；本项目 MOSS 提示 Windows 的 dynamic=true 需要 VS 2022 C++ 工具链。'],
  compile_fullgraph: ['完整计算图编译', '要求被编译的函数不能发生图断开。', '可用于检查图是否完整，但比默认模式更严格。', '遇到未支持算子、卸载钩子等图断开会报错，不是必定更快的开关。'],
  compile_cache_size_limit: ['编译缓存变体上限', '允许编译器缓存的图变体数量限制。', '调节多种输入形状下的编译缓存容量。', '不是磁盘缓存大小；提高上限不能解决不支持的算子，并可能增加内存与编译成本。'],
  cuda_allow_tf32: ['允许 TF32', '允许相关 CUDA FP32 运算使用 TF32 路径。', '支持的 GPU 上可能加速部分矩阵运算，存在精度取舍。', '并非所有 BF16 运算都会受影响；不要求同时开启 Torch Compile。'],
  cuda_cudnn_benchmark: ['cuDNN 算法基准选择', '为适用的卷积形状搜索较快的 cuDNN 算法。', '固定形状重复计算可能受益，但首次搜索有开销。', 'Bucket 或尺寸频繁变化可能增加搜索成本；不保证确定性或加速。'],
}

const dataset: Record<string, Entry> = {
  enable_bucket: ['宽高比分桶', '将相似宽高比的图片分配到相应分辨率桶。', '减少强制正方形裁剪，并把同形状样本组成批次。', '仍会按桶缩放或裁剪；更多形状可能增加 Compile 重编译次数。'],
  bucket_no_upscale: ['禁止桶放大小图', '分桶时避免将低分辨率原图放大。', '保留小图原生信息，减少无意义插值。', '需要 Bucket；Anima 此模式下 min/max Bucket 范围不按通常的固定边界解释，实际桶由图片决定。'],
  balance_regularization_images: ['平衡正则化图片', '在数据集实现中平衡正则化样本的重复次数。', '避免 REG 与训练样本的数量比例过于失衡。', '需要存在 is_reg 子集；正则化样本不同于普通训练样本，也不同于 weight decay。'],
  min_bucket_reso: ['最小桶边长', '构造宽高比分桶时使用的最小分辨率边界。', '影响可生成的桶形状以及裁剪。', '需要 Bucket；与最大值、桶步长及不放大小图选项共同决定实际尺寸，必须符合架构对齐要求。'],
  max_bucket_reso: ['最大桶边长', '构造桶时使用的最大分辨率边界。', '限制桶的长边候选，不等同于强制所有图像为此正方形。', 'bucket_no_upscale 或渐进分辨率覆盖可能改变其作用；较大桶需要更多显存。'],
  bucket_reso_steps: ['桶分辨率步长', '生成相邻桶尺寸时使用的像素间隔。', '较小可细分宽高比，但产生更多桶。', '不是训练步数；必须满足模型下采样对齐约束，MOSS 当前校验要求为 16 的倍数。'],
  resolution_schedule: ['渐进式分辨率计划', '按训练进度顺序切换图像分辨率档位。', '例如 512:0.4,1024:0.6 表示前 40% 更新步用 512 档，后 60% 用 1024 档。', '比例之和应为 1；留空关闭。优先使用同分辨率 Dataset，否则覆盖分辨率。', '多阶段 Latent 缓存占用更多磁盘；高分辨率阶段仍需足够显存，并可能使 Compile 重编译。'],
  disable_bucket_shuffle: ['禁止 Bucket 顺序打乱', '禁用数据集对应的 Bucket shuffle 路径。', '使桶调度顺序更固定，具体样本顺序仍受其他随机设置影响。', '不是打乱 Caption 的开关，也不意味着所有训练过程完全确定。'],
  enable_multiline_caption: ['保留多行 Caption', '允许读取完整的多行文本标注。', '避免多行描述仅保留首行造成信息丢失。', '文本仍可能受最大 Token 长度截断；修改标注后应重新检查文本缓存。'],
  resolution: ['训练分辨率', '此 Dataset 的目标分辨率，支持单值或 [宽,高]。', '控制图像缩放、裁剪与分桶面积基准；尺寸越大通常越占显存。', '开启 Bucket 时实际尺寸可以变化；渐进计划可能覆盖。Krea 2 / MOSS 要求边长为 16 的倍数。'],
  batch_size: ['训练微批量', '单设备一次前向处理的样本数量。', '增大可提高吞吐量，但增加激活显存。', '与梯度累积和设备数共同决定有效批量；不是 VAE / 文本缓存批量。'],
  caption_extension: ['标注文件扩展名', '同名图像标注文件使用的后缀，例如 .txt。', '让加载器找到每张图片的文字描述。', '修改后应确认对应文件存在，缓存中的旧文本不会因此自动保证有效。'],
  image_dir: ['图片目录', '训练服务器上存放此子集图片的路径。', '指定参与训练的数据来源。', '不是浏览器电脑的上传路径；预览计数只统计当前目录支持的图片，不代表递归扫描结果。'],
  num_repeats: ['样本重复次数', '每轮对该子集样本重复使用的次数。', '提高子集的相对训练权重，并改变每轮长度。', '增大可能增加过拟合；Steps 模式固定总更新步时，主要改变抽样配比。'],
  epoch_sample_rate: ['每轮图片采样比例', '每轮从此子集中选择的原始图片比例，取值 0～1。', '轮换使用部分图片，控制单轮数据量。', '与 repeats 相乘影响样本暴露量；1 为全部。该扩展不提供给 Krea 2 / MOSS。'],
  keep_tokens: ['Caption 保留项数', '打乱或丢弃逗号分隔标签时保护开头的若干项。', '保留触发词等关键信息。', '这里不是分词器 Token 数；不阻止整个 Caption Dropout。Shuffle / Tag Dropout 与文本缓存存在限制。'],
  caption_dropout_rate: ['整段文本丢弃概率', '随机将整段 Caption 条件置空的比例。', '让训练不总是依赖完整文字条件。', '与逐标签丢弃不同；Anima 使用 embedding 级 dropout 支持缓存，并将子集设置迁移到全局，不能假定各子集概率始终独立。'],
  caption_tag_dropout_rate: ['标签丢弃概率', '随机移除 Caption 中的部分逗号分隔标签。', '减少对固定标签组合的依赖。', '与整段 Caption Dropout 不同；缓存文本输出时不能动态重新编码丢弃后的标注。'],
  caption_dropout_every_n_epochs: ['周期性丢弃 Caption', '每隔指定轮数对文本条件执行周期性丢弃。', '引入不依赖完整 Caption 的训练轮；0 关闭。', '与随机丢弃概率不同；缓存文本时须确认后端支持，不应视为 Anima embedding dropout 的同义开关。'],
  caption_prefix: ['Caption 前缀', '为该子集的文字标注添加固定前缀。', '统一添加触发词或描述。', '这是训练文本，不是文件名前缀；改动后应重新检查文本缓存和 Token 长度。'],
  caption_suffix: ['Caption 后缀', '为该子集的文字标注追加固定文本。', '统一补充风格或其他描述。', '需留意 Token 截断；改动后应重新检查文本缓存。'],
  shuffle_caption: ['打乱 Caption 标签', '随机重排逗号分隔的 Caption 标签。', '降低对标签固定顺序的依赖；开头 keep_tokens 项可保留。', '不适合有语序的自然语言；与固定文本输出缓存不兼容。'],
  flip_aug: ['水平翻转增强', '为训练图片引入左右翻转。', '增加构图变化，但不增加真实样本信息。', '文字、左右不对称角色或方向标签可能失真；缓存需包含对应翻转 Latent。'],
  is_reg: ['正则化子集', '将此子集标记为正则化样本，而非普通训练目标。', '通过额外数据帮助保留通用概念，具体权重由训练器决定。', '与普通样本配比要匹配；LBAI 训练程度估算不将其作为普通训练图片计算。'],
  alpha_mask: ['透明度损失遮罩', '将图像 Alpha 信息用作训练损失的遮罩。', '让透明或低 Alpha 区域减少对损失的贡献。', '需要实际带 Alpha 的图像及后端支持；不是自动抠图，也不是仅改变预览背景。'],
  lbai_target: ['LBAI 比较目标', '选择用于对照训练程度估算的自定义目标区间。', '只改变显示的比较基准，不改变训练参数。', 'LBAI 是启发式估算，不是模型质量、收敛或过拟合的保证。'],
}

const network: Record<string, Entry> = {
  training_type: ['训练类型', '选择 Adapter 训练或完整微调。', 'Adapter 只训练附加模块；Full Finetune 更新底模参数，资源需求更大。', 'Krea 2 / MOSS 当前界面只支持 Adapter。切换会移除或恢复适配器草稿，不是把一种检查点直接转成另一种。'],
  network_module: ['适配器实现', '选择 LoRA、LoHa 或 LoKR 等网络模块。', '决定可训练矩阵的结构、参数量和支持的专用选项。', '必须与架构及已有 Adapter 权重相匹配；DoRA / DoKr、Factor、LoRA+ 不能对所有模块通用。'],
  network_dim: ['全局 Rank', '低秩适配器的容量参数。', '较大通常带来更多参数、优化器显存及存储开销，但不保证更好。', 'LoKR Full Matrix 忽略 Rank；启用 layer_configs 后 DiT Block 使用分层配置，全局输入被锁定。'],
  network_alpha: ['适配器 Alpha', '适配器实现用于调整更新缩放的系数。', '普通 LoRA 通常通过 Alpha / Rank 缩放；其他模块以各自实现为准。', '不是推理 LoRA 强度；Full Matrix 缩放固定为 1，分层 Alpha 可覆盖全局值。'],
  factor: ['LoKR 分解因子', '控制 Kronecker 因子的尺寸分解方式。', '改变参数矩阵的形状、容量和参数量。', '-1 表示自动，否则为正整数，不能为 0；只对 LoKR / DoKr 生效，改变后可能无法加载原检查点。'],
  full_matrix: ['LoKR 完整因子', '直接训练完整的 Kronecker 因子矩阵。', '不再使用该路径的低秩 Rank / Alpha 缩放。', '不是完整底模微调；Rank 与 Alpha 不生效，Factor、分层训练开关仍有效。'],
  network_train_unet_only: ['仅训练图像主干 Adapter', '限制适配器只作用于图像去噪主干。', '在 Anima 中实际对应 DiT，UNet 是历史命名。', '不等于训练所有底模权重；开启文本输出缓存时不应同时训练文本编码器。'],
  network_dropout: ['网络 Dropout', '适配器实现对中间激活使用的随机丢弃概率。', '提供正则化，过大可能使学习不足。', '与 Rank / Module Dropout 作用位置不同；是否生效取决于模块实现，Krea 2 / MOSS 要求小于 1。'],
  use_dora: ['DoRA / DoKr 幅度分解', '将更新拆分为方向与幅度相关的参数。', '为支持的 LoRA / LoKR 模块增加幅度学习，并保存 dora_scale。', '仅在支持的模块下生效；下游推理工具也需支持相应权重结构。不是所有 LoHa / LoRA 实现都可开启。'],
  dora_scale_fp32: ['FP32 幅度权重保存', '单独以 FP32 保存 DoRA / DoKr 的幅度缩放参数。', '降低保存低精度幅度时的舍入损失。', '仅启用 use_dora 时有效；不意味着全部模型或全部计算改为 FP32。'],
  mod_dim: ['调制层 Rank', '为支持的 LyCORIS 模块指定 AdaLN modulation 的容量。', '单独控制调制层是否参与及其参数量。', '留空时该专用配置排除调制层；与全局 Rank 不同，只影响支持此参数的模块。'],
  rank_dropout: ['Rank / 通道 Dropout', '适配器实现中对低秩成分或通道进行的随机丢弃。', '对适配器施加结构层面的正则化。', '具体轴由模块决定；本项目 LyCORIS LoHa / LoKR 为输出通道 dropout，不可统一理解成 Rank 维。'],
  module_dropout: ['整模块 Dropout', '以给定概率跳过某个适配器模块的更新贡献。', '减少对单个模块的依赖，过大可能学习不足。', '不等于从检查点删除该层；与训练开关及 Network Dropout 不同。'],
  use_tucker: ['Tucker 分解', '对支持的卷积适配器使用 Tucker 参数分解。', '改变部分卷积模块的结构及参数量。', '主要用于 Conv2d 3×3；Anima DiT 的 Linear 层不会因此获得额外效果。'],
  loraplus_lr_ratio: ['LoRA+ 学习率比例', '为支持的 LoRA 上下投影设置不同学习率比例。', '改变适配器矩阵之间的更新速度配比。', '只在当前模块支持时有效；Krea 2 / MOSS LoKR 不支持此界面选项。'],
  network_args: ['网络附加参数', '传给适配器构造函数的 key=value 参数列表。', '设置目标层、分解方式及分层覆盖等高级行为。', '专用字段优先；JSON 形式须为字符串数组。不要重复键，也不能把其他模块专有参数直接混入。'],
  network_weights: ['初始 Adapter 权重', '从已有适配器检查点初始化可训练权重。', '用于继续优化已有 Adapter 或做增量训练。', '需同架构、同模块及兼容矩阵形状；仅加载权重不会恢复 optimizer、scheduler 和步数，后者应使用 Resume。'],
  freeze_llm_adapter: ['冻结 LLM Adapter', '完整微调时不更新 Anima 预训练的文本嵌入适配层。', '保留文字条件映射能力，减少不必要的退化风险。', '它不是 LoRA Adapter，也不是冻结整个图像主干；此选项只在对应完整微调路径下使用。'],
  auto_resume_last_state: ['自动恢复训练状态', '自动寻找任务中最近保存的完整训练状态。', '恢复优化器、调度器和训练进度，而不只是 Adapter 权重。', '开启时手动 Resume 目录被忽略；需要已有有效状态，且结构、环境与配置兼容。'],
  resume: ['手动恢复状态目录', '指定训练器保存的完整状态文件夹。', '恢复参数、optimizer、scheduler 及训练进度。', '不能填写单个 .safetensors 文件；自动恢复开启时此字段禁用。修改模型结构或优化器可能无法恢复。'],
  layer_configs: ['高级分层设置', '按 DiT 层类型或具体层配置训练开关及容量。', '将参数预算分配给不同注意力、MLP 与调制模块。', '优先于全局 Rank / Alpha / Factor 的对应设置，只应用当前模式；Full Matrix 下 Rank / Alpha 不生效。'],
  layer_mode: ['分层配置模式', '选择按层类型统一设置，或逐个层单独设置。', '在简洁控制与细粒度定制之间切换。', '只应用当前模式；另一模式是页面草稿，不会同时叠加。'],
  layer_rank: ['分层 Rank', '为选中的层或层类型指定低秩容量。', '覆盖该层的默认 Rank，并改变可训练参数量。', '必须为正整数；Full Matrix 下不生效，关闭训练的层也不会使用此值。'],
  layer_alpha: ['分层 Alpha', '为选中层指定适配器缩放系数。', '覆盖该层缩放；未单独设置时默认随 Rank。', '必须为正数；Full Matrix 下不生效。不是推理侧的 LoRA 权重。'],
  layer_factor: ['分层 Factor', '为 LoKR 的选中层指定 Kronecker 分解因子。', '覆盖默认 Factor，改变该层矩阵结构。', '-1 自动，否则为正整数；Full Matrix 下仍有效，改变结构需检查权重兼容。'],
  layer_enabled: ['此层参与训练', '决定是否为当前层创建并训练适配器。', '关闭可以排除此层并减少参数开销。', '关闭后该层 Rank / Alpha / Factor 不再参与；不是冻结整个底模或删除模型原有层。'],
}

export const fieldHelpCatalog = { training, dataset, network }
export function getFieldHelp(scope: HelpScope, key: string, architecture = 'anima', module = ''): FieldExplanation | undefined {
  let entry = fieldHelpCatalog[scope][key]
  if (scope === 'training' && key === 'compile') {
    entry = architecture === 'moss_image'
      ? ['按 Block 编译', 'MOSS 对可支持的 DiT Block 使用 torch.compile。', '可能优化重复计算，但首次预热、新桶编译会增加耗时与内存。', 'inductor 需要可用 Triton 和工具链；ConvRot INT8 / Block Swap 会排除对应 Linear 层，fullgraph 需额外验证。']
      : ['Krea 2 编译', '启用 Krea 2 后端的模型编译路径。', '可能提高稳定形状下的吞吐量，但不保证加速。', '需要后端匹配的 Triton / 工具链。不能把 Anima 的 CUDA Direct / TP/SP 限制直接套到此单卡后端；卸载、FP8 与注意力组合需实测。']
  }
  if (!entry) return undefined
  const [title, meaning, effect, ...notes] = entry
  const result = { title, meaning, effect, notes }
  if (scope === 'training' && key === 'discrete_flow_shift' && architecture === 'krea2') {
    result.meaning = 'Krea 2 部分时间步策略使用的固定偏移系数。'
    result.effect = '对支持固定 shift 的策略调整训练时间步分布。'
    result.notes = ['krea2_shift 使用分辨率相关的偏移，此时本字段禁用；不要将固定值误认为该策略的实际偏移。']
  }
  if (scope === 'training' && key === 'activation_offload' && architecture === 'krea2') result.notes = ['Krea 2 当前只提供 CPU 卸载，需要 Gradient Checkpointing；没有 Anima 的 Unsloth 选项，其他组合按后端验证。']
  if (scope === 'training' && key === 'blocks_to_swap' && architecture === 'krea2') result.notes = ['Krea 2 当前单卡后端的交换配置；不能套用 Anima 的 FSDP / TP/SP 限制。与 Compile、FP8 和 CPU 激活卸载的实际组合需实测。']
  if (scope === 'dataset' && key === 'caption_dropout_rate' && architecture !== 'anima') result.notes = ['仅在当前后端支持的文本丢弃路径生效；不要假定所有模型都采用 Anima 的全局 embedding 迁移逻辑。']
  if (scope === 'network' && key === 'rank_dropout' && (architecture === 'krea2' || module.endsWith('lora_generic'))) result.notes = ['按当前原生 LoRA / LoKR 实现执行，不能照搬本项目 Anima LyCORIS 的输出通道语义；概率必须小于 1。']
  return result
}
