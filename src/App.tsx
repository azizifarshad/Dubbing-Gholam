import React, { useState, useEffect } from 'react';
import { SubtitleItem } from './types/dubbing';
import { Header } from './components/Header';
import { ApiKeyModal } from './components/ApiKeyModal';
import { FileUploaderSection } from './components/FileUploaderSection';
import { TranslationStudio } from './components/TranslationStudio';
import { VoiceSynthesisStudio } from './components/VoiceSynthesisStudio';
import { TimelinePlayer } from './components/TimelinePlayer';
import { ExportStudio } from './components/ExportStudio';
import { parseSrt, SAMPLE_SRT_CONTENT } from './utils/srtParser';
import { generateDemoBackgroundAudio } from './utils/audioMixer';
import {
  FileText,
  Languages,
  Mic2,
  Sliders,
  Download,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  Film,
  Music,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export default function App() {
  // 1. API Key State
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('persian_dub_gemini_key') || '';
  });
  const [hasEnvKey, setHasEnvKey] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);

  // 2. Project Subtitle State
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [subtitleFileName, setSubtitleFileName] = useState<string>('');

  // 3. Original Video Audio State
  const [originalAudioBuffer, setOriginalAudioBuffer] = useState<AudioBuffer | null>(null);
  const [originalAudioName, setOriginalAudioName] = useState<string>('');
  const [originalAudioDuration, setOriginalAudioDuration] = useState<number>(0);
  const [originalAudioBlobUrl, setOriginalAudioBlobUrl] = useState<string | null>(null);

  // 4. Mixing & Audio Output State
  const [mixMode, setMixMode] = useState<'ducking' | 'isolated' | 'full_mix'>('ducking');
  const [persianVolume, setPersianVolume] = useState<number>(1.0);
  const [backgroundVolume, setBackgroundVolume] = useState<number>(0.2);
  const [duckingAmount, setDuckingAmount] = useState<number>(0.8);

  // 5. Active Step / Tab
  const [activeStep, setActiveStep] = useState<number>(1);
  const [viewMode, setViewMode] = useState<'stepper' | 'all'>('stepper');

  // Check server environment key on mount
  useEffect(() => {
    fetch('/api/check-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.hasEnvKey) {
          setHasEnvKey(true);
        }
      })
      .catch((_) => {});
  }, [apiKey]);

  const handleSaveApiKey = (newKey: string) => {
    setApiKey(newKey);
    if (newKey) {
      localStorage.setItem('persian_dub_gemini_key', newKey);
    } else {
      localStorage.removeItem('persian_dub_gemini_key');
    }
  };

  const handleSubtitlesLoaded = (items: SubtitleItem[], fileName: string) => {
    setSubtitles(items);
    setSubtitleFileName(fileName);
    setActiveStep(2); // Jump to translation
  };

  const handleAudioLoaded = (buffer: AudioBuffer, fileName: string, fileBlobUrl: string) => {
    setOriginalAudioBuffer(buffer);
    setOriginalAudioName(fileName);
    setOriginalAudioDuration(buffer.duration);
    setOriginalAudioBlobUrl(fileBlobUrl);
  };

  const handleUpdateSubtitle = (id: number, partial: Partial<SubtitleItem>) => {
    setSubtitles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...partial } : item))
    );
  };

  const handleUpdateAllSubtitles = (items: SubtitleItem[]) => {
    setSubtitles(items);
  };

  // Instant 1-Click Demo Loader
  const handleLoadDemoSample = async () => {
    const parsed = parseSrt(SAMPLE_SRT_CONTENT);
    setSubtitles(parsed);
    setSubtitleFileName('sample-action-movie-scene.srt');

    try {
      const demoAudio = await generateDemoBackgroundAudio(25);
      setOriginalAudioBuffer(demoAudio);
      setOriginalAudioName('موسیقی و صدای متن فیلم (نمونه اکشن)');
      setOriginalAudioDuration(demoAudio.duration);
    } catch (err) {
      console.error(err);
    }

    setActiveStep(2);
  };

  // Progress stats
  const translatedCount = subtitles.filter((s) => s.farsiText.trim().length > 0).length;
  const readyVoicesCount = subtitles.filter((s) => s.audioBase64).length;

  const steps = [
    {
      num: 1,
      titleFa: 'ورودی‌ها و فایل‌ها',
      descFa: 'کلید API، فایل زیرنویس و صوت فیلم',
      icon: Film,
      isCompleted: (apiKey || hasEnvKey) && subtitles.length > 0,
    },
    {
      num: 2,
      titleFa: 'ترجمه و تنظیم متن',
      descFa: 'ترجمه تخصصی دیالوگ‌ها به فارسی',
      icon: Languages,
      isCompleted: subtitles.length > 0 && translatedCount === subtitles.length,
    },
    {
      num: 3,
      titleFa: 'صداپیشگی هوش مصنوعی',
      descFa: 'تولید صدای دوبلورها با Gemini TTS',
      icon: Mic2,
      isCompleted: subtitles.length > 0 && readyVoicesCount === subtitles.length,
    },
    {
      num: 4,
      titleFa: 'میکس و تایم‌لاین',
      descFa: 'همگام‌سازی زمانی و داکینگ هوشمند',
      icon: Sliders,
      isCompleted: readyVoicesCount > 0,
    },
    {
      num: 5,
      titleFa: 'خروجی و دانلود',
      descFa: 'دریافت فایل صوتی نهایی WAV و SRT',
      icon: Download,
      isCompleted: readyVoicesCount > 0,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Vazirmatn',sans-serif]">
      {/* Top Header */}
      <Header
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        hasApiKey={Boolean(apiKey || hasEnvKey)}
        activeLinesCount={subtitles.length}
        readyVoicesCount={readyVoicesCount}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero Introduction & Quick Tour */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-amber-500/10 via-slate-900 to-slate-900 border border-slate-800 p-6 sm:p-8">
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>سیستم خودکار دوبلاژ و صداپیشگی سینمایی فارسی</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight tracking-tight mb-2">
              فیلم‌های خارجی را در چند دقیقه به صورت حرفه‌ای به زبان فارسی دوبله کنید
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              فقط کافیست زیرنویس انگلیسی <span className="text-amber-400 font-mono">.srt</span> و صوت فیلم <span className="text-amber-400 font-mono">.mp3/.wav</span> را وارد کنید؛ هوش مصنوعی دیالوگ‌ها را متناسب با لب‌خوانی ترجمه کرده، با صدای گویندگان فارسی ضبط نموده و با داکینگ هوشمند یک فایل صوتی دوبله کامل تحویل می‌دهد.
            </p>
          </div>

          <div className="absolute -left-12 -bottom-12 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        </div>

        {/* Stepper Navigation Bar */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-2 sm:p-3 shadow-lg">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {steps.map((step) => {
              const Icon = step.icon;
              const isActive = activeStep === step.num;
              return (
                <button
                  key={step.num}
                  type="button"
                  onClick={() => setActiveStep(step.num)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-right transition-all ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500/80 text-amber-300 shadow-md shadow-amber-500/10'
                      : step.isCompleted
                      ? 'bg-slate-950/60 border-emerald-500/30 text-slate-300 hover:border-slate-700'
                      : 'bg-slate-950/40 border-slate-800/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold transition ${
                      isActive
                        ? 'bg-amber-500 text-slate-950'
                        : step.isCompleted
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {step.isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>

                  <div className="overflow-hidden">
                    <div className="text-xs font-bold truncate flex items-center gap-1">
                      <span>{step.num}.</span>
                      <span>{step.titleFa}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate hidden sm:block">
                      {step.descFa}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Studio Stage Views */}
        <div className="space-y-8">
          {/* Step 1: Uploaders */}
          <div className={activeStep === 1 || viewMode === 'all' ? 'block' : 'hidden'}>
            <FileUploaderSection
              apiKey={apiKey}
              hasEnvKey={hasEnvKey}
              onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
              subtitles={subtitles}
              onSubtitlesLoaded={handleSubtitlesLoaded}
              originalAudioBuffer={originalAudioBuffer}
              originalAudioName={originalAudioName}
              originalAudioDuration={originalAudioDuration}
              onAudioLoaded={handleAudioLoaded}
              onLoadDemoSample={handleLoadDemoSample}
              isProcessingAudio={false}
            />
          </div>

          {/* Step 2: Translation Studio */}
          <div className={activeStep === 2 || viewMode === 'all' ? 'block' : 'hidden'}>
            <TranslationStudio
              apiKey={apiKey}
              subtitles={subtitles}
              onUpdateSubtitle={handleUpdateSubtitle}
              onUpdateAllSubtitles={handleUpdateAllSubtitles}
              onProceedToTTS={() => setActiveStep(3)}
              onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            />
          </div>

          {/* Step 3: Voice Synthesis Studio */}
          <div className={activeStep === 3 || viewMode === 'all' ? 'block' : 'hidden'}>
            <VoiceSynthesisStudio
              apiKey={apiKey}
              subtitles={subtitles}
              onUpdateSubtitle={handleUpdateSubtitle}
              onUpdateAllSubtitles={handleUpdateAllSubtitles}
              onProceedToMixer={() => setActiveStep(4)}
              onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            />
          </div>

          {/* Step 4: Timeline & Mixer */}
          <div className={activeStep === 4 || viewMode === 'all' ? 'block' : 'hidden'}>
            <TimelinePlayer
              subtitles={subtitles}
              originalAudioBuffer={originalAudioBuffer}
              originalAudioName={originalAudioName}
              mixMode={mixMode}
              onChangeMixMode={setMixMode}
              persianVolume={persianVolume}
              onChangePersianVolume={setPersianVolume}
              backgroundVolume={backgroundVolume}
              onChangeBackgroundVolume={setBackgroundVolume}
              duckingAmount={duckingAmount}
              onChangeDuckingAmount={setDuckingAmount}
            />
          </div>

          {/* Step 5: Export & Download */}
          <div className={activeStep === 5 || viewMode === 'all' ? 'block' : 'hidden'}>
            <ExportStudio
              subtitles={subtitles}
              originalAudioBuffer={originalAudioBuffer}
              originalAudioName={originalAudioName}
              mixMode={mixMode}
              persianVolume={persianVolume}
              backgroundVolume={backgroundVolume}
              duckingAmount={duckingAmount}
            />
          </div>
        </div>

        {/* Bottom Step Navigation Bar */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => setActiveStep((prev) => Math.max(1, prev - 1))}
            disabled={activeStep === 1}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
            <span>مرحله قبل</span>
          </button>

          <div className="text-xs text-slate-500">
            مرحله {activeStep} از ۵
          </div>

          <button
            type="button"
            onClick={() => setActiveStep((prev) => Math.min(5, prev + 1))}
            disabled={activeStep === 5}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition disabled:opacity-30 disabled:pointer-events-none"
          >
            <span>مرحله بعد</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 bg-slate-950 py-6 text-center text-xs text-slate-500 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>استودیو دوبله هوشمند فارسی</span>
            <span>&bull;</span>
            <span className="text-slate-400">قدرت‌گرفته از Gemini 3.8 Flash و Gemini 3.8 TTS</span>
          </div>
          <div className="text-slate-600 text-[11px]">
            تولید صدای استودیویی 16-bit PCM WAV با همگام‌سازی میلی‌ثانیه‌ای
          </div>
        </div>
      </footer>

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        apiKey={apiKey}
        onSaveApiKey={handleSaveApiKey}
        hasEnvKey={hasEnvKey}
      />
    </div>
  );
}
