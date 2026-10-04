import React, { useState, useEffect, useRef } from 'react';
import { SubtitleItem, AVAILABLE_VOICES } from '../types/dubbing';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Sliders,
  Sparkles,
  Layers,
  Music,
  Mic2,
  Clock,
  Radio,
  FastForward,
  Rewind,
} from 'lucide-react';
import { formatPlayerTime } from '../utils/srtParser';
import { getAudioContext, decodeBase64ToAudioBuffer } from '../utils/audioMixer';
import { speakTextWithBrowser, stopBrowserSpeech } from '../utils/offlineVoiceSynthesizer';

interface TimelinePlayerProps {
  subtitles: SubtitleItem[];
  originalAudioBuffer: AudioBuffer | null;
  originalAudioName: string;
  mixMode: 'ducking' | 'isolated' | 'full_mix';
  onChangeMixMode: (mode: 'ducking' | 'isolated' | 'full_mix') => void;
  persianVolume: number;
  onChangePersianVolume: (vol: number) => void;
  backgroundVolume: number;
  onChangeBackgroundVolume: (vol: number) => void;
  duckingAmount: number;
  onChangeDuckingAmount: (val: number) => void;
}

export const TimelinePlayer: React.FC<TimelinePlayerProps> = ({
  subtitles,
  originalAudioBuffer,
  originalAudioName,
  mixMode,
  onChangeMixMode,
  persianVolume,
  onChangePersianVolume,
  backgroundVolume,
  onChangeBackgroundVolume,
  duckingAmount,
  onChangeDuckingAmount,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Audio nodes references for live playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bgSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const bgGainNodeRef = useRef<GainNode | null>(null);
  const activeVoiceNodesRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode }[]>([]);
  const startPlaybackEpochRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);
  const speechBuffersCacheRef = useRef<Map<number, AudioBuffer>>(new Map());
  const spokenLineIdsRef = useRef<Set<number>>(new Set());

  // Determine total project duration
  let maxDuration = 10;
  if (originalAudioBuffer) {
    maxDuration = Math.max(maxDuration, originalAudioBuffer.duration);
  }
  for (const s of subtitles) {
    if (s.end > maxDuration) {
      maxDuration = s.end;
    }
  }
  maxDuration = Math.ceil(maxDuration + 1.0);

  // Pre-cache speech buffers
  useEffect(() => {
    let cancelled = false;
    const cacheBuffers = async () => {
      for (const sub of subtitles) {
        if (sub.audioBase64 && !speechBuffersCacheRef.current.has(sub.id)) {
          try {
            const buf = await decodeBase64ToAudioBuffer(sub.audioBase64);
            if (!cancelled) {
              speechBuffersCacheRef.current.set(sub.id, buf);
            }
          } catch (_) {}
        }
      }
    };
    cacheBuffers();
    return () => {
      cancelled = true;
    };
  }, [subtitles]);

  // Clean stop audio playback
  const stopLiveAudio = () => {
    stopBrowserSpeech();
    spokenLineIdsRef.current.clear();

    if (bgSourceNodeRef.current) {
      try {
        bgSourceNodeRef.current.stop();
        bgSourceNodeRef.current.disconnect();
      } catch (_) {}
      bgSourceNodeRef.current = null;
    }

    for (const v of activeVoiceNodesRef.current) {
      try {
        v.source.stop();
        v.source.disconnect();
      } catch (_) {}
    }
    activeVoiceNodesRef.current = [];

    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }

    setIsPlaying(false);
  };

  // Start live playback from a specific offset in seconds
  const startLiveAudio = async (offsetSec: number) => {
    stopLiveAudio();
    stopBrowserSpeech();
    spokenLineIdsRef.current.clear();

    const ctx = getAudioContext();
    audioCtxRef.current = ctx;

    const clampedOffset = Math.max(0, Math.min(maxDuration - 0.1, offsetSec));
    playbackOffsetRef.current = clampedOffset;
    startPlaybackEpochRef.current = ctx.currentTime - clampedOffset;

    // 1. Play Background Original Audio if present and not 'isolated'
    if (originalAudioBuffer && mixMode !== 'isolated' && clampedOffset < originalAudioBuffer.duration) {
      const bgSource = ctx.createBufferSource();
      bgSource.buffer = originalAudioBuffer;

      const bgGain = ctx.createGain();
      bgGainNodeRef.current = bgGain;

      // Apply initial volume
      const normalVol = isMuted ? 0 : 1.0;
      const duckedVol = isMuted
        ? 0
        : Math.max(0.05, 1.0 - duckingAmount * (1.0 - backgroundVolume));

      if (mixMode === 'ducking') {
        bgGain.gain.setValueAtTime(normalVol, ctx.currentTime);

        // Schedule ducking dips for each voice line with sequential collision avoidance
        let prevDuckingEnd = 0;
        for (let i = 0; i < subtitles.length; i++) {
          const sub = subtitles[i];
          if (sub.audioBase64) {
            const cachedBuf = speechBuffersCacheRef.current.get(sub.id);
            const lineStart = Math.max(sub.start, prevDuckingEnd > 0 ? prevDuckingEnd + 0.2 : sub.start);
            const lineDur = cachedBuf ? cachedBuf.duration : sub.end - sub.start;
            const lineEnd = lineStart + lineDur;
            prevDuckingEnd = lineEnd;

            if (lineEnd > clampedOffset) {
              const duckStartTime = ctx.currentTime + Math.max(0, lineStart - clampedOffset - 0.15);
              const duckFullTime = ctx.currentTime + Math.max(0, lineStart - clampedOffset);
              const duckEndTime = ctx.currentTime + Math.max(0, lineEnd - clampedOffset);
              const restoreTime = duckEndTime + 0.15;

              bgGain.gain.setValueAtTime(normalVol, duckStartTime);
              bgGain.gain.linearRampToValueAtTime(duckedVol, duckFullTime);
              bgGain.gain.setValueAtTime(duckedVol, duckEndTime);
              bgGain.gain.linearRampToValueAtTime(normalVol, restoreTime);
            }
          }
        }
      } else {
        bgGain.gain.setValueAtTime(isMuted ? 0 : backgroundVolume, ctx.currentTime);
      }

      bgSource.connect(bgGain);
      bgGain.connect(ctx.destination);
      bgSource.start(0, clampedOffset);
      bgSourceNodeRef.current = bgSource;
    }

    // 2. Schedule all Persian voice lines with guaranteed sequential collision avoidance and 1.0x natural pitch
    let previousVoiceEndTime = 0;
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      if (sub.audioBase64) {
        const cachedBuf = speechBuffersCacheRef.current.get(sub.id);
        if (!cachedBuf) continue;

        // Guaranteed collision avoidance:
        // A voice line NEVER starts until the previous line has completely finished + a 0.2s natural pause!
        const lineStart = Math.max(sub.start, previousVoiceEndTime > 0 ? previousVoiceEndTime + 0.2 : sub.start);
        const originalDuration = cachedBuf.duration;
        const lineEnd = lineStart + originalDuration;
        previousVoiceEndTime = lineEnd;

        if (lineEnd > clampedOffset) {
          const voiceSource = ctx.createBufferSource();
          voiceSource.buffer = cachedBuf;
          // Steady 1.0x playback rate: guarantees 100% natural vocal pitch without pitch-shifting
          voiceSource.playbackRate.setValueAtTime(1.0, 0);

          const voiceGain = ctx.createGain();
          voiceGain.gain.setValueAtTime(isMuted ? 0 : persianVolume, ctx.currentTime);

          voiceSource.connect(voiceGain);
          voiceGain.connect(ctx.destination);

          if (lineStart >= clampedOffset) {
            const delay = lineStart - clampedOffset;
            voiceSource.start(ctx.currentTime + delay, 0);
          } else {
            const innerOffset = clampedOffset - lineStart;
            voiceSource.start(ctx.currentTime, innerOffset);
          }

          activeVoiceNodesRef.current.push({ source: voiceSource, gain: voiceGain });
        }
      }
    }

    setIsPlaying(true);

    // Animation loop for tracking time & speaking dialogue
    const tick = () => {
      if (!audioCtxRef.current) return;
      const elapsed = audioCtxRef.current.currentTime - startPlaybackEpochRef.current;
      if (elapsed >= maxDuration) {
        stopLiveAudio();
        setCurrentTime(0);
        return;
      }
      setCurrentTime(elapsed);

      // Check if any dialogue line should be spoken
      if (!isMuted) {
        for (let i = 0; i < subtitles.length; i++) {
          const sub = subtitles[i];

          if (sub.farsiText && !spokenLineIdsRef.current.has(sub.id)) {
            // Trigger when timeline reaches or passes sub.start
            if (elapsed >= sub.start) {
              // Guaranteed non-overlapping & no incomplete cutoffs:
              // If the browser is STILL speaking the previous sentence, wait! Do NOT interrupt!
              const isStillSpeaking =
                typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking;

              if (isStillSpeaking) {
                // Defer starting this line until the previous sentence has fully completed every word
                continue;
              }

              spokenLineIdsRef.current.add(sub.id);
              const gender = sub.voice === 'Kore' ? 'female' : sub.voice === 'Fenrir' ? 'deep' : 'male';
              speakTextWithBrowser(sub.farsiText, gender);
            }
          }
        }
      }

      animFrameIdRef.current = requestAnimationFrame(tick);
    };
    animFrameIdRef.current = requestAnimationFrame(tick);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      stopLiveAudio();
    } else {
      startLiveAudio(currentTime);
    }
  };

  const handleSeek = (newTime: number) => {
    stopBrowserSpeech();
    spokenLineIdsRef.current.clear();
    const clamped = Math.max(0, Math.min(maxDuration, newTime));
    setCurrentTime(clamped);
    if (isPlaying) {
      startLiveAudio(clamped);
    }
  };

  const handleReset = () => {
    stopBrowserSpeech();
    spokenLineIdsRef.current.clear();
    stopLiveAudio();
    setCurrentTime(0);
  };

  const handleSkip = (seconds: number) => {
    handleSeek(currentTime + seconds);
  };

  // Find currently active subtitle line for cinema preview
  const currentActiveSub = subtitles.find(
    (s) => currentTime >= s.start && currentTime <= s.end + 0.3
  );

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Step Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30">
              ۴
            </span>
            <span>استودیو میکس، خط زمان (Timeline) و پخش همگام</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            صوت دوبله فارسی را همراه با صدای فیلم با الگوریتم کاهش خودکار نویز/داکینگ بشنوید و زمان‌بندی را بسنجید.
          </p>
        </div>

        {/* Mix Mode Selector */}
        <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => {
              onChangeMixMode('ducking');
              if (isPlaying) startLiveAudio(currentTime);
            }}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'ducking'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>داکینگ هوشمند (کاهش صدای فیلم در حین صحبت)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onChangeMixMode('isolated');
              if (isPlaying) startLiveAudio(currentTime);
            }}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'isolated'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>فقط دوبله فارسی (خالص)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onChangeMixMode('full_mix');
              if (isPlaying) startLiveAudio(currentTime);
            }}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'full_mix'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>میکس همسطح</span>
          </button>
        </div>
      </div>

      {/* Cinema Screen Subtitle Overlay Box */}
      <div className="mb-6 relative rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900 border border-slate-800 p-6 flex flex-col items-center justify-center min-h-[140px] text-center overflow-hidden shadow-inner">
        <div className="absolute top-3 right-4 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>پیش‌نمایش زنده زیرنویس و دیالوگ دوبله</span>
        </div>

        {currentActiveSub ? (
          <div className="animate-in fade-in zoom-in-95 duration-150 max-w-2xl">
            <div className="text-xl sm:text-2xl font-bold text-amber-300 drop-shadow-md leading-relaxed">
              {currentActiveSub.farsiText || currentActiveSub.originalText}
            </div>
            <div dir="ltr" className="text-xs text-slate-400 font-sans mt-2 opacity-80">
              {currentActiveSub.originalText}
            </div>
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-[11px] text-amber-400/90">
              <span>گوینده: {currentActiveSub.voice}</span>
              {currentActiveSub.emotion && <span>&bull; لحن: {currentActiveSub.emotion}</span>}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-xs flex flex-col items-center gap-1">
            <span>در این ثانیه دیالوگی وجود ندارد (سکوت یا صدای محیط فیلم)</span>
            <span className="text-[11px] text-slate-600">برای پخش یا پرش به خطوط دیالوگ از نوار پایین استفاده کنید</span>
          </div>
        )}
      </div>

      {/* Visual Timeline Track */}
      <div className="mb-6 p-4 bg-slate-950 rounded-2xl border border-slate-800 select-none">
        {/* Time ruler */}
        <div className="flex justify-between text-[11px] font-mono text-slate-500 mb-2 px-1">
          <span>00:00</span>
          <span>{formatPlayerTime(maxDuration / 4)}</span>
          <span>{formatPlayerTime(maxDuration / 2)}</span>
          <span>{formatPlayerTime((3 * maxDuration) / 4)}</span>
          <span>{formatPlayerTime(maxDuration)}</span>
        </div>

        {/* Timeline Interactive Canvas Area */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const ratio = clickX / rect.width;
            handleSeek(ratio * maxDuration);
          }}
          className="relative h-20 bg-slate-900 rounded-xl overflow-hidden cursor-pointer border border-slate-800 hover:border-slate-700 transition"
        >
          {/* Subtle grid lines */}
          <div className="absolute inset-0 flex justify-between pointer-events-none opacity-20">
            <div className="border-r border-slate-700 w-1/4 h-full" />
            <div className="border-r border-slate-700 w-1/4 h-full" />
            <div className="border-r border-slate-700 w-1/4 h-full" />
          </div>

          {/* Background Audio Waveform representation */}
          {originalAudioBuffer && (
            <div className="absolute inset-x-0 bottom-1 top-8 flex items-center opacity-30 pointer-events-none px-1">
              <div className="w-full h-full flex items-center justify-around gap-[1px]">
                {Array.from({ length: 60 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-purple-400 rounded-full"
                    style={{
                      height: `${20 + Math.sin(i * 0.3) * 35 + ((i % 5) * 8)}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Subtitle / Persian Speech Blocks on Timeline */}
          {subtitles.map((sub, idx) => {
            const leftPct = (sub.start / maxDuration) * 100;
            const widthPct = Math.max(1.5, ((sub.end - sub.start) / maxDuration) * 100);
            const isLineActive = currentTime >= sub.start && currentTime <= sub.end;
            const hasAudio = Boolean(sub.audioBase64);

            return (
              <div
                key={sub.id}
                title={`خط ${idx + 1}: ${sub.farsiText || sub.originalText}`}
                className={`absolute top-2.5 bottom-2.5 rounded-lg px-2 flex flex-col justify-center border transition-all text-[10px] overflow-hidden ${
                  isLineActive
                    ? 'bg-amber-500 border-amber-300 text-slate-950 font-bold z-10 scale-[1.03] shadow-lg shadow-amber-500/30'
                    : hasAudio
                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                <div className="font-mono text-[9px] truncate">#{idx + 1}</div>
                <div className="truncate font-sans font-medium">
                  {sub.farsiText || sub.originalText}
                </div>
              </div>
            );
          })}

          {/* Playhead Cursor */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-md shadow-red-500 pointer-events-none z-20"
            style={{
              left: `${(currentTime / maxDuration) * 100}%`,
            }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 -translate-x-[4px] -translate-y-1" />
          </div>
        </div>
      </div>

      {/* Playback Controls & Sliders */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
        {/* Play/Pause/Seek Buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            title="بازگشت به ابتدا"
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => handleSkip(-5)}
            title="۵ ثانیه عقب"
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
          >
            <Rewind className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold flex items-center justify-center transition shadow-lg shadow-amber-500/25"
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 fill-current" />
            ) : (
              <Play className="w-6 h-6 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSkip(5)}
            title="۵ ثانیه جلو"
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
          >
            <FastForward className="w-4 h-4" />
          </button>

          {/* Time Display */}
          <div className="font-mono text-sm px-3 py-2 bg-slate-900 rounded-xl border border-slate-800 text-slate-200">
            <span className="text-amber-400 font-semibold">{formatPlayerTime(currentTime)}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span className="text-slate-400">{formatPlayerTime(maxDuration)}</span>
          </div>
        </div>

        {/* Volume & Ducking Sliders */}
        <div className="flex flex-wrap items-center gap-5 text-xs text-slate-300 w-full md:w-auto">
          {/* Persian Voice Volume */}
          <div className="flex items-center gap-2">
            <Mic2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="whitespace-nowrap">صدای دوبله:</span>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={persianVolume}
              onChange={(e) => onChangePersianVolume(parseFloat(e.target.value))}
              className="w-20 accent-amber-500 cursor-pointer"
            />
            <span className="w-8 font-mono text-[11px] text-slate-400">
              {Math.round(persianVolume * 100)}%
            </span>
          </div>

          {/* Background Video Audio Volume */}
          {originalAudioBuffer && mixMode !== 'isolated' && (
            <div className="flex items-center gap-2">
              <Music className="w-3.5 h-3.5 text-purple-400" />
              <span className="whitespace-nowrap">صدای فیلم:</span>
              <input
                type="range"
                min="0"
                max="1.0"
                step="0.05"
                value={backgroundVolume}
                onChange={(e) => onChangeBackgroundVolume(parseFloat(e.target.value))}
                className="w-20 accent-purple-500 cursor-pointer"
              />
              <span className="w-8 font-mono text-[11px] text-slate-400">
                {Math.round(backgroundVolume * 100)}%
              </span>
            </div>
          )}

          {/* Ducking Amount */}
          {originalAudioBuffer && mixMode === 'ducking' && (
            <div className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              <span className="whitespace-nowrap">شدت داکینگ:</span>
              <input
                type="range"
                min="0"
                max="1.0"
                step="0.05"
                value={duckingAmount}
                onChange={(e) => onChangeDuckingAmount(parseFloat(e.target.value))}
                className="w-20 accent-emerald-500 cursor-pointer"
              />
              <span className="w-8 font-mono text-[11px] text-slate-400">
                {Math.round(duckingAmount * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
