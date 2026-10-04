import React, { useState, useRef, useEffect } from 'react';
import { SubtitleItem, AVAILABLE_VOICES, SPEECH_PERSONAS } from '../types/dubbing';
import {
  Mic2,
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertCircle,
  Loader2,
  Volume2,
  Square,
  Timer,
  Info,
  Radio,
  ExternalLink,
  GraduationCap,
  Zap,
  Cpu,
  Key,
} from 'lucide-react';
import { decodeBase64ToAudioBuffer, getAudioContext } from '../utils/audioMixer';
import { generateOfflineSpeechAudio, speakTextWithBrowser, stopBrowserSpeech } from '../utils/offlineVoiceSynthesizer';

interface VoiceSynthesisStudioProps {
  apiKey: string;
  subtitles: SubtitleItem[];
  onUpdateSubtitle: (id: number, partial: Partial<SubtitleItem>) => void;
  onUpdateAllSubtitles: (items: SubtitleItem[]) => void;
  onProceedToMixer: () => void;
  onOpenApiKeyModal?: () => void;
}

interface CountdownState {
  lineId: number;
  lineIndex: number;
  secondsLeft: number;
  totalSeconds: number;
  message?: string;
}

export const VoiceSynthesisStudio: React.FC<VoiceSynthesisStudioProps> = ({
  apiKey,
  subtitles,
  onUpdateSubtitle,
  onUpdateAllSubtitles,
  onProceedToMixer,
  onOpenApiKeyModal,
}) => {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('patient_teacher');
  const [voiceEngine, setVoiceEngine] = useState<'gemini' | 'browser'>('gemini');
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [currentGeneratingId, setCurrentGeneratingId] = useState<number | null>(null);
  const [isDailyLimitHit, setIsDailyLimitHit] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [countdownInfo, setCountdownInfo] = useState<CountdownState | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [playingLineId, setPlayingLineId] = useState<number | null>(null);

  const activeAudioNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const cancelRequestedRef = useRef<boolean>(false);

  const readyVoicesCount = subtitles.filter((s) => s.audioBase64).length;
  const isAllReady = subtitles.length > 0 && readyVoicesCount === subtitles.length;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRequestedRef.current = true;
      if (activeAudioNodeRef.current) {
        try {
          activeAudioNodeRef.current.stop();
        } catch (_) {}
      }
    };
  }, []);

  // Play a single line's generated audio
  const handlePlayLineAudio = async (sub: SubtitleItem) => {
    if (playingLineId === sub.id) {
      stopBrowserSpeech();
      if (activeAudioNodeRef.current) {
        try {
          activeAudioNodeRef.current.stop();
        } catch (_) {}
      }
      setPlayingLineId(null);
      return;
    }

    // Stop currently playing
    stopBrowserSpeech();
    if (activeAudioNodeRef.current) {
      try {
        activeAudioNodeRef.current.stop();
      } catch (_) {}
    }

    setPlayingLineId(sub.id);

    // If browser voice engine, speak text aloud with crystal-clear human speech
    if (voiceEngine === 'browser') {
      const gender = sub.voice === 'Kore' ? 'female' : sub.voice === 'Fenrir' ? 'deep' : 'male';
      speakTextWithBrowser(
        sub.farsiText,
        gender,
        () => {
          setPlayingLineId(null);
        },
        undefined,
        true
      );
      return;
    }

    // If Gemini mode and real audio exists, play the Gemini audio
    if (sub.audioBase64) {
      try {
        const ctx = getAudioContext();
        const buffer = await decodeBase64ToAudioBuffer(sub.audioBase64);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        source.onended = () => {
          setPlayingLineId(null);
        };

        activeAudioNodeRef.current = source;
        source.start(0);
      } catch (err: any) {
        console.error('Failed to play line audio', err);
        setPlayingLineId(null);
      }
    } else {
      // Fallback: speak aloud
      const gender = sub.voice === 'Kore' ? 'female' : sub.voice === 'Fenrir' ? 'deep' : 'male';
      speakTextWithBrowser(sub.farsiText, gender, () => {
        setPlayingLineId(null);
      });
    }
  };

  // Generate offline voice instantly without consuming any Gemini API quota
  const generateSingleOfflineVoice = async (sub: SubtitleItem): Promise<boolean> => {
    if (!sub.farsiText.trim()) return false;
    setCurrentGeneratingId(sub.id);
    onUpdateSubtitle(sub.id, { status: 'generating', error: undefined });

    try {
      const targetDuration = Math.max(1.5, sub.end - sub.start);
      const gender = sub.voice === 'Kore' ? 'female' : sub.voice === 'Fenrir' ? 'deep' : 'male';
      const result = await generateOfflineSpeechAudio(sub.farsiText, gender, targetDuration);

      onUpdateSubtitle(sub.id, {
        audioBase64: result.audioBase64,
        audioDuration: result.duration,
        status: 'ready',
        error: undefined,
      });

      setCurrentGeneratingId(null);
      return true;
    } catch (err: any) {
      console.error('Offline speech error:', err);
      onUpdateSubtitle(sub.id, {
        status: 'error',
        error: 'خطا در سنتز صوت محلی',
      });
      setCurrentGeneratingId(null);
      return false;
    }
  };

  // Generate TTS for a single subtitle line with auto-retry and daily quota detection
  const generateSingleTTSWithRetry = async (
    sub: SubtitleItem,
    lineIndex: number,
    maxRetries: number = 3
  ): Promise<boolean> => {
    if (!sub.farsiText.trim()) return false;
    if (cancelRequestedRef.current) return false;

    // If browser engine mode is selected, use offline generator directly!
    if (voiceEngine === 'browser') {
      return await generateSingleOfflineVoice(sub);
    }

    setCurrentGeneratingId(sub.id);
    onUpdateSubtitle(sub.id, { status: 'generating', error: undefined });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (cancelRequestedRef.current) return false;

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
          },
          body: JSON.stringify({
            text: sub.farsiText.trim(),
            voice: sub.voice || 'Kore',
            persona: selectedPersonaId,
            emotion: sub.emotion,
            apiKey,
          }),
        });

        const data = await res.json();

        // Check if daily quota is reached (10 requests per day) -> DO NOT do a 17h countdown!
        if (data.isDailyLimit || (data.retryAfterSeconds && data.retryAfterSeconds > 300)) {
          setIsDailyLimitHit(true);
          setCountdownInfo(null);
          setCurrentGeneratingId(null);
          cancelRequestedRef.current = true;
          onUpdateSubtitle(sub.id, {
            status: 'error',
            error: 'سهمیه روزانه رایگان گوگل تکمیل شده است. از موتور مرورگر استفاده کنید.',
          });
          return false;
        }

        // Check if server is experiencing temporary high demand (503 / UNAVAILABLE)
        if (res.status === 503 || data.isHighDemand || data.error?.includes('high demand') || data.error?.includes('UNAVAILABLE')) {
          const waitSeconds = Math.max(3, data.retryAfterSeconds || 4);
          for (let sec = waitSeconds; sec > 0; sec--) {
            if (cancelRequestedRef.current) {
              setCountdownInfo(null);
              return false;
            }
            setCountdownInfo({
              lineId: sub.id,
              lineIndex,
              secondsLeft: sec,
              totalSeconds: waitSeconds,
              message: 'ترافیک موقت سرورهای هوش مصنوعی؛ در حال تلاش مجدد خودکار...',
            });
            await new Promise((r) => setTimeout(r, 1000));
          }
          setCountdownInfo(null);
          continue;
        }

        // Check if minute rate limited (429 / RESOURCE_EXHAUSTED)
        if (res.status === 429 || data.isRateLimited) {
          const waitSeconds = Math.max(10, Math.min(60, data.retryAfterSeconds || 32));

          for (let sec = waitSeconds; sec > 0; sec--) {
            if (cancelRequestedRef.current) {
              setCountdownInfo(null);
              return false;
            }

            setCountdownInfo({
              lineId: sub.id,
              lineIndex,
              secondsLeft: sec,
              totalSeconds: waitSeconds,
              message: 'سقف سهمیه رایگان (۳ درخواست در دقیقه) تکمیل شد. در حال انتظار جهت تمدید سهمیه...',
            });

            await new Promise((r) => setTimeout(r, 1000));
          }

          setCountdownInfo(null);
          continue;
        }

        if (!res.ok || !data.success || !data.audioBase64) {
          throw new Error(data.error || 'خطا در تولید صوت دوبله');
        }

        // Successfully received audio
        let audioDuration = 0;
        try {
          const buf = await decodeBase64ToAudioBuffer(data.audioBase64);
          audioDuration = buf.duration;
        } catch (_) {}

        onUpdateSubtitle(sub.id, {
          audioBase64: data.audioBase64,
          audioDuration,
          status: 'ready',
          error: undefined,
        });

        setCountdownInfo(null);
        setCurrentGeneratingId(null);
        return true;
      } catch (err: any) {
        console.error(`Attempt ${attempt + 1} failed for line ${sub.id}:`, err);
        if (attempt === maxRetries) {
          onUpdateSubtitle(sub.id, {
            status: 'error',
            error: err.message || 'خطا در تولید صدا',
          });
          setCountdownInfo(null);
          setCurrentGeneratingId(null);
          return false;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setCurrentGeneratingId(null);
    setCountdownInfo(null);
    return false;
  };

  // Generate TTS for all subtitle lines sequentially
  const handleGenerateAll = async (forcedEngine?: 'gemini' | 'browser') => {
    const activeEngine = forcedEngine || voiceEngine;
    const linesToProcess = subtitles.filter((s) => s.farsiText.trim().length > 0);
    if (linesToProcess.length === 0) {
      setGlobalError('ابتدا متن زیرنویس را به فارسی ترجمه کنید.');
      return;
    }

    cancelRequestedRef.current = false;
    setIsGeneratingAll(true);
    setGlobalError(null);
    setIsDailyLimitHit(false);
    setGenerationProgress({ current: 0, total: linesToProcess.length });

    for (let i = 0; i < linesToProcess.length; i++) {
      if (cancelRequestedRef.current) break;

      const sub = linesToProcess[i];
      setGenerationProgress({ current: i + 1, total: linesToProcess.length });

      if (sub.audioBase64 && sub.status === 'ready') {
        continue;
      }

      if (activeEngine === 'browser') {
        await generateSingleOfflineVoice(sub);
        await new Promise((r) => setTimeout(r, 60)); // Ultra-fast inter-line pacing
      } else {
        await generateSingleTTSWithRetry(sub, i + 1);
        if (!cancelRequestedRef.current && i < linesToProcess.length - 1) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }

    setIsGeneratingAll(false);
    setCurrentGeneratingId(null);
    setCountdownInfo(null);
  };

  // Stop / Cancel active generation
  const handleCancelGeneration = () => {
    cancelRequestedRef.current = true;
    setIsGeneratingAll(false);
    setCurrentGeneratingId(null);
    setCountdownInfo(null);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30">
              ۳
            </span>
            <span>تولید صدای دوبلورها با پرسونای گوگل (The Patient Teacher)</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            صداپیشگی سینمایی فارسی با پرسونای منتخب Google AI Studio یا تبدیل فوق سریع آفلاین
          </p>
        </div>

        {/* Global Generator Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-950 border border-slate-700/80 px-3.5 py-1.5 rounded-xl flex items-center gap-2 text-xs">
            <span className="text-slate-400">صداهای آماده:</span>
            <span className="font-bold text-emerald-400">
              {readyVoicesCount} از {subtitles.length}
            </span>
          </div>

          {/* Engine Selector Toggle */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center text-xs">
            <button
              type="button"
              onClick={() => setVoiceEngine('gemini')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
                voiceEngine === 'gemini'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>هوش مصنوعی جمینای</span>
            </button>
            <button
              type="button"
              onClick={() => setVoiceEngine('browser')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
                voiceEngine === 'browser'
                  ? 'bg-emerald-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>فوری مرورگر (بدون سهمیه)</span>
            </button>
          </div>

          {isGeneratingAll ? (
            <button
              type="button"
              onClick={handleCancelGeneration}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition shadow-lg shadow-rose-500/10"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>توقف فرایند</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleGenerateAll()}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
            >
              <Mic2 className="w-4 h-4" />
              <span>تولید همزمان تمام صداها</span>
            </button>
          )}
        </div>
      </div>

      {/* Daily Quota Exhausted Banner with Instant Resolution */}
      {isDailyLimitHit && (
        <div className="mb-6 p-5 bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 rounded-2xl border border-amber-500/60 shadow-xl shadow-amber-500/10">
          <div className="flex items-center gap-2.5 font-bold text-amber-300 mb-2">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            <span className="text-sm">سهمیه روزانه مدل صوتی رایگان گوگل (۱۰ درخواست در روز) تکمیل شده است</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            سهمیه پلن رایگان جمینای برای تولید صوت به سقف ۱۰ درخواست روزانه رسیده است. برای ادامه بدون معطلی، می‌توانید با زدن دکمه زیر بقیه خطوط را بلافاصله با موتور صوتی مرورگر (WAV بدون افت هماهنگی) بسازید یا یک کلید جدید وارد کنید:
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setVoiceEngine('browser');
                handleGenerateAll('browser');
              }}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Zap className="w-4 h-4" />
              <span>تولید فوری باقی خطوط با موتور مرورگر (آفلاین)</span>
            </button>

            {onOpenApiKeyModal && (
              <button
                type="button"
                onClick={onOpenApiKeyModal}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition flex items-center gap-2"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>تنظیم کلید جدید API یا دارای Billing</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Google AI Studio Speech Persona Selector (The Patient Teacher & Presets) */}
      <div className="mb-6 p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-amber-400" />
            <span>پرسونای گفتاری هوش مصنوعی گوگل (AI Studio Speech Persona):</span>
          </label>
          <a
            href="https://aistudio.google.com/generate-speech"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-amber-400/80 hover:text-amber-300 flex items-center gap-1 transition"
          >
            <span>همانند ابزار Generate Speech گوگل</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {SPEECH_PERSONAS.map((p) => {
            const isSelected = selectedPersonaId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedPersonaId(p.id);
                  const updated = subtitles.map((s) => ({
                    ...s,
                    voice: p.defaultVoice,
                  }));
                  onUpdateAllSubtitles(updated);
                }}
                className={`p-3 rounded-xl border text-right transition ${
                  isSelected
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200 shadow-md shadow-amber-500/10'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-slate-100">{p.nameFa}</span>
                  {isSelected && <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />}
                </div>
                <div className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">
                  {p.descriptionFa}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prominent Rate-Limit Auto-Retry Countdown Banner (Only for short RPM limits) */}
      {countdownInfo && !isDailyLimitHit && (
        <div className="mb-6 p-5 bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 rounded-2xl border border-amber-500/60 shadow-xl shadow-amber-500/10 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Timer className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-300">
                  {countdownInfo.message || 'در حال انتظار جهت تمدید سهمیه...'}
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  خط {countdownInfo.lineIndex} از {subtitles.length} پس از پایان شمارش معکوس به طور خودکار ضبط خواهد شد.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-slate-950 font-black text-sm flex items-center gap-1.5 shadow-md shadow-amber-500/20 font-mono">
                <span>{countdownInfo.secondsLeft}</span>
                <span className="text-xs font-sans font-bold">ثانیه دیگر</span>
              </div>

              <button
                type="button"
                onClick={handleCancelGeneration}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
              >
                انصراف
              </button>
            </div>
          </div>

          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-1000 ease-linear"
              style={{
                width: `${Math.max(0, Math.min(100, (1 - countdownInfo.secondsLeft / countdownInfo.totalSeconds) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Progress Bar during normal generation */}
      {isGeneratingAll && !countdownInfo && (
        <div className="mb-6 p-4 bg-slate-950 rounded-2xl border border-emerald-500/30">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>
                در حال صداپیشگی دیالوگ‌ها ({generationProgress.current} از {generationProgress.total}) با{' '}
                {voiceEngine === 'browser' ? 'موتور مرورگر' : 'جمینای'}...
              </span>
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {Math.round((generationProgress.current / generationProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
              style={{
                width: `${(generationProgress.current / generationProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {globalError && (
        <div className="mb-4 p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Lines Grid */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
        {subtitles.map((sub, idx) => {
          const isGenerating = currentGeneratingId === sub.id;
          const isPlaying = playingLineId === sub.id;
          const isThisLineCountingDown = countdownInfo?.lineId === sub.id;
          const hasAudio = Boolean(sub.audioBase64);
          const sceneDuration = sub.end - sub.start;
          const voiceMeta = AVAILABLE_VOICES.find((v) => v.id === sub.voice) || AVAILABLE_VOICES[0];
          const isTimingTight = sub.audioDuration && sub.audioDuration > sceneDuration + 0.5;

          return (
            <div
              key={sub.id}
              className={`p-4 rounded-2xl border transition-all ${
                isThisLineCountingDown
                  ? 'bg-amber-950/30 border-amber-500/60 shadow-lg shadow-amber-500/5'
                  : hasAudio
                  ? 'bg-slate-950/70 border-emerald-500/30 hover:border-emerald-500/50'
                  : 'bg-slate-950/40 border-slate-800'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: Info & Voice Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-mono">
                    <span className="w-6 h-6 rounded-md bg-slate-800 text-amber-400 flex items-center justify-center font-bold text-xs">
                      {idx + 1}
                    </span>
                    <span className="text-slate-300">
                      {sub.startTimeStr} &larr; {sub.endTimeStr}
                    </span>
                    <span className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {sceneDuration.toFixed(1)}s
                    </span>

                    <span className="px-2 py-0.5 rounded-md bg-slate-800/80 border border-slate-700 text-slate-300 text-[11px] font-sans">
                      صداپیشه: {voiceMeta.nameFa}
                    </span>

                    {/* 15% Word Count Indicator */}
                    {(() => {
                      const enWords = sub.originalText.trim().split(/\s+/).filter(Boolean).length;
                      const faWords = sub.farsiText.trim().split(/\s+/).filter(Boolean).length;
                      const diff = enWords > 0 ? Math.round((Math.abs(faWords - enWords) / enWords) * 100) : 0;
                      const isGood = diff <= 15;
                      return (
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-md font-sans font-mono ${
                            isGood
                              ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30'
                              : 'bg-amber-950/50 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          کلمات: {enWords} انگلیسی | {faWords} فارسی ({diff}٪ اختلاف)
                        </span>
                      );
                    })()}

                    {hasAudio && sub.audioDuration && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md font-sans flex items-center gap-1 bg-emerald-950/50 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>سرعت ۱.۰x طبیعی و ثابت (طول صوت: {sub.audioDuration.toFixed(1)}s)</span>
                      </span>
                    )}

                    {isThisLineCountingDown && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 font-sans animate-pulse">
                        تلاش خودکار در {countdownInfo.secondsLeft} ثانیه...
                      </span>
                    )}
                  </div>

                  <div className="text-sm font-medium text-slate-100 leading-relaxed">
                    {sub.farsiText || (
                      <span className="text-slate-600 italic">هنوز ترجمه نشده است</span>
                    )}
                  </div>

                  {sub.error && !isThisLineCountingDown && (
                    <div className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{sub.error}</span>
                    </div>
                  )}
                </div>

                {/* Right: Audio Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {/* Play Audio Button */}
                  {hasAudio && (
                    <button
                      type="button"
                      onClick={() => handlePlayLineAudio(sub)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                        isPlaying
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      }`}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>توقف پخش</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>شنیدن دیالوگ</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Generate / Regenerate Audio Button */}
                  <button
                    type="button"
                    onClick={() => {
                      cancelRequestedRef.current = false;
                      if (voiceEngine === 'browser') {
                        generateSingleOfflineVoice(sub);
                      } else {
                        generateSingleTTSWithRetry(sub, idx + 1);
                      }
                    }}
                    disabled={isGenerating || isGeneratingAll || !sub.farsiText.trim()}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition disabled:opacity-50 ${
                      hasAudio
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>در حال تولید...</span>
                      </>
                    ) : hasAudio ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>تولید مجدد</span>
                      </>
                    ) : (
                      <>
                        <Mic2 className="w-3.5 h-3.5" />
                        <span>تولید صدا</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Step Progression */}
      {isAllReady && (
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs text-emerald-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>تمام {readyVoicesCount} قطعه صوتی دوبله آماده میکس روی خط زمان هستند.</span>
          </div>

          <button
            type="button"
            onClick={onProceedToMixer}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/20"
          >
            <Sparkles className="w-4 h-4" />
            <span>مرحله بعد: استودیو میکس و پخش همگام &larr;</span>
          </button>
        </div>
      )}
    </div>
  );
};
