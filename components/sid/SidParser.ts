
import { SidHeader } from './SidTypes';
import { SystemLogger } from '../../services/Logger';

export function parseSidHeader(data: ArrayBuffer): { header: SidHeader; sidData: Uint8Array } {
  if (data.byteLength < 0x76) {
    throw new Error('Invalid SID file: header is shorter than the mandatory PSID/RSID fields');
  }
  const view = new DataView(data);
  const rawData = new Uint8Array(data);
  const magicId = String.fromCharCode(...rawData.slice(0, 4));

  SystemLogger.log('SidParser', `Parsing SID Header... Magic: ${magicId}`, 'debug');

  if (magicId !== 'PSID' && magicId !== 'RSID') {
    SystemLogger.log('SidParser', `Critical: Unknown Magic ID '${magicId}'`, 'error');
    throw new Error('Invalid SID file: Magic ID mismatch (Expected PSID or RSID)');
  }

  const isRsid = magicId === 'RSID';
  const version = view.getUint16(4, false); // Big endian
  const dataOffset = view.getUint16(6, false);
  let loadAddress = view.getUint16(8, false);
  let initAddress = view.getUint16(10, false);
  let playAddress = view.getUint16(12, false);
  const songs = view.getUint16(14, false);
  const startSong = view.getUint16(16, false);
  const speed = view.getUint32(18, false);

  if (version < 1 || version > 4) {
    throw new Error(`Unsupported SID version: ${version}`);
  }
  const minimumHeaderSize = version >= 2 ? 0x7C : 0x76;
  if (rawData.length < minimumHeaderSize) {
    throw new Error(`Invalid SID file: version ${version} header is truncated`);
  }
  if (dataOffset < minimumHeaderSize || dataOffset >= rawData.length) {
    throw new Error('Invalid SID file: data offset is outside the file');
  }
  if (songs === 0 || startSong === 0 || startSong > songs) {
    throw new Error('Invalid SID file: song count or start song is invalid');
  }

  SystemLogger.log('SidParser', `Version: ${version} | Data Offset: $${dataOffset.toString(16)}`, 'debug');

  // RSID Strict Checks per Spec
  if (isRsid) {
      if (loadAddress !== 0) {
          SystemLogger.log('SidParser', 'RSID Compliance: Load Address must be 0. Forcing 0.', 'warn');
          loadAddress = 0;
      }
      if (playAddress !== 0) {
          SystemLogger.log('SidParser', 'RSID Compliance: Play Address must be 0. Forcing 0.', 'warn');
          playAddress = 0; 
      }
      if (speed !== 0) {
           SystemLogger.log('SidParser', 'RSID Compliance: Speed must be 0. Forcing 0.', 'warn');
      }
  }

  const decoder = new TextDecoder('iso-8859-1');
  const title = decoder.decode(rawData.slice(0x16, 0x36)).replace(/\0/g, '');
  const author = decoder.decode(rawData.slice(0x36, 0x56)).replace(/\0/g, '');
  const released = decoder.decode(rawData.slice(0x56, 0x76)).replace(/\0/g, '');

  let flags = 0;
  if (version >= 2) {
    flags = view.getUint16(0x76, false);
  }

  // --- Clock / Video Standard (Bits 2-3) ---
  let isNtsc = false;
  let videoStandard = 'PAL';
  const videoStd = (flags >> 2) & 0x03;
  
  if (isRsid || (version >= 2 && (flags & 0x0C) !== 0)) {
       // 00=Unknown, 01=PAL, 10=NTSC, 11=Both
       if (videoStd === 2 || videoStd === 3) { 
           isNtsc = true;
           videoStandard = videoStd === 3 ? 'Both (Defaulting NTSC)' : 'NTSC';
       } else {
           videoStandard = videoStd === 1 ? 'PAL' : 'Unknown (Defaulting PAL)';
       }
  } else {
      // V1 Fallback (Clock flag didn't exist, inferred usually or defaults)
      isNtsc = false; 
      videoStandard = 'PAL'; 
  }

  // --- Flags ---
  let c64BasicFlag = false;
  if (isRsid) {
      // Bit 1: C64 BASIC Flag
      c64BasicFlag = (flags & 0x02) !== 0;
  } else {
      // Bit 1: PSID Specific
      if ((flags & 0x02) !== 0) {
          SystemLogger.log('SidParser', 'Flag: PSID Specific (likely PlaySID samples)', 'info');
      }
  }

  // --- Multi-SID Detection (v2+) ---
  const sidModels: ('6581' | '8580' | 'unknown')[] = [];
  const sidAddresses: number[] = [];

  // SID 1 (Always present)
  const modelBits1 = (flags >> 4) & 0x03;
  sidModels.push(modelBits1 === 1 ? '6581' : modelBits1 === 2 ? '8580' : 'unknown');
  sidAddresses.push(0xD400); // Standard

  // SID 2 (V2+)
  if (version >= 2) {
      const modelBits2 = (flags >> 6) & 0x03;
      // If bits are 00 (unknown), it defaults to SID 1 model, but we check address existence
      const addrByte = rawData[0x7A];
      const mappedAddress = mapSidAddress(addrByte);
      if (mappedAddress !== 0 && !sidAddresses.includes(mappedAddress)) {
          sidModels.push(modelBits2 === 1 ? '6581' : modelBits2 === 2 ? '8580' : sidModels[0]);
          sidAddresses.push(mappedAddress);
      }
  }

  // SID 3 (V3+)
  if (version >= 3) {
      const modelBits3 = (flags >> 8) & 0x03;
      const addrByte = rawData[0x7B];
      const mappedAddress = mapSidAddress(addrByte);
      if (mappedAddress !== 0 && !sidAddresses.includes(mappedAddress)) {
          sidModels.push(modelBits3 === 1 ? '6581' : modelBits3 === 2 ? '8580' : sidModels[0]);
          sidAddresses.push(mappedAddress);
      }
  }

  const sidCount = sidModels.length;
  SystemLogger.log('SidParser', `System | SIDs: ${sidCount} | Standard: ${videoStandard} | BASIC: ${c64BasicFlag}`, 'info');

  const PAL_CLOCK = 985248;
  const NTSC_CLOCK = 1022730;
  const clockFreq = isNtsc ? NTSC_CLOCK : PAL_CLOCK;

  let memoryData = rawData.slice(dataOffset);

  // Handle Load Address (first 2 bytes of data if header says 0)
  if (loadAddress === 0) {
    if (memoryData.length < 2) throw new Error('Invalid SID data: Too short');
    loadAddress = memoryData[0] | (memoryData[1] << 8);
    memoryData = memoryData.slice(2);
    SystemLogger.log('SidParser', `Load Address derived from data: $${loadAddress.toString(16)}`, 'info');
  }

  if (memoryData.length === 0 || loadAddress + memoryData.length > 0x10000) {
    throw new Error('Invalid SID file: C64 program data is empty or exceeds address space');
  }

  // Handle Init Address
  if (initAddress === 0) {
      if (isRsid && c64BasicFlag) {
           SystemLogger.log('SidParser', `Init Address is 0 (BASIC Bootstrap)`, 'debug');
      } else {
          initAddress = loadAddress;
          SystemLogger.log('SidParser', `Init Address defaulted to Load Address: $${initAddress.toString(16)}`, 'debug');
      }
  }
  
  if (isRsid && c64BasicFlag && initAddress !== 0) {
      SystemLogger.log('SidParser', 'RSID Error: BASIC flag set but Init Address is not 0. Spec violation.', 'error');
  }

  return {
    header: {
      magic: magicId, version, dataOffset, loadAddress, initAddress, playAddress,
      songs, startSong, speed, title, author, released, flags, isNtsc, clockFreq,
      model: sidModels[0], 
      sidCount, sidModels, sidAddresses,
      c64BasicFlag
    },
    sidData: memoryData,
  };
}

function mapSidAddress(id: number): number {
    // Spec: "It specifies the middle part of the address, $Dxx0, starting from value 0x42 for $D420 to 0xFE for $DFE0)"
    // "Only even values are valid. Ranges 0x00-0x41 ($D000-$D410) and 0x80-0xDF ($D800-$DDF0) are invalid."
    if (id < 0x42 || id > 0xFE || (id % 2 !== 0)) {
        return 0; // Invalid
    }
    // Spec also says 0x80-0xDF are invalid.
    if (id >= 0x80 && id <= 0xDF) {
        return 0;
    }
    return 0xD000 + (id << 4);
}
