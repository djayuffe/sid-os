
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  return createWavFile(buffer.getChannelData(0), buffer.sampleRate, buffer.numberOfChannels, buffer.numberOfChannels === 2 ? buffer.getChannelData(1) : undefined);
};

export const createWavFile = (left: Float32Array, sampleRate: number, channels: number = 2, right?: Float32Array): Blob => {
  if (channels !== 1 && channels !== 2) throw new RangeError('WAV export supports mono or stereo audio');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw new RangeError('Invalid WAV sample rate');
  if (channels === 2 && right && right.length !== left.length) throw new RangeError('Stereo channels must have equal lengths');
  const length = left.length;
  if (length * channels * 2 > 0xFFFFFFFF - 36) throw new RangeError('Audio exceeds the RIFF/WAV size limit');
  const dataLength = length * channels * 2; // 16-bit PCM
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF Chunk
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');

  // fmt Sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // ByteRate
  view.setUint16(32, channels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Write Data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    // Clamp and convert Float32 (-1.0 to 1.0) to Int16
    let sL = Number.isFinite(left[i]) ? Math.max(-1, Math.min(1, left[i])) : 0;
    sL = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;
    view.setInt16(offset, sL, true);
    offset += 2;

    if (channels === 2 && right) {
        let sR = Number.isFinite(right[i]) ? Math.max(-1, Math.min(1, right[i])) : 0;
        sR = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
        view.setInt16(offset, sR, true);
        offset += 2;
    } else if (channels === 2) {
        // Mono to Stereo duplication
        view.setInt16(offset, sL, true);
        offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
};
