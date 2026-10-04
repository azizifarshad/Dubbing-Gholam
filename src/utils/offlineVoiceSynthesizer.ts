import { getAudioContext, audioBufferToWav } from './audioMixer';

// CRITICAL: Global Set to keep utterance objects alive in memory.
// Chromium's garbage collector destroys local SpeechSynthesisUtterance objects
// mid-sentence after 5-8 seconds, which causes truncated sentences (e.g. cutting off at "پاند...").
const activeUtterancesKeepAlive = new Set<SpeechSynthesisUtterance>();

let keepAliveInterval: any = null;

function ensureSpeechKeepAlive() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (!keepAliveInterval) {
    keepAliveInterval = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          // Chromium engine keep-alive tick to prevent internal pause on long sentences
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }
      }
    }, 5000);
  }
}

/**
 * Creates a clean, pristine audio buffer for timeline duration tracking
 * without any harsh noise or buzzing.
 */
export async function generateOfflineSpeechAudio(
  text: string,
  _voiceGender: 'female' | 'male' | 'deep' = 'female',
  targetDurationSec: number = 2.5
): Promise<{ audioBase64: string; duration: number }> {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate || 44100;

  // Estimate duration based on word count (approx ~0.42s per Persian word)
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const calculatedDuration = Math.max(1.8, Math.min(15, Math.max(targetDurationSec, wordCount * 0.45)));
  const totalSamples = Math.floor(sampleRate * calculatedDuration);

  const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  // Clean silence for pristine timeline placement
  for (let i = 0; i < totalSamples; i++) {
    channelData[i] = 0;
  }

  // Convert to clean standard WAV Blob
  const wavBlob = audioBufferToWav(audioBuffer);

  // Convert Blob to Base64
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64Data = result.replace(/^data:audio\/\w+;base64,/, '');
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(wavBlob);
  });

  return {
    audioBase64: base64,
    duration: calculatedDuration,
  };
}

/**
 * Speaks Persian text aloud in real-time with crystal-clear human speech
 * using the browser's native SpeechSynthesis engine.
 * Ensures sentences are spoken in their ENTIRETY without mid-sentence cutoffs.
 */
export function speakTextWithBrowser(
  text: string,
  voiceGender: 'female' | 'male' | 'deep' = 'female',
  onEnd?: () => void,
  targetDurationSec?: number,
  forceRestart: boolean = false
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd?.();
    return false;
  }

  try {
    ensureSpeechKeepAlive();

    if (forceRestart) {
      window.speechSynthesis.cancel();
      activeUtterancesKeepAlive.clear();
    }

    const cleanText = text.trim();
    if (!cleanText) {
      onEnd?.();
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'fa-IR'; // Persian / Farsi

    // Keep reference alive in memory to prevent Chrome GC bug
    activeUtterancesKeepAlive.add(utterance);
    (window as any).__lastSpeechUtterance = utterance;

    // Steady, consistent natural human speech: exactly 1.0 rate and 1.0 pitch.
    // Eliminates all unnatural speed jumping and pitch-shifting (زیر و بم شدن).
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Search for Persian / Farsi voice
    const voices = window.speechSynthesis.getVoices();
    const farsiVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().includes('fa') ||
        v.name.toLowerCase().includes('persian') ||
        v.name.toLowerCase().includes('farsi')
    );

    if (farsiVoice) {
      utterance.voice = farsiVoice;
    } else {
      const altVoice = voices.find(
        (v) =>
          v.lang.toLowerCase().includes('ar') ||
          v.name.toLowerCase().includes('natural') ||
          v.lang.toLowerCase().includes('en-us')
      );
      if (altVoice) {
        utterance.voice = altVoice;
      }
    }

    const finishHandler = () => {
      activeUtterancesKeepAlive.delete(utterance);
      onEnd?.();
    };

    utterance.onend = finishHandler;
    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis event error:', e);
      finishHandler();
    };

    // If currently paused, resume first
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    console.warn('SpeechSynthesis error:', err);
    onEnd?.();
    return false;
  }
}

/**
 * Stops any ongoing browser speech synthesis immediately
 */
export function stopBrowserSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      activeUtterancesKeepAlive.clear();
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    } catch (_) {}
  }
}
