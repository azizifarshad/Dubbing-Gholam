import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SubtitleItem } from '../types/dubbing';
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
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { formatPlayerTime } from '../utils/srtParser';
import {
  getAudioContext,
  renderDubbedTrack,
  audioBufferToWav,
} from '../utils/audioMixer';
import { deriveProjectOutputName } from '../utils/fileNaming';

interface TimelinePlayerProps {
  subtitles: SubtitleItem[];
  originalAudioBuffer: AudioBuffer | null;
  originalAudioName: string;
  subtitleFileName?: string;
  outputBaseName?: string;
  mixMode: 'ducking' | 'isolated' | 'full_mix';
  onChangeMixMode: (mode: 'ducking' | 'isolated' | 'full_mix') => void;
  persianVolume: number;
  onChangePersianVolume: (vol: number) => void;
  backgroundVolume: number;
  onChangeBackgroundVolume: (vol: number) => void;
  duckingAmount: number;
  onChangeDuckingAmount: (val: number) => void;
  onMixRendered?: (res: { wavBlob: Blob; audioBuffer: AudioBuffer; totalDuration: number }) => void;
  sharedWavBlob?: Blob | null;
  sharedAudioBuffer?: AudioBuffer | null;
}

export const TimelinePlayer: React.FC<TimelinePlayerProps> = ({
  subtitles,
  originalAudioBuffer,
  originalAudioName,
  subtitleFileName,
  outputBaseName,
  mixMode,
  onChangeMixMode,
  persianVolume,
  onChangePersianVolume,
  backgroundVolume,
  onChangeBackgroundVolume,
  duckingAmount,
  onChangeDuckingAmount,
  onMixRendered,
  sharedWavBlob,
  sharedAudioBuffer,
}) => {
  const effectiveBaseName =
    (outputBaseName || '').trim() ||
    deriveProjectOutputName(originalAudioName, subtitleFileName) ||
    'persian_dub';
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Rendered Output Audio State
  const [renderedMixBuffer, setRenderedMixBuffer] = useState<AudioBuffer | null>(
    sharedAudioBuffer || null
  );
  const [renderedWavBlob, setRenderedWavBlob] = useState<Blob | null>(
    sharedWavBlob || null
  );
  const [isRenderingMix, setIsRenderingMix] = useState(false);
  const [renderProgressMsg, setRenderProgressMsg] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);

  // Audio nodes references
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const startEpochRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const animFrameIdRef = useRef<number | null>(null);

  // Keep ref synchronized
  currentTimeRef.current = currentTime;
  isPlayingRef.current = isPlaying;

  const readyVoicesCount = subtitles.filter((s) => Boolean(s.audioBase64)).length;

  // Determine total project duration
  let maxDuration = 10;
  if (renderedMixBuffer) {
    maxDuration = Math.max(maxDuration, renderedMixBuffer.duration);
  } else if (originalAudioBuffer) {
    maxDuration = Math.max(maxDuration, originalAudioBuffer.duration);
  }
  for (const s of subtitles) {
    if (s.end > maxDuration) {
      maxDuration = s.end;
    }
  }
  maxDuration = Math.ceil(maxDuration + 0.5);

  // Stop playback cleanly
  const stopPlayback = () => {
    if (masterSourceRef.current) {
      try {
        masterSourceRef.current.stop();
        masterSourceRef.current.disconnect();
      } catch (_) {}
      masterSourceRef.current = null;
    }
    if (masterGainRef.current) {
      try {
        masterGainRef.current.disconnect();
      } catch (_) {}
      masterGainRef.current = null;
    }
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
  };

  // Start playback of the EXACT rendered output mix buffer
  const startPlayback = (offsetSec: number) => {
    stopPlayback();

    const bufferToPlay = renderedMixBuffer || originalAudioBuffer;
    if (!bufferToPlay) return;

    const ctx = getAudioContext();
    audioCtxRef.current = ctx;

    const dur = bufferToPlay.duration;
    const clampedOffset = Math.max(0, Math.min(dur - 0.05, offsetSec));

    const source = ctx.createBufferSource();
    source.buffer = bufferToPlay;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(isMuted ? 0 : 1.0, ctx.currentTime);
    source.connect(gain);
    gain.connect(ctx.destination);

    masterSourceRef.current = source;
    masterGainRef.current = gain;

    source.start(0, clampedOffset);
    startEpochRef.current = ctx.currentTime - clampedOffset;
    setIsPlaying(true);
    isPlayingRef.current = true;

    source.onended = () => {
      if (audioCtxRef.current && masterSourceRef.current === source) {
        const elapsed = audioCtxRef.current.currentTime - startEpochRef.current;
        if (elapsed >= dur - 0.25) {
          stopPlayback();
          setCurrentTime(0);
        }
      }
    };

    const tick = () => {
      if (!audioCtxRef.current || !masterSourceRef.current) return;
      const elapsed = audioCtxRef.current.currentTime - startEpochRef.current;
      if (elapsed >= dur) {
        stopPlayback();
        setCurrentTime(0);
        return;
      }
      setCurrentTime(elapsed);
      animFrameIdRef.current = requestAnimationFrame(tick);
    };
    animFrameIdRef.current = requestAnimationFrame(tick);
  };

  // Fingerprint of all inputs that determine the final rendered audio file
  const mixFingerprint = useMemo(() => {
    const subsHash = subtitles
      .map(
        (s) =>
          `${s.id}_${s.start.toFixed(2)}_${s.end.toFixed(2)}_${
            s.audioBase64
              ? `${s.audioBase64.length}_${s.audioBase64.slice(0, 16)}_${s.audioBase64.slice(-16)}`
              : 'none'
          }`
      )
      .join('|');
    const bgHash = originalAudioBuffer
      ? `${originalAudioBuffer.duration.toFixed(2)}_${originalAudioBuffer.sampleRate}_${originalAudioBuffer.numberOfChannels}`
      : 'no-bg';
    return `${subsHash}##${bgHash}##${mixMode}##${persianVolume}##${backgroundVolume}##${duckingAmount}`;
  }, [
    subtitles,
    originalAudioBuffer,
    mixMode,
    persianVolume,
    backgroundVolume,
    duckingAmount,
  ]);

  // Master Render Engine: automatically builds the exact output audio file whenever any voice or setting changes!
  useEffect(() => {
    let isCancelled = false;

    // Small debounce to avoid redundant renders while dragging sliders
    const timer = setTimeout(async () => {
      const hasVoices = subtitles.some((s) => Boolean(s.audioBase64));
      if (!hasVoices && !originalAudioBuffer) {
        setRenderedMixBuffer(null);
        setRenderedWavBlob(null);
        setIsRenderingMix(false);
        return;
      }

      setIsRenderingMix(true);
      setRenderError(null);
      setRenderProgressMsg('در حال میکس و تولید فایل خروجی همگام...');

      try {
        const result = await renderDubbedTrack(
          {
            originalBuffer: originalAudioBuffer,
            subtitles,
            mixMode,
            persianVolume,
            backgroundVolume,
            duckingAmount,
          },
          (pct, msg) => {
            if (!isCancelled) {
              setRenderProgressMsg(msg);
            }
          }
        );

        if (!isCancelled) {
          setRenderedMixBuffer(result.audioBuffer);
          setRenderedWavBlob(result.wavBlob);
          setIsRenderingMix(false);
          onMixRendered?.(result);

          // If playing during a voice update, smoothly continue playing with the new audio!
          if (isPlayingRef.current) {
            startPlayback(currentTimeRef.current);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Master mix auto-render failed:', err);
          setRenderError(err.message || 'خطا در رندر فایل صوتی خروجی');
          setIsRenderingMix(false);
        }
      }
    }, 180);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [mixFingerprint]);

  // Clean cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, []);

  const handleTogglePlay = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback(currentTime);
    }
  };

  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(maxDuration, newTime));
    setCurrentTime(clamped);
    if (isPlaying) {
      startPlayback(clamped);
    }
  };

  const handleReset = () => {
    stopPlayback();
    setCurrentTime(0);
  };

  const handleSkip = (seconds: number) => {
    handleSeek(currentTime + seconds);
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setValueAtTime(
        nextMuted ? 0 : 1.0,
        audioCtxRef.current.currentTime
      );
    }
  };

  // Direct download of the current rendered mix right from Stage 4 with exact video/srt base name
  const handleDownloadCurrentMix = () => {
    if (!renderedWavBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(renderedWavBlob);
    a.download = `${effectiveBaseName}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Find currently active subtitle line for cinema preview
  const currentActiveSub = subtitles.find(
    (s) => currentTime >= s.start && currentTime <= s.end + 0.3
  );

  // Generate real audio waveform bars from the rendered output audio
  const waveformPeaks = useMemo(() => {
    const buf = renderedMixBuffer || originalAudioBuffer;
    if (!buf) return [];
    try {
      const channelData = buf.getChannelData(0);
      const numBars = 75;
      const step = Math.floor(channelData.length / numBars);
      const peaks: number[] = [];
      for (let i = 0; i < numBars; i++) {
        let max = 0;
        const start = i * step;
        const end = Math.min(channelData.length, start + step);
        for (let j = start; j < end; j += 8) {
          const val = Math.abs(channelData[j]);
          if (val > max) max = val;
        }
        peaks.push(Math.min(100, Math.max(14, Math.round(max * 100))));
      }
      return peaks;
    } catch (_) {
      return [];
    }
  }, [renderedMixBuffer, originalAudioBuffer]);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Step Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30">
              ۴
            </span>
            <h2 className="text-xl font-bold text-white">
              استودیو میکس، خط زمان (Timeline) و پخش همگام
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            فایل در حال پخش در این بخش دقیقاً همان فایل خروجی نهایی استودیو است. با تغییر هر ویس، خروجی به‌صورت آنی بازسازی و پخش می‌شود.
          </p>
        </div>

        {/* Mix Output Status Badge & Quick Download */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isRenderingMix ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{renderProgressMsg || 'در حال رندر فایل خروجی...'}</span>
            </div>
          ) : renderedMixBuffer ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>فایل خروجی نهایی همگام‌شده (WAV 16-bit PCM)</span>
            </div>
          ) : null}

          {renderedWavBlob && (
            <button
              type="button"
              onClick={handleDownloadCurrentMix}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 hover:text-amber-200 text-xs font-semibold transition shadow-sm font-mono"
              title={`دانلود فایل صوتی میکس نهایی همنام با فایل ورودی: ${effectiveBaseName}.wav`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>دانلود خروجی میکس ({effectiveBaseName}.wav)</span>
            </button>
          )}
        </div>
      </div>

      {/* Mix Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-2 rounded-2xl bg-slate-950/70 border border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 px-2">
          <Sliders className="w-4 h-4 text-amber-400" />
          <span>حالت میکس صدای فیلم و دوبله:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => onChangeMixMode('ducking')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'ducking'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>داکینگ هوشمند (کاهش صدای فیلم حین دیالوگ)</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeMixMode('isolated')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'isolated'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>فقط دوبله فارسی (خالص بدون فیلم)</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeMixMode('full_mix')}
            className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center gap-1.5 ${
              mixMode === 'full_mix'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>میکس همسطح (بدون داکینگ)</span>
          </button>
        </div>
      </div>

      {/* Render Error Alert */}
      {renderError && (
        <div className="mb-6 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{renderError}</span>
        </div>
      )}

      {/* No Voices Notice */}
      {readyVoicesCount === 0 && !originalAudioBuffer && (
        <div className="mb-6 p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <div className="font-bold text-amber-300 mb-0.5">
              هنوز ویس دوبله‌ای تولید نشده است
            </div>
            <div className="text-slate-400">
              برای ساخت و شنیدن فایل خروجی دوبله، ابتدا در مرحله ۳ (صداپیشگی) دکمه «تولید صدای دوبلورها» را بزنید.
            </div>
          </div>
        </div>
      )}

      {/* Cinema Screen Subtitle Overlay Box */}
      <div className="mb-6 relative rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900 border border-slate-800 p-6 flex flex-col items-center justify-center min-h-[140px] text-center overflow-hidden shadow-inner">
        <div className="absolute top-3 right-4 flex items-center gap-2 text-[11px] text-slate-500">
          <span
            className={`w-2 h-2 rounded-full ${
              isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span>نمایش زنده دیالوگ همگام با صوت خروجی</span>
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
              {currentActiveSub.audioBase64 && (
                <span className="text-emerald-400 font-mono">&bull; صوت استودیویی آماده</span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-xs flex flex-col items-center gap-1">
            <span>در این ثانیه دیالوگی وجود ندارد (سکوت یا صدای زمینه فیلم)</span>
            <span className="text-[11px] text-slate-600">
              برای پخش یا پرش به خطوط دیالوگ از نوار پایین استفاده کنید
            </span>
          </div>
        )}
      </div>

      {/* Visual Timeline Track with Real Rendered Waveform */}
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
          className="relative h-24 bg-slate-900/90 rounded-xl overflow-hidden cursor-pointer border border-slate-800 hover:border-slate-700 transition"
        >
          {/* Subtle grid lines */}
          <div className="absolute inset-0 flex justify-between pointer-events-none opacity-20">
            <div className="border-r border-slate-700 w-1/4 h-full" />
            <div className="border-r border-slate-700 w-1/4 h-full" />
            <div className="border-r border-slate-700 w-1/4 h-full" />
          </div>

          {/* Actual Rendered Audio Waveform */}
          {waveformPeaks.length > 0 && (
            <div className="absolute inset-x-0 bottom-1 top-7 flex items-center opacity-35 pointer-events-none px-2">
              <div className="w-full h-full flex items-center justify-between gap-[1px]">
                {waveformPeaks.map((peak, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-amber-500 to-purple-400 rounded-full mx-[0.5px]"
                    style={{ height: `${peak}%` }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleSeek(sub.start);
                }}
                title={`خط ${idx + 1}: ${sub.farsiText || sub.originalText} (کلیک برای پرش)`}
                className={`absolute top-2.5 bottom-2.5 rounded-lg px-2 flex flex-col justify-center border transition-all text-[10px] overflow-hidden cursor-pointer ${
                  isLineActive
                    ? 'bg-amber-500 border-amber-300 text-slate-950 font-bold z-10 scale-[1.03] shadow-lg shadow-amber-500/30'
                    : hasAudio
                    ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:border-emerald-400'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                <div className="font-mono text-[9px] truncate flex items-center justify-between">
                  <span>#{idx + 1}</span>
                  {hasAudio && <span className="text-[8px] font-sans opacity-90">{sub.voice}</span>}
                </div>
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
            disabled={!renderedMixBuffer && !originalAudioBuffer}
            className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold flex items-center justify-center transition shadow-lg shadow-amber-500/25 disabled:opacity-40"
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

          <button
            type="button"
            onClick={handleToggleMute}
            title={isMuted ? 'صدادار' : 'بی‌صدا'}
            className={`p-2.5 rounded-xl border transition ${
              isMuted
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
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
