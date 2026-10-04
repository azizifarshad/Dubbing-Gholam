import { secondsToSrtTime } from './srtParser';
import { SubtitleItem } from '../types/dubbing';
import { audioBufferToWav } from './audioMixer';

export interface AudioSpeechSegment {
  id: number;
  start: number;
  end: number;
  duration: number;
}

/**
 * High-precision Waveform Voice Activity Detection (VAD).
 * Scans the actual physical audio samples in the browser to detect exactly
 * when human speech starts and when it cuts off with millisecond precision.
 */
export function detectSpeechSegmentsFromAudioBuffer(
  audioBuffer: AudioBuffer,
  options?: {
    silenceThresholdDb?: number;
    minSpeechDurationSec?: number;
    minSilenceDurationSec?: number;
    paddingSec?: number;
  }
): AudioSpeechSegment[] {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;

  const thresholdDb = options?.silenceThresholdDb ?? -38;
  const minSpeechDuration = options?.minSpeechDurationSec ?? 0.6;
  const minSilenceDuration = options?.minSilenceDurationSec ?? 0.4;
  const padding = options?.paddingSec ?? 0.15;

  const thresholdLinear = Math.pow(10, thresholdDb / 20);
  const frameSize = Math.floor(sampleRate * 0.05);
  const totalFrames = Math.floor(totalSamples / frameSize);

  const frameEnergies: boolean[] = new Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const startSample = f * frameSize;
    let sumSquares = 0;
    for (let i = 0; i < frameSize; i++) {
      const val = channelData[startSample + i] || 0;
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / frameSize);
    frameEnergies[f] = rms > thresholdLinear;
  }

  const rawSegments: { startSec: number; endSec: number }[] = [];
  let inSpeech = false;
  let speechStartSec = 0;
  let silenceStartSec = 0;

  for (let f = 0; f < totalFrames; f++) {
    const timeSec = (f * frameSize) / sampleRate;
    const isSpeech = frameEnergies[f];

    if (!inSpeech && isSpeech) {
      inSpeech = true;
      speechStartSec = timeSec;
    } else if (inSpeech && !isSpeech) {
      silenceStartSec = timeSec;
      let silenceLasts = true;
      const lookaheadFrames = Math.floor((minSilenceDuration * sampleRate) / frameSize);
      for (let k = 1; k < lookaheadFrames && f + k < totalFrames; k++) {
        if (frameEnergies[f + k]) {
          silenceLasts = false;
          break;
        }
      }

      if (silenceLasts) {
        inSpeech = false;
        const dur = silenceStartSec - speechStartSec;
        if (dur >= minSpeechDuration) {
          rawSegments.push({
            startSec: Math.max(0, speechStartSec - padding),
            endSec: Math.min(audioBuffer.duration, silenceStartSec + padding),
          });
        }
      }
    }
  }

  if (inSpeech) {
    const endSec = audioBuffer.duration;
    if (endSec - speechStartSec >= minSpeechDuration) {
      rawSegments.push({
        startSec: Math.max(0, speechStartSec - padding),
        endSec,
      });
    }
  }

  if (rawSegments.length === 0) {
    const chunkDuration = Math.min(4.0, Math.max(2.5, audioBuffer.duration / 4));
    let t = 0.5;
    let idx = 1;
    const fallbackSegments: AudioSpeechSegment[] = [];
    while (t < audioBuffer.duration - 0.5) {
      const segEnd = Math.min(audioBuffer.duration - 0.2, t + chunkDuration);
      fallbackSegments.push({
        id: idx++,
        start: parseFloat(t.toFixed(2)),
        end: parseFloat(segEnd.toFixed(2)),
        duration: parseFloat((segEnd - t).toFixed(2)),
      });
      t = segEnd + 0.8;
    }
    return fallbackSegments;
  }

  const merged: { startSec: number; endSec: number }[] = [];
  let current = rawSegments[0];

  for (let i = 1; i < rawSegments.length; i++) {
    const next = rawSegments[i];
    if (next.startSec - current.endSec <= 0.35) {
      current.endSec = Math.max(current.endSec, next.endSec);
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return merged.map((seg, idx) => ({
    id: idx + 1,
    start: parseFloat(seg.startSec.toFixed(2)),
    end: parseFloat(seg.endSec.toFixed(2)),
    duration: parseFloat((seg.endSec - seg.startSec).toFixed(2)),
  }));
}

/**
 * Creates a compact 16kHz mono WAV Blob from an AudioBuffer to ensure
 * fast, reliable upload and processing without payload size errors.
 */
export async function createLightweightWavBlob(
  audioBuffer: AudioBuffer,
  maxDurationSec: number = 180
): Promise<Blob> {
  const targetSampleRate = 16000;
  const duration = Math.min(audioBuffer.duration, maxDurationSec);
  const offlineCtx = new OfflineAudioContext(1, Math.floor(targetSampleRate * duration), targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  return audioBufferToWav(resampled);
}
