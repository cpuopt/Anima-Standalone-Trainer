const fs = require('fs');
const LayerRank = require('../public/js/layer-rank');

function readAnimaLayers(file) {
  if (!file || !file.toLowerCase().endsWith('.safetensors')) throw Error('请先配置可读取的 DiT .safetensors 模型文件');
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const first = Buffer.alloc(8);
    if (fs.readSync(fd, first, 0, 8, 0) !== 8) throw Error('模型文件头不完整');
    const length = first.readBigUInt64LE();
    if (length < 2n || length > 100000000n || length > BigInt(size - 8)) throw Error('无效的 safetensors 文件头长度');
    const header = Buffer.alloc(Number(length));
    if (fs.readSync(fd, header, 0, header.length, 8) !== header.length) throw Error('模型文件头不完整');
    const data = JSON.parse(header.toString('utf8'));
    const names = new Set();
    for (let [key, value] of Object.entries(data)) {
      key = key.replace(/^net\./, '');
      if (!key.endsWith('.weight') || !Array.isArray(value?.shape) || value.shape.length !== 2) continue;
      const name = key.slice(0, -7);
      if (LayerRank.typeOf(name)) names.add(name);
    }
    if (!names.size) throw Error('模型文件中没有可配置的 Anima Block 层');
    const layers = [...names].sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
    return {layers, block_count: new Set(layers.map(n => n.split('.')[1])).size};
  } finally { fs.closeSync(fd); }
}

function validateLayerArgs(config, modelPath) {
  const args = config?.network_arguments?.network_args || [];
  const matches = args.filter(arg => String(arg).split('=', 1)[0].trim() === 'layer_configs');
  if (matches.length > 1) throw Error('layer_configs 不可重复设置');
  const raw = matches[0];
  if (!raw) return;
  const module = config.network_arguments.network_module;
  if (!['networks.lora_anima', 'networks.loha', 'networks.lokr'].includes(module)) throw Error('分层设置只支持 Anima 网络');
  const value = JSON.parse(raw.slice(raw.indexOf('=') + 1));
  LayerRank.validate(value, readAnimaLayers(modelPath).layers);
  if (module !== 'networks.lokr' && ['types', 'layers'].some(group => Object.values(value[group] || {}).some(entry => 'factor' in entry))) throw Error('逐层 Factor 只支持 LoKr/DoKr');
}
module.exports = {readAnimaLayers, validateLayerArgs};
