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
 * Creates an audible, pleasant, natural voice audio buffer for timeline duration tracking
 * and offline playback with syllable-modulated vocal formants.
 */
export async function generateOfflineSpeechAudio(
  text: string,
  voiceGender: 'female' | 'male' | 'deep' = 'male',
  targetDurationSec: number = 2.5
): Promise<{ audioBase64: string; duration: number }> {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate || 44100;

  // Estimate duration based on word count (approx ~0.38s per Persian word)
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const calculatedDuration = Math.max(1.2, Math.min(15, Math.max(targetDurationSec, wordCount * 0.38)));
  const totalSamples = Math.floor(sampleRate * calculatedDuration);

  const audioBuffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  // Pitch base frequency
  const baseF0 = voiceGender === 'female' ? 215 : voiceGender === 'deep' ? 120 : 145;

  // Generate pleasant voice harmonics with syllable envelope
  const syllablesPerSec = Math.max(2.5, Math.min(4.5, (wordCount * 2) / calculatedDuration));

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // Fade in/out at extremes
    let globalEnv = 1.0;
    if (t < 0.05) globalEnv = t / 0.05;
    else if (t > calculatedDuration - 0.08) globalEnv = (calculatedDuration - t) / 0.08;

    // Syllable modulation
    const sylPhase = (t * syllablesPerSec * 2 * Math.PI) % (2 * Math.PI);
    const sylEnv = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(sylPhase)), 1.5);

    // Natural vocal pitch micro-inflection
    const pitchDrift = 1.0 + 0.04 * Math.sin(t * 3.0) + 0.02 * Math.sin(t * 7.5);
    const f0 = baseF0 * pitchDrift;

    // Vocal harmonics (glottal pulse approximation: fundamental + 2nd, 3rd, 4th harmonics)
    const h1 = Math.sin(2 * Math.PI * f0 * t) * 0.45;
    const h2 = Math.sin(2 * Math.PI * (f0 * 2) * t) * 0.25;
    const h3 = Math.sin(2 * Math.PI * (f0 * 3) * t) * 0.15;
    const h4 = Math.sin(2 * Math.PI * (f0 * 4) * t) * 0.08;

    // Soft formant vowel resonance
    const formant1 = Math.sin(2 * Math.PI * (baseF0 * 4.5) * t) * 0.12;

    const sample = (h1 + h2 + h3 + h4 + formant1) * sylEnv * globalEnv * 0.28;
    channelData[i] = Math.max(-1.0, Math.min(1.0, sample));
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
