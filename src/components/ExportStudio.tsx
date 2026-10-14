import React, { useState } from 'react';
import { SubtitleItem } from '../types/dubbing';
import {
  Download,
  FileAudio,
  FileText,
  Sparkles,
  CheckCircle2,
  Loader2,
  HardDrive,
  Info,
  Radio,
  Layers,
  Mic2,
  Tag,
} from 'lucide-react';
import { exportToSrt, formatPlayerTime } from '../utils/srtParser';
import { renderDubbedTrack } from '../utils/audioMixer';
import { deriveProjectOutputName } from '../utils/fileNaming';

interface ExportStudioProps {
  subtitles: SubtitleItem[];
  originalAudioBuffer: AudioBuffer | null;
  originalAudioName: string;
  subtitleFileName?: string;
  outputBaseName?: string;
  onChangeOutputBaseName?: (name: string) => void;
  mixMode: 'ducking' | 'isolated' | 'full_mix';
  persianVolume: number;
  backgroundVolume: number;
  duckingAmount: number;
  sharedWavBlob?: Blob | null;
  sharedDuration?: number;
  onMixRendered?: (res: { wavBlob: Blob; audioBuffer: AudioBuffer; totalDuration: number }) => void;
}

export const ExportStudio: React.FC<ExportStudioProps> = ({
  subtitles,
  originalAudioBuffer,
  originalAudioName,
  subtitleFileName,
  outputBaseName,
  onChangeOutputBaseName,
  mixMode,
  persianVolume,
  backgroundVolume,
  duckingAmount,
  sharedWavBlob,
  sharedDuration,
  onMixRendered,
}) => {
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [renderedWavBlob, setRenderedWavBlob] = useState<Blob | null>(sharedWavBlob || null);
  const [renderedWavUrl, setRenderedWavUrl] = useState<string | null>(
    sharedWavBlob ? URL.createObjectURL(sharedWavBlob) : null
  );
  const [renderedDuration, setRenderedDuration] = useState<number>(sharedDuration || 0);

  // Sync with shared render from TimelinePlayer
  React.useEffect(() => {
    if (sharedWavBlob) {
      setRenderedWavBlob(sharedWavBlob);
      const url = URL.createObjectURL(sharedWavBlob);
      setRenderedWavUrl(url);
      if (sharedDuration) {
        setRenderedDuration(sharedDuration);
      }
    }
  }, [sharedWavBlob, sharedDuration]);

  const readyVoicesCount = subtitles.filter((s) => s.audioBase64).length;
  const canRender = readyVoicesCount > 0;

  // Master Offline Render
  const handleRenderDubbedTrack = async () => {
    setIsRendering(true);
    setRenderedWavBlob(null);
    setRenderedWavUrl(null);

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
        (percent, message) => {
          setRenderProgress({ percent, message });
        }
      );

      const blobUrl = URL.createObjectURL(result.wavBlob);
      setRenderedWavBlob(result.wavBlob);
      setRenderedWavUrl(blobUrl);
      setRenderedDuration(result.totalDuration);
      onMixRendered?.(result);
    } catch (err: any) {
      alert('خطا در رندر فایل صوتی: ' + (err.message || 'خطای نامشخص'));
    } finally {
      setIsRendering(false);
    }
  };

  const defaultBaseName = deriveProjectOutputName(originalAudioName, subtitleFileName);
  const [customBaseName, setCustomBaseName] = useState<string>(outputBaseName || defaultBaseName);

  React.useEffect(() => {
    if (outputBaseName && outputBaseName !== customBaseName) {
      setCustomBaseName(outputBaseName);
    } else if (!customBaseName && defaultBaseName) {
      setCustomBaseName(defaultBaseName);
    }
  }, [outputBaseName, defaultBaseName]);

  const effectiveBaseName = (customBaseName || defaultBaseName || 'persian_dub').trim();

  const handleBaseNameChange = (val: string) => {
    setCustomBaseName(val);
    onChangeOutputBaseName?.(val);
  };

  // Download Rendered WAV File with exact input video/srt base name
  const handleDownloadWav = () => {
    if (!renderedWavBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(renderedWavBlob);
    a.download = `${effectiveBaseName}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Download Persian SRT with exact input video/srt base name
  const handleDownloadSrt = (withLangCode = false) => {
    const srtContent = exportToSrt(subtitles);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${effectiveBaseName}${withLangCode ? '.fa.srt' : '.srt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30">
              ۵
            </span>
            <span>خروجی نهایی و دانلود فایل صوتی دوبله (WAV)</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            صوت دوبله فارسی را با کیفیت استودیویی استخراج کنید و مستقیماً روی فیلم یا نرم‌افزار تدوین قرار دهید.
          </p>
        </div>

        {/* Master Render Trigger Button */}
        <button
          type="button"
          onClick={handleRenderDubbedTrack}
          disabled={!canRender || isRendering}
          className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/20 disabled:opacity-50"
        >
          {isRendering ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>{isRendering ? 'در حال رندر و میکس...' : 'ساخت و رندر فایل صوتی نهایی (WAV)'}</span>
        </button>
      </div>

      {/* Render Progress Card */}
      {isRendering && (
        <div className="mb-6 p-5 bg-slate-950 rounded-2xl border border-amber-500/40">
          <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
            <span className="font-medium text-amber-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{renderProgress.message}</span>
            </span>
            <span className="font-mono text-amber-400 font-bold">{renderProgress.percent}%</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-200"
              style={{ width: `${renderProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Output File Naming Synchronization Bar */}
      <div className="mb-6 p-4 bg-slate-950/80 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
            <Tag className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <span>نام فایل‌های خروجی:</span>
              <span className="text-[11px] font-normal text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                همنام با فایل ورودی
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              فایل‌های خروجی صوتی (WAV) و زیرنویس (SRT) دقیقاً با همین نام ذخیره می‌شوند تا در نرم‌افزارهای تدوین و پخش‌کننده‌ها به‌صورت خودکار در کنار ویدیو لود شوند.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch md:self-auto">
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 focus-within:border-amber-500 transition w-full md:w-auto">
            <input
              type="text"
              value={customBaseName}
              onChange={(e) => handleBaseNameChange(e.target.value)}
              placeholder="نام فایل ورودی"
              className="bg-transparent text-xs text-amber-300 font-mono focus:outline-none w-full md:w-56 ltr text-left"
            />
            <span className="text-[11px] text-slate-500 font-mono mr-1.5 shrink-0">.wav/.srt</span>
          </div>
          {customBaseName !== defaultBaseName && defaultBaseName && (
            <button
              type="button"
              onClick={() => handleBaseNameChange(defaultBaseName)}
              className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] border border-slate-700 transition shrink-0"
              title="بازنشانی به نام اولیه ورودی"
            >
              بازنشانی
            </button>
          )}
        </div>
      </div>

      {/* Ready Downloads Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* 1. Download Dubbed WAV Card */}
        <div
          className={`p-6 rounded-2xl border transition-all ${
            renderedWavBlob
              ? 'bg-gradient-to-b from-slate-950 to-slate-900 border-emerald-500/50 shadow-lg shadow-emerald-500/5'
              : 'bg-slate-950/60 border-slate-800'
          }`}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <FileAudio className="w-6 h-6" />
            </div>
            {renderedWavBlob ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                آماده دانلود
              </span>
            ) : (
              <span className="text-xs text-slate-500 bg-slate-800/80 px-2.5 py-1 rounded-full">
                نیازمند رندر
              </span>
            )}
          </div>

          <h3 className="text-base font-bold text-white mb-1">
            فایل صوتی کامل دوبله فارسی (WAV PCM 16-bit)
          </h3>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            {renderedWavBlob
              ? `صوت کامل به مدت ${formatPlayerTime(renderedDuration)} با کیفیت استودیویی استخراج شده است. آماده پخش و تدوین.`
              : 'پس از کلیک روی «ساخت و رندر فایل صوتی»، فایل WAV با زمان‌بندی دقیق و هماهنگ با ویدیو ساخته می‌شود.'}
          </p>

          {renderedWavUrl && (
            <div className="mb-4 p-3 bg-slate-900 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1.5">
                <span>پیش‌شنوایی صوت رندر شده:</span>
              </div>
              <audio controls src={renderedWavUrl} className="w-full h-8" />
            </div>
          )}

          <button
            type="button"
            onClick={handleDownloadWav}
            disabled={!renderedWavBlob}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20 disabled:opacity-50 font-mono"
            title={`دانلود صوت دوبله فارسی با نام ${effectiveBaseName}.wav`}
          >
            <Download className="w-4 h-4" />
            <span>دانلود فایل صوتی دوبله ({effectiveBaseName}.wav)</span>
          </button>
        </div>

        {/* 2. Download Translated Persian SRT Card */}
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-950/60 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <FileText className="w-6 h-6" />
              </div>
              <span className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded-full font-medium">
                {subtitles.length} خط زیرنویس
              </span>
            </div>

            <h3 className="text-base font-bold text-white mb-1">
              فایل زیرنویس فارسی ترجمه شده (SRT)
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              زیرنویس همگام با زمان‌بندی دقیق صحنه‌های فیلم شامل تمام دیالوگ‌های فارسی ترجمه شده برای استفاده در پخش‌کننده‌ها.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <button
              type="button"
              onClick={() => handleDownloadSrt(false)}
              disabled={subtitles.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs border border-slate-700 transition disabled:opacity-50 font-mono"
              title={`دانلود زیرنویس دقیقاً همنام: ${effectiveBaseName}.srt`}
            >
              <Download className="w-4 h-4" />
              <span>دانلود زیرنویس ({effectiveBaseName}.srt)</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadSrt(true)}
              disabled={subtitles.length === 0}
              className="flex items-center justify-center gap-1 py-3 px-3 rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-amber-300 font-mono text-[11px] border border-slate-700 transition disabled:opacity-50 shrink-0"
              title={`دانلود با پسوند استاندارد زبان: ${effectiveBaseName}.fa.srt`}
            >
              <span>.fa.srt</span>
            </button>
          </div>
        </div>
      </div>

      {/* Studio Specs Banner */}
      <div className="p-4 bg-slate-950/40 rounded-2xl border border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-400" />
          <span>فرمت خروجی صوت: استاندارد استودیویی 16-bit PCM WAV (سازگار با Adobe Premiere, Final Cut, DaVinci Resolve)</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span>حالت میکس فعلی: {mixMode === 'ducking' ? 'داکینگ هوشمند' : mixMode === 'isolated' ? 'خالص دوبله' : 'میکس کامل'}</span>
          <span>&bull;</span>
          <span>تعداد خطوط دیالوگ: {subtitles.length}</span>
        </div>
      </div>
    </div>
  );
};
