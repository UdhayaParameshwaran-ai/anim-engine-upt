/** Writes a mono 16-bit PCM WAV of silence (or of the given samples). */
export function wav(durationSec: number, sampleRate = 16000, samples?: Int16Array): Uint8Array {
  const n = samples?.length ?? Math.round(durationSec * sampleRate);
  const buf = new Uint8Array(44 + n * 2);
  const v = new DataView(buf.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  if (samples) for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, samples[i]!, true);
  return buf;
}

/** Duration in seconds of a PCM WAV produced by `wav`. */
export function wavDuration(data: Uint8Array): number {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rate = v.getUint32(24, true);
  const bytes = v.getUint32(40, true);
  return bytes / (rate * 2);
}
