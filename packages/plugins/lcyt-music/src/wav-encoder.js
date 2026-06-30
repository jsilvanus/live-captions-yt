/**
 * Local WAV encoder for the external classifier hook (Phase 4).
 *
 * Duplicated from lcyt-rtmp's stt-adapters/pcm-buffer.js buildWav() rather
 * than imported — plugins never import each other's source (see
 * pcm-extractor.js's probeFfmpegVersion for the established precedent).
 */

/**
 * Wrap normalised Float32 PCM ([-1, 1], mono) in a 44-byte RIFF/WAV header.
 *
 * @param {Float32Array} pcm
 * @param {number} sampleRate
 * @returns {Buffer}
 */
export function buildWav(pcm, sampleRate) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataLen = pcm.length * 2;

  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM subchunk size
  buf.writeUInt16LE(1, 20);  // PCM format = 1
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);

  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    const sample = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buf.writeInt16LE(Math.round(sample), 44 + i * 2);
  }

  return buf;
}
