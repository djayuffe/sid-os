// Copyright (c) 2026 Ulf Bertilsson. SPDX-License-Identifier: GPL-3.0-only
import kernelSource from './masteringKernel.js?raw';

// Raw source preserves identifiers through production minification. Both playback
// engines and the offline exporter run this same implementation.
export { MasteringChain } from './masteringKernel.js';
export const DENORM = 1e-24;
export const MASTERING_DSP_CODE = kernelSource.replace(/^export /gm, '');
