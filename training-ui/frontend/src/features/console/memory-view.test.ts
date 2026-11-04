import { expect, it } from 'vitest'
import { memoryRows, unattributedBytes } from './memory-view'
it('separates CPU offload, GPU models, gradients, optimizer and unattributed allocations', () => {
  const process = { device: 'cuda:0', allocated_bytes: 1000, contents: {
    dit: { 'cuda:0': 500 }, text_encoder_0: { cpu: 600 }, vae: { cpu: 200 },
    gradients: { 'cuda:0': 50 }, optimizer: { 'cuda:0': 100 }, network: {},
  } }
  expect(memoryRows(process)).toHaveLength(5)
  expect(memoryRows(process).find(row => row.name.includes('文本编码器'))?.device).toBe('cpu')
  expect(unattributedBytes(process)).toBe(350)
  expect(unattributedBytes({})).toBeNull()
})
it('resolves legacy cuda snapshots to their sole GPU without counting CPU allocations', () => {
  const process = { device: 'cuda', allocated_bytes: 6700, contents: {
    dit: { 'cuda:0': 3900 }, network: { 'cuda:0': 200 }, gradients: { 'cuda:0': 200 },
    optimizer: { 'cuda:0': 100 }, vae: { cpu: 200 }, text_encoder_0: { cpu: 1100 },
  } }
  expect(unattributedBytes(process)).toBe(2300)
  expect(unattributedBytes({ ...process, device: 'cuda:0' })).toBe(2300)
  expect(unattributedBytes({ device: 'cuda', allocated_bytes: 100, contents: {
    dit: { 'cuda:0': 30, 'cuda:1': 40 },
  } })).toBeNull()
})
it('keeps distinct CUDA devices separate', () => {
  expect(unattributedBytes({ device: 'cuda:1', allocated_bytes: 100, contents: {
    dit: { 'cuda:0': 1000, 'cuda:1': 30 },
  } })).toBe(70)
})
