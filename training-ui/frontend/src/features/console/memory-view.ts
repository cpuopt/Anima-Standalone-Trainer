const labels: Record<string,string> = {
  dit: 'DiT 主模型', vae: 'VAE', qwen3: 'Qwen3 文本编码器', text_encoder_0: 'Qwen3 / 文本编码器',
  network: 'LoRA / 训练网络', gradients: '梯度', optimizer: '优化器状态',
}

export function memoryRows(process: any) {
  return Object.entries(process.contents || {}).flatMap(([name, devices]: [string, any]) =>
    Object.entries(devices || {}).filter(([,size]) => typeof size === 'number' && size > 0)
      .map(([device,size]) => ({ name: labels[name] || name, device, bytes: size as number })))
}

export function unattributedBytes(process: any) {
  if (typeof process.allocated_bytes !== 'number') return null
  const rows = memoryRows(process)
  let device = process.device
  if (device === 'cuda') {
    // Older snapshots use an implicit current device. Resolve only if the
    // content list identifies one GPU; multi-GPU ambiguity is not zero usage.
    const devices = [...new Set(rows.map(row => row.device).filter(name => /^cuda:\d+$/.test(name)))]
    if (devices.length !== 1) return null
    device = devices[0]
  }
  const known = rows.filter(row => row.device === device).reduce((sum,row) => sum + row.bytes, 0)
  return Math.max(0, process.allocated_bytes - known)
}
