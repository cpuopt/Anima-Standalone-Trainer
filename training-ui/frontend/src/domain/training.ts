// Keep one implementation of the existing training rules for both interfaces.
import * as kreaModule from '../../../shared/krea2.js'
import * as layerModule from '../../../shared/layer-rank.js'
import * as matrixModule from '../../../shared/adapter-matrix.js'
import * as lbaiModule from '../../../shared/lbai.js'
const legacy = globalThis as any
// Vite dev executes UMD as browser scripts; tests/build can expose CJS defaults.
export const Krea2 = kreaModule.default || legacy.Krea2
export const LayerRank = layerModule.default || legacy.LayerRank
export const AdapterMatrix = matrixModule.default || legacy.AdapterMatrix
export const LBAI = lbaiModule.default || legacy.LBAI

import * as mossModule from '../../../shared/moss.js'
export const Moss = mossModule.default || legacy.Moss
