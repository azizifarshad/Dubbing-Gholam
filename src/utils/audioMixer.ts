import { SubtitleItem } from '../types/dubbing';

// Global audio context for decoding
let sharedAudioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

/**
 * Converts a base64 encoded audio string into an ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Strip data URL scheme if present
  const cleanBase64 = base64.replace(/^data:audio\/\w+;base64,/, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decodes a base64 WAV string into an AudioBuffer
 */
export async function decodeBase64ToAudioBuffer(base64: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = base64ToArrayBuffer(base64);
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Decodes a File (MP3, WAV, etc.) into an AudioBuffer
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

/**
 * Converts an AudioBuffer into a WAV Blob (16-bit PCM)
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numOfChan * bytesPerSample;

  const length = buffer.length * numOfChan * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(wavBuffer);

  // Helper to write string to DataView
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true); // ChunkSize
  writeString(8, 'WAVE');

  // "fmt " sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numOfChan, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample

  // "data" sub-chunk
  writeString(36, 'data');
  view.setUint32(40, length, true); // Subchunk2Size

  // Write interleaved PCM samples
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let sample = channels[ch][i];
      // Clamp between -1.0 and 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer (-32768 to 32767)
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export interface MixRenderOptions {
  originalBuffer: AudioBuffer | null;
  subtitles: SubtitleItem[];
  mixMode: 'ducking' | 'isolated' | 'full_mix';
  persianVolume: number;    // default 1.0
  backgroundVolume: number; // default 0.25 (when ducked) or 1.0
  duckingAmount: number;    // 0 to 1
  totalDuration?: number;
}

/**
 * Performs sample-accurate offline rendering of the full Persian dubbed track
 */
export async function renderDubbedTrack(
  options: MixRenderOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<{ wavBlob: Blob; audioBuffer: AudioBuffer; totalDuration: number }> {
  const {
    originalBuffer,
    subtitles,
    mixMode,
    persianVolume = 1.0,
    backgroundVolume = 0.2,
    duckingAmount = 0.8,
  } = options;

  onProgress?.(10, 'در حال بارگذاری و دیکود صوت‌های دوبله فارسی...');

  // Decode all ready subtitle speech audio buffers
  const speechTracks: { item: SubtitleItem; buffer: AudioBuffer }[] = [];
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    if (sub.audioBase64) {
      try {
        const buf = await decodeBase64ToAudioBuffer(sub.audioBase64);
        speechTracks.push({ item: sub, buffer: buf });
      } catch (err) {
        console.error(`Failed to decode audio for line #${sub.id}`, err);
      }
    }
  }

  // Determine total duration
  let maxDuration = 10;
  if (originalBuffer) {
    maxDuration = Math.max(maxDuration, originalBuffer.duration);
  }
  for (const st of speechTracks) {
    const speechEnd = st.item.start + st.buffer.duration;
    if (speechEnd > maxDuration) {
      maxDuration = speechEnd;
    }
  }
  // Add 1 second breathing room at the end
  maxDuration = Math.ceil(maxDuration + 1.0);

  const sampleRate = originalBuffer ? originalBuffer.sampleRate : 44100;
  const channels = originalBuffer ? originalBuffer.numberOfChannels : 2;

  onProgress?.(30, 'در حال آماده‌سازی موتور میکس و همگام‌سازی زمانی...');

  const offlineCtx = new OfflineAudioContext(
    channels,
    Math.ceil(sampleRate * maxDuration),
    sampleRate
  );

  // 1. If original background audio exists and mode is not 'isolated'
  if (originalBuffer && mixMode !== 'isolated') {
    const bgSource = offlineCtx.createBufferSource();
    bgSource.buffer = originalBuffer;

    const bgGain = offlineCtx.createGain();

    if (mixMode === 'ducking') {
      // Setup dynamic ducking envelope
      const normalVol = 1.0;
      const duckedVol = Math.max(0.05, 1.0 - duckingAmount * (1.0 - backgroundVolume));

      bgGain.gain.setValueAtTime(normalVol, 0);

      // Crossfade time in seconds
      const fadeTime = 0.15;
      let prevDuckingEnd = 0;

      for (let i = 0; i < speechTracks.length; i++) {
        const st = speechTracks[i];
        const start = Math.max(st.item.start, prevDuckingEnd > 0 ? prevDuckingEnd + 0.2 : st.item.start);
        const end = Math.min(maxDuration, start + st.buffer.duration + 0.1);
        prevDuckingEnd = end;

        // Fade down slightly before line starts
        const duckStart = Math.max(0, start - fadeTime);
        bgGain.gain.setValueAtTime(normalVol, duckStart);
        bgGain.gain.linearRampToValueAtTime(duckedVol, start);

        // Hold ducked volume until end, then fade back up
        bgGain.gain.setValueAtTime(duckedVol, end);
        bgGain.gain.linearRampToValueAtTime(normalVol, Math.min(maxDuration, end + fadeTime));
      }
    } else {
      // Full mix without ducking
      bgGain.gain.setValueAtTime(backgroundVolume, 0);
    }

    bgSource.connect(bgGain);
    bgGain.connect(offlineCtx.destination);
    bgSource.start(0);
  }

  // 2. Position and play each Persian speech track with sequential collision avoidance and 1.0x pitch
  onProgress?.(55, 'در حال میکس نهایی ترک‌های صوتی با کیفیت ۱.۰x استودیویی بدون تداخل...');

  let previousVoiceEndTime = 0;
  for (let i = 0; i < speechTracks.length; i++) {
    const st = speechTracks[i];

    // Sequential collision avoidance: never overlap with previous track
    const lineStart = Math.max(st.item.start, previousVoiceEndTime > 0 ? previousVoiceEndTime + 0.2 : st.item.start);
    const duration = st.buffer.duration;
    previousVoiceEndTime = lineStart + duration;

    const voiceSource = offlineCtx.createBufferSource();
    voiceSource.buffer = st.buffer;
    // Constant 1.0x rate: guarantees natural vocal pitch without pitch-shifting
    voiceSource.playbackRate.setValueAtTime(1.0, 0);

    const voiceGain = offlineCtx.createGain();
    voiceGain.gain.setValueAtTime(persianVolume, 0);

    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineCtx.destination);

    // Schedule exact chained start time (guarantees full sentence without cutoff)
    voiceSource.start(lineStart);
  }

  onProgress?.(75, 'در حال رندر نهایی صوت و ساخت فایل استودیویی WAV...');

  const renderedBuffer = await offlineCtx.startRendering();

  onProgress?.(95, 'در حال انکود خروجی PCM 16-bit WAV...');
  const wavBlob = audioBufferToWav(renderedBuffer);

  onProgress?.(100, 'رندر صوت دوبله با موفقیت پایان یافت!');

  return {
    wavBlob,
    audioBuffer: renderedBuffer,
    totalDuration: maxDuration,
  };
}

/**
 * Creates a synthetic demo background audio with cinematic suspense atmosphere
 * (ambient chords, soft bass, cinematic clock pulse) so user can test mixing immediately.
 */
export async function generateDemoBackgroundAudio(durationSec: number = 25): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(sampleRate * durationSec);
  const audioBuffer = ctx.createBuffer(2, totalSamples, sampleRate);

  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.getChannelData(1);

  // Frequencies for a mysterious minor chord progression (D minor, F major, Bb, A)
  const baseFreqs = [146.83, 174.61, 220.0, 261.63];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Ambient synth pad
    let sampleL = 0;
    let sampleR = 0;

    for (let f = 0; f < baseFreqs.length; f++) {
      const freq = baseFreqs[f];
      const swell = 0.5 + 0.5 * Math.sin(t * 0.4 + f);
      const wave = Math.sin(2 * Math.PI * freq * t) * 0.05 * swell;
      sampleL += wave;
      sampleR += Math.sin(2 * Math.PI * (freq * 1.002) * t) * 0.05 * swell;
    }

    // Soft cinematic tick/pulse every 1 second
    const beat = t % 1.0;
    if (beat < 0.08) {
      const pulse = Math.sin(2 * Math.PI * 440 * beat) * Math.exp(-beat * 40) * 0.08;
      sampleL += pulse;
      sampleR += pulse;
    }

    // Soft warm drone sub-bass
    const sub = Math.sin(2 * Math.PI * 55 * t) * 0.04;
    sampleL += sub;
    sampleR += sub;

    leftChannel[i] = sampleL;
    rightChannel[i] = sampleR;
  }

  return audioBuffer;
}
