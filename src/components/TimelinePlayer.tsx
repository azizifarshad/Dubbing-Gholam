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
  AlertTriangle,
  RefreshCw,
  Lock,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import { formatPlayerTime } from '../utils/srtParser';
import {
  getAudioContext,
  renderDubbedTrack,
  decodeBase64ToAudioBuffer,
} from '../utils/audioMixer';
import { deriveProjectOutputName } from '../utils/fileNaming';

interface TimelinePlayerProps {
  subtitles: SubtitleItem[];
  onUpdateSubtitle?: (id: number, partial: Partial<SubtitleItem>) => void;
  onUpdateAllSubtitles?: (items: SubtitleItem[]) => void;
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

interface OverlapDetail {
  prevSubId: number;
  nextSubId: number;
  prevIdx: number;
  nextIdx: number;
  overlapSec: number;
  prevEnd: number;
  nextStart: number;
}

export const TimelinePlayer: React.FC<TimelinePlayerProps> = ({
  subtitles,
  onUpdateSubtitle,
  onUpdateAllSubtitles,
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

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Timeline UI state
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1x to 3x
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);
  const [draggingSubId, setDraggingSubId] = useState<number | null>(null);
  const [soloPlayingId, setSoloPlayingId] = useState<number | null>(null);

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

  // Synchronize state when sharedAudioBuffer or sharedWavBlob from parent changes
  useEffect(() => {
    if (sharedAudioBuffer) {
      setRenderedMixBuffer(sharedAudioBuffer);
    }
  }, [sharedAudioBuffer]);

  useEffect(() => {
    if (sharedWavBlob) {
      setRenderedWavBlob(sharedWavBlob);
    }
  }, [sharedWavBlob]);

  // Audio nodes references
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const soloSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startEpochRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const animFrameIdRef = useRef<number | null>(null);

  // Timeline container element ref for drag calculations
  const timelineCanvasRef = useRef<HTMLDivElement | null>(null);
  const dragStartInfoRef = useRef<{ clientX: number; initialOffset: number } | null>(null);

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
    const effectiveVoiceEnd = (s.start + (s.audioOffset || 0)) + (s.audioDuration || (s.end - s.start));
    if (s.end > maxDuration) {
      maxDuration = s.end;
    }
    if (effectiveVoiceEnd > maxDuration) {
      maxDuration = effectiveVoiceEnd;
    }
  }
  maxDuration = Math.ceil(maxDuration + 1.0);

  // Calculate Overlaps / Collisions across all voice clips
  const overlaps: OverlapDetail[] = useMemo(() => {
    const list: OverlapDetail[] = [];
    if (subtitles.length < 2) return list;

    // Sort by effective start time
    const sorted = subtitles
      .map((sub, idx) => ({
        sub,
        idx,
        effectiveStart: Math.max(0, sub.start + (sub.audioOffset || 0)),
        duration: sub.audioDuration || Math.max(0.6, sub.end - sub.start),
      }))
      .sort((a, b) => a.effectiveStart - b.effectiveStart);

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      const currentEnd = current.effectiveStart + current.duration;

      // Overlap detected if current voice ends after next voice starts
      if (currentEnd > next.effectiveStart + 0.05) {
        const overlapSec = Number((currentEnd - next.effectiveStart).toFixed(2));
        list.push({
          prevSubId: current.sub.id,
          nextSubId: next.sub.id,
          prevIdx: current.idx,
          nextIdx: next.idx,
          overlapSec,
          prevEnd: currentEnd,
          nextStart: next.effectiveStart,
        });
      }
    }
    return list;
  }, [subtitles]);

  // Set of sub IDs involved in collisions for fast badge & highlight lookup
  const collidingSubIdMap = useMemo(() => {
    const map = new Map<number, { isPrev: boolean; isNext: boolean; overlapSec: number }>();
    for (const ov of overlaps) {
      map.set(ov.prevSubId, { isPrev: true, isNext: false, overlapSec: ov.overlapSec });
      map.set(ov.nextSubId, { isPrev: false, isNext: true, overlapSec: ov.overlapSec });
    }
    return map;
  }, [overlaps]);

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
    if (soloSourceRef.current) {
      try {
        soloSourceRef.current.stop();
        soloSourceRef.current.disconnect();
      } catch (_) {}
      soloSourceRef.current = null;
    }
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    setIsPlaying(false);
    isPlayingRef.current = false;
    setSoloPlayingId(null);
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

  // Solo preview for a single line's voice
  const handlePlaySoloVoice = async (sub: SubtitleItem) => {
    if (soloPlayingId === sub.id) {
      if (soloSourceRef.current) {
        try {
          soloSourceRef.current.stop();
          soloSourceRef.current.disconnect();
        } catch (_) {}
        soloSourceRef.current = null;
      }
      setSoloPlayingId(null);
      return;
    }

    if (!sub.audioBase64) return;

    stopPlayback();
    try {
      const ctx = getAudioContext();
      const buf = await decodeBase64ToAudioBuffer(sub.audioBase64);
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(ctx.destination);

      source.onended = () => {
        setSoloPlayingId(null);
        soloSourceRef.current = null;
      };

      soloSourceRef.current = source;
      setSoloPlayingId(sub.id);
      source.start(0);
    } catch (err) {
      console.error('Failed to play solo voice', err);
      setSoloPlayingId(null);
    }
  };

  // Fingerprint of all inputs including audioOffsets that determine the final rendered audio file
  const mixFingerprint = useMemo(() => {
    const subsHash = subtitles
      .map(
        (s) =>
          `${s.id}_${s.start.toFixed(2)}_${s.end.toFixed(2)}_${(s.audioOffset || 0).toFixed(2)}_${
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

  // Master Render Engine: automatically builds the exact output audio file whenever any voice, offset or setting changes!
  useEffect(() => {
    let isCancelled = false;

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

  // Global mouse listeners for dragging voice clips left/right on timeline
  useEffect(() => {
    if (draggingSubId === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartInfoRef.current || !timelineCanvasRef.current) return;
      const rect = timelineCanvasRef.current.getBoundingClientRect();
      const totalWidthPx = rect.width;
      if (totalWidthPx <= 0) return;

      const deltaX = e.clientX - dragStartInfoRef.current.clientX;
      const secondsPerPixel = maxDuration / totalWidthPx;
      const deltaSec = deltaX * secondsPerPixel;

      const newOffset = Math.round((dragStartInfoRef.current.initialOffset + deltaSec) * 100) / 100;
      // Clamp between -15s and +15s
      const clampedOffset = Math.max(-15, Math.min(15, newOffset));

      onUpdateSubtitle?.(draggingSubId, { audioOffset: clampedOffset });
    };

    const handleMouseUp = () => {
      setDraggingSubId(null);
      dragStartInfoRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingSubId, maxDuration, onUpdateSubtitle]);

  // Start dragging a voice clip
  const handleStartDragVoice = (e: React.MouseEvent, sub: SubtitleItem) => {
    e.stopPropagation();
    setDraggingSubId(sub.id);
    setSelectedSubId(sub.id);
    dragStartInfoRef.current = {
      clientX: e.clientX,
      initialOffset: sub.audioOffset || 0,
    };
  };

  // Nudge audio offset by fixed step (e.g. +0.1s or -0.1s)
  const handleNudgeOffset = (subId: number, delta: number) => {
    const sub = subtitles.find((s) => s.id === subId);
    if (!sub || !onUpdateSubtitle) return;
    const current = sub.audioOffset || 0;
    const next = Math.round((current + delta) * 100) / 100;
    const clamped = Math.max(-15, Math.min(15, next));
    onUpdateSubtitle(subId, { audioOffset: clamped });
  };

  // Reset offset for a specific line
  const handleResetLineOffset = (subId: number) => {
    onUpdateSubtitle?.(subId, { audioOffset: 0 });
  };

  // Automatic One-Click Overlap Resolver: adjusts offsets so no voice overlaps another!
  const handleAutoResolveOverlaps = () => {
    if (overlaps.length === 0 || !onUpdateAllSubtitles) return;

    // Sort by chronological effective start
    const sorted = [...subtitles].sort((a, b) => {
      const startA = a.start + (a.audioOffset || 0);
      const startB = b.start + (b.audioOffset || 0);
      return startA - startB;
    });

    const offsetMap = new Map<number, number>();
    let lastVoiceEnd = 0;

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const origStart = item.start;
      const currentOffset = item.audioOffset || 0;
      const currentStart = Math.max(0, origStart + currentOffset);
      const dur = item.audioDuration || Math.max(0.6, item.end - item.start);

      // If current voice collides with previous voice
      if (currentStart < lastVoiceEnd + 0.08) {
        // Shift this line so it starts cleanly 80ms after previous ends
        const cleanStart = lastVoiceEnd + 0.08;
        const newOffset = Math.round((cleanStart - origStart) * 100) / 100;
        offsetMap.set(item.id, newOffset);
        lastVoiceEnd = cleanStart + dur;
      } else {
        offsetMap.set(item.id, currentOffset);
        lastVoiceEnd = currentStart + dur;
      }
    }

    const updated = subtitles.map((s) => ({
      ...s,
      audioOffset: offsetMap.has(s.id) ? offsetMap.get(s.id) : s.audioOffset,
    }));
    onUpdateAllSubtitles(updated);
  };

  // Reset all offsets back to 0.00s (strictly anchored to subtitle start)
  const handleResetAllOffsets = () => {
    if (!onUpdateAllSubtitles) return;
    const reset = subtitles.map((s) => ({ ...s, audioOffset: 0 }));
    onUpdateAllSubtitles(reset);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (!renderedMixBuffer && isRenderingMix) {
        setRenderProgressMsg('صوت در حال همگام‌سازی نهایی است؛ بلافاصله پس از تکمیل پخش خواهد شد...');
        return;
      }
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

  // Direct download of the current rendered mix right from Stage 4
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
  const currentActiveSub = useMemo(() => {
    if (!subtitles || subtitles.length === 0) return null;
    for (let i = 0; i < subtitles.length; i++) {
      const s = subtitles[i];
      const nextS = subtitles[i + 1];
      const lineEnd = nextS ? Math.min(s.end + 0.3, nextS.start - 0.02) : s.end + 0.5;
      if (currentTime >= s.start && currentTime <= lineEnd) {
        return s;
      }
    }
    return null;
  }, [subtitles, currentTime]);

  const selectedSub = useMemo(() => {
    return subtitles.find((s) => s.id === selectedSubId) || null;
  }, [subtitles, selectedSubId]);

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
              استودیو میکس، خط زمان (Timeline) و تنظیم دستی/خودکار سینک
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
            متن و زمان‌بندی زیرنویس به صورت <strong className="text-slate-200">ثابت و قفل‌شده</strong> روی تایم‌لاین قرار دارند؛ شما می‌توانید صوت استخراج شده هر قسمت را به راحتی با کشیدن (Drag) یا کلیدهای جابجایی <strong className="text-amber-300">عقب و جلو</strong> کنید و در صورت تداخل یا افتادن صداها روی یکدیگر، سیستم هشدار داده و با یک کلیک آن را برطرف می‌کند.
          </p>
        </div>

        {/* Mix Output Status Badge & Quick Download */}
        <div className="flex flex-wrap items-center gap-2.5">
          {isRenderingMix ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{renderProgressMsg || 'در حال رندر فایل خروجی همگام...'}</span>
            </div>
          ) : renderedMixBuffer ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>فایل خروجی میکس آماده است</span>
            </div>
          ) : null}

          {renderedWavBlob && (
            <button
              type="button"
              onClick={handleDownloadCurrentMix}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 hover:text-amber-200 text-xs font-semibold transition shadow-sm font-mono"
              title={`دانلود فایل صوتی میکس نهایی: ${effectiveBaseName}.wav`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>دانلود خروجی ({effectiveBaseName}.wav)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (onUpdateAllSubtitles) {
                // Trigger a re-render
                onUpdateAllSubtitles([...subtitles]);
              }
            }}
            disabled={isRenderingMix}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold transition disabled:opacity-50"
            title="میکس مجدد صداها با آخرین آفست‌ها"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRenderingMix ? 'animate-spin' : ''}`} />
            <span>میکس مجدد</span>
          </button>
        </div>
      </div>

      {/* Overlap & Collision Alert Banner (اگر صدایی روی اونیکی صدا میره هم مشخص باشه) */}
      {overlaps.length > 0 ? (
        <div className="mb-6 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs shadow-lg animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-bounce" />
              <div>
                <div className="font-bold text-rose-300 text-sm flex items-center gap-2">
                  <span>هشدار تداخل صداها: {overlaps.length} دیالوگ روی جمله بعدی می‌افتد!</span>
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[11px] font-mono border border-rose-500/30">
                    Collision Detected
                  </span>
                </div>
                <div className="text-rose-300/80 mt-1 leading-relaxed">
                  مدت زمان گویندگی برخی جملات بیشتر از فاصله تا جمله بعدی است (مثلاً خط{' '}
                  {overlaps.map((o) => `#${o.prevIdx + 1} با #${o.nextIdx + 1} (${o.overlapSec}s)`).slice(0, 3).join('، ')}
                  {overlaps.length > 3 ? ` و ${overlaps.length - 3} مورد دیگر` : ''}).
                  می‌توانید صداها را عقب/جلو کنید یا با یک کلیک تداخل‌ها را خودکار برطرف نمایید.
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleAutoResolveOverlaps}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-400 hover:to-amber-400 text-slate-950 font-bold transition text-xs shadow-md"
                title="جابجایی خودکار صوت‌ها جهت برطرف کردن تداخل جملات"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>رفع خودکار تداخل‌ها (Shift To Fit)</span>
              </button>

              <button
                type="button"
                onClick={handleResetAllOffsets}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs border border-slate-700"
                title="بازنشانی تمام صداها به زمان شروع زیرنویس"
              >
                ریست آفست‌ها
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6 p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>هیچ تداخل صوتی وجود ندارد؛ تمام جملات به ترتیب و بدون هم‌پوشانی پایان می‌یابند.</span>
          </div>
          <div className="text-[11px] text-emerald-400/80 font-mono">
            {subtitles.length} دیالوگ منطبق با تصویر
          </div>
        </div>
      )}

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

      {/* Cinema Screen Subtitle Overlay Box */}
      <div className="mb-6 relative rounded-2xl bg-gradient-to-b from-slate-950 to-slate-900 border border-slate-800 p-6 flex flex-col items-center justify-center min-h-[135px] text-center overflow-hidden shadow-inner">
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
              {currentActiveSub.audioOffset !== undefined && currentActiveSub.audioOffset !== 0 && (
                <span className="font-mono text-cyan-300">
                  &bull; آفست: {currentActiveSub.audioOffset > 0 ? `+${currentActiveSub.audioOffset}` : currentActiveSub.audioOffset}s
                </span>
              )}
              {currentActiveSub.audioBase64 && (
                <span className="text-emerald-400 font-mono">&bull; صوت استودیویی آماده</span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-xs flex flex-col items-center gap-1">
            <span>در این ثانیه دیالوگی وجود ندارد (سکوت یا موسیقی فیلم)</span>
            <span className="text-[11px] text-slate-600">
              برای پخش یا پرش به خطوط دیالوگ از خط زمان زیر استفاده کنید
            </span>
          </div>
        )}
      </div>

      {/* STUDIO DUAL-TRACK TIMELINE */}
      <div className="mb-6 p-4 sm:p-5 bg-slate-950 rounded-3xl border border-slate-800 select-none shadow-xl">
        {/* Timeline Controls & Zoom Bar */}
        <div className="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-slate-800/80 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <MoveHorizontal className="w-4 h-4 text-amber-400" />
              <span>خط زمان چندترکه (Multi-Track Timeline):</span>
            </span>
            <span className="text-slate-500 text-[11px] hidden sm:inline">
              روی ترک صوت دوبله کلیک کنید یا آن را به چپ/راست بکشید تا سینک شود
            </span>
          </div>

          {/* Zoom Level Selector */}
          <div className="flex items-center gap-2 bg-slate-900 px-2 py-1 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400">بزرگ‌نمایی:</span>
            {[1, 1.5, 2, 3].map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setZoomLevel(lvl)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-mono transition ${
                  zoomLevel === lvl
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl}x
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Container when Zoom > 1 */}
        <div className="overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700">
          <div
            style={{ width: `${zoomLevel * 100}%`, minWidth: '100%' }}
            className="transition-all duration-150 relative"
          >
            {/* Time Ruler */}
            <div className="flex justify-between text-[11px] font-mono text-slate-500 mb-2 px-1">
              <span>00:00</span>
              <span>{formatPlayerTime(maxDuration * 0.25)}</span>
              <span>{formatPlayerTime(maxDuration * 0.5)}</span>
              <span>{formatPlayerTime(maxDuration * 0.75)}</span>
              <span>{formatPlayerTime(maxDuration)}</span>
            </div>

            {/* Interactive Timeline Canvas */}
            <div
              ref={timelineCanvasRef}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = clickX / rect.width;
                handleSeek(ratio * maxDuration);
              }}
              className="relative bg-slate-900/90 rounded-2xl border border-slate-800 p-3 overflow-hidden cursor-pointer"
            >
              {/* Subtle Grid Markings */}
              <div className="absolute inset-0 flex justify-between pointer-events-none opacity-15">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="border-r border-slate-600 w-full h-full" />
                ))}
              </div>

              {/* TRACK 1: FIXED REFERENCE SUBTITLE TRACK (متن زیرنویس با زمان‌بندی ثابت) */}
              <div className="relative h-14 mb-3 rounded-xl bg-slate-950/80 border border-slate-800/80 p-1 flex items-center">
                {/* Track label */}
                <div className="absolute right-2 top-1 text-[9px] font-bold text-slate-500 tracking-wider flex items-center gap-1 z-0 pointer-events-none">
                  <Lock className="w-2.5 h-2.5 text-amber-500/70" />
                  <span>ترک ۱: زیرنویس مرجع فیلم (زمان ثابت)</span>
                </div>

                {subtitles.map((sub, idx) => {
                  const leftPct = (sub.start / maxDuration) * 100;
                  const widthPct = Math.max(1.8, ((sub.end - sub.start) / maxDuration) * 100);
                  const isCurrentActive = currentTime >= sub.start && currentTime <= sub.end;
                  const isSelected = selectedSubId === sub.id;

                  return (
                    <div
                      key={`sub_fixed_${sub.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSubId(sub.id);
                        handleSeek(sub.start);
                      }}
                      title={`زیرنویس خط #${idx + 1} (${sub.startTimeStr} تا ${sub.endTimeStr})`}
                      className={`absolute top-1 bottom-1 rounded-lg px-2 flex flex-col justify-center border transition-all text-[10px] overflow-hidden ${
                        isSelected
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200 z-10 shadow-md ring-1 ring-amber-400/50'
                          : isCurrentActive
                          ? 'border-amber-500/80 bg-amber-500/10 text-amber-300 z-10'
                          : 'border-slate-700/80 bg-slate-800/70 text-slate-300 hover:border-slate-600'
                      }`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      <div className="flex items-center justify-between text-[9px] font-mono leading-none opacity-80">
                        <span>#{idx + 1}</span>
                        <span>{(sub.end - sub.start).toFixed(1)}s</span>
                      </div>
                      <div className="truncate font-sans font-medium text-[10px] mt-0.5">
                        {sub.farsiText || sub.originalText}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* TRACK 2: INTERACTIVE DUBBED VOICE AUDIO TRACK (صوت دوبله فارسی با قابلیت عقب/جلو کردن) */}
              <div className="relative h-18 rounded-xl bg-slate-950/80 border border-slate-800/80 p-1 flex items-center">
                {/* Track label */}
                <div className="absolute right-2 top-1 text-[9px] font-bold text-slate-500 tracking-wider flex items-center gap-1 z-0 pointer-events-none">
                  <Mic2 className="w-2.5 h-2.5 text-emerald-400/80" />
                  <span>ترک ۲: صوت دوبله فارسی (با کشیدن به چپ/راست سینک کنید)</span>
                </div>

                {subtitles.map((sub, idx) => {
                  const offset = sub.audioOffset || 0;
                  const effectiveStart = Math.max(0, sub.start + offset);
                  const effectiveDuration = sub.audioDuration || Math.max(0.6, sub.end - sub.start);
                  const leftPct = (effectiveStart / maxDuration) * 100;
                  const widthPct = Math.max(1.8, (effectiveDuration / maxDuration) * 100);

                  const isCurrentPlaying = currentTime >= effectiveStart && currentTime <= effectiveStart + effectiveDuration;
                  const isSelected = selectedSubId === sub.id;
                  const isDragging = draggingSubId === sub.id;
                  const collisionInfo = collidingSubIdMap.get(sub.id);
                  const hasAudio = Boolean(sub.audioBase64);

                  return (
                    <div
                      key={`voice_${sub.id}`}
                      onMouseDown={(e) => handleStartDragVoice(e, sub)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSubId(sub.id);
                      }}
                      title={`صوت دیالوگ #${idx + 1} | آفست: ${offset > 0 ? `+${offset}` : offset} ثانیه (برای جابجایی بکشید)`}
                      className={`absolute top-1 bottom-1 rounded-xl px-2.5 flex flex-col justify-center border transition-all text-[10px] overflow-hidden select-none cursor-ew-resize group ${
                        isDragging
                          ? 'border-cyan-400 bg-cyan-950/90 text-cyan-200 ring-2 ring-cyan-400 z-30 shadow-2xl scale-[1.03]'
                          : collisionInfo
                          ? 'border-rose-500 bg-rose-950/75 text-rose-200 ring-2 ring-rose-500/50 z-20 shadow-lg'
                          : isSelected
                          ? 'border-amber-400 bg-amber-500/25 text-amber-200 ring-2 ring-amber-400/60 z-20 shadow-lg'
                          : isCurrentPlaying
                          ? 'border-emerald-400 bg-emerald-950/80 text-emerald-200 ring-1 ring-emerald-400 z-10'
                          : hasAudio
                          ? 'border-emerald-500/60 bg-emerald-950/60 text-emerald-300 hover:border-emerald-400'
                          : 'border-slate-700 bg-slate-800/80 text-slate-400'
                      }`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      {/* Collision Warning Stripe Overlay */}
                      {collisionInfo && (
                        <div
                          className="absolute inset-0 pointer-events-none opacity-25"
                          style={{
                            backgroundImage:
                              'repeating-linear-gradient(45deg, #f43f5e 0, #f43f5e 8px, transparent 8px, transparent 16px)',
                          }}
                        />
                      )}

                      {/* Header with Line #, Offset Badge & Voice Name */}
                      <div className="flex items-center justify-between text-[9px] font-mono leading-none z-10">
                        <span className="font-bold">
                          #{idx + 1} {sub.voice}
                        </span>
                        {offset !== 0 ? (
                          <span
                            className={`px-1 rounded text-[8px] font-bold ${
                              offset > 0
                                ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/40'
                                : 'bg-purple-500/30 text-purple-200 border border-purple-500/40'
                            }`}
                          >
                            {offset > 0 ? `+${offset}` : offset}s
                          </span>
                        ) : (
                          <span className="text-[8px] opacity-70">
                            {effectiveDuration.toFixed(1)}s
                          </span>
                        )}
                      </div>

                      {/* Line dialogue text */}
                      <div className="truncate font-sans font-medium text-[10px] mt-0.5 z-10">
                        {sub.farsiText || sub.originalText}
                      </div>

                      {/* Collision Badge Alert */}
                      {collisionInfo && (
                        <div className="text-[8px] font-bold text-rose-300 flex items-center gap-1 mt-0.5 z-10 truncate">
                          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                          <span>تداخل {collisionInfo.overlapSec} ثانیه</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Master Playhead Line */}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-red-500 shadow-md shadow-red-500 pointer-events-none z-40"
                style={{
                  left: `${(currentTime / maxDuration) * 100}%`,
                }}
              >
                <div className="w-3 h-3 rounded-full bg-red-500 -translate-x-[5px] -translate-y-1 shadow" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SELECTED LINE SYNC INSPECTOR & FINE-TUNING PANEL */}
      {selectedSub && (
        <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-amber-500/30 shadow-xl animate-in fade-in duration-150">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-xs border border-amber-500/30 font-mono">
                #{subtitles.findIndex((s) => s.id === selectedSub.id) + 1}
              </span>
              <div>
                <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <span>تنظیم و سینک اختصاصی دیالوگ:</span>
                  <span className="text-xs text-amber-300 font-sans">{selectedSub.farsiText || selectedSub.originalText}</span>
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-3 mt-0.5 font-mono">
                  <span>زمان زیرنویس: {selectedSub.startTimeStr} تا {selectedSub.endTimeStr} ({(selectedSub.end - selectedSub.start).toFixed(2)}s)</span>
                  {selectedSub.audioDuration && (
                    <span className="text-emerald-400">طول صوت: {selectedSub.audioDuration.toFixed(2)}s</span>
                  )}
                </div>
              </div>
            </div>

            {/* Solo Preview Button for Selected Line */}
            <div className="flex items-center gap-2">
              {selectedSub.audioBase64 ? (
                <button
                  type="button"
                  onClick={() => handlePlaySoloVoice(selectedSub)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    soloPlayingId === selectedSub.id
                      ? 'bg-rose-500 text-white'
                      : 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  }`}
                >
                  {soloPlayingId === selectedSub.id ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>توقف تست صوت</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>تست صدای این جمله</span>
                    </>
                  )}
                </button>
              ) : (
                <span className="text-[11px] text-slate-500">صوت این خط هنوز ساخته نشده است</span>
              )}

              <button
                type="button"
                onClick={() => setSelectedSubId(null)}
                className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
              >
                بستن پنل &times;
              </button>
            </div>
          </div>

          {/* Precision Offset Slider & Quick Nudges */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            {/* Slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-300 whitespace-nowrap">جابجایی زمانی (Offset):</span>
              <input
                type="range"
                min="-5"
                max="5"
                step="0.05"
                value={selectedSub.audioOffset || 0}
                onChange={(e) =>
                  onUpdateSubtitle?.(selectedSub.id, {
                    audioOffset: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-amber-500 cursor-pointer"
              />
              <span className="font-mono text-xs w-16 text-center py-1 px-2 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 font-bold">
                {(selectedSub.audioOffset || 0) > 0 ? `+${(selectedSub.audioOffset || 0).toFixed(2)}` : (selectedSub.audioOffset || 0).toFixed(2)}s
              </span>
            </div>

            {/* Quick Nudge Buttons */}
            <div className="flex flex-wrap items-center justify-start md:justify-end gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => handleNudgeOffset(selectedSub.id, -0.5)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition font-mono"
              >
                -۰.۵ ثانیه
              </button>
              <button
                type="button"
                onClick={() => handleNudgeOffset(selectedSub.id, -0.1)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition font-mono"
              >
                -۰.۱ ثانیه
              </button>
              <button
                type="button"
                onClick={() => handleResetLineOffset(selectedSub.id)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-400 transition"
              >
                شروع همزمان (0.00s)
              </button>
              <button
                type="button"
                onClick={() => handleNudgeOffset(selectedSub.id, 0.1)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition font-mono"
              >
                +۰.۱ ثانیه
              </button>
              <button
                type="button"
                onClick={() => handleNudgeOffset(selectedSub.id, 0.5)}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 transition font-mono"
              >
                +۰.۵ ثانیه
              </button>
            </div>
          </div>
        </div>
      )}

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
