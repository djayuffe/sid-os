// Copyright (c) 2026 Ulf Bertilsson. SPDX-License-Identifier: GPL-3.0-only
import source from './sidControlKernel.js?raw';
export { SID_REPLAY_LIMIT, sidRegister, sidByte, sidClock, sidEvents, sidSpeed, sidMask, sidMixer, sidSeek } from './sidControlKernel.js';
// Preserve names in generated worklets even in minified production builds.
export const SID_CONTROL_CODE = source.replace(/^export /gm, '');
export interface SidSeekOptions { mode?: 'registers' | 'replay'; }
