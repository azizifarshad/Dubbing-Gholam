import React, { useState } from 'react';
import { SubtitleItem, TRANSLATION_STYLES, TranslationStyle, AVAILABLE_VOICES, GeminiVoiceId } from '../types/dubbing';
import { Languages, Wand2, RefreshCw, CheckCircle2, Clock, Sparkles, User, AlertCircle, Loader2, Cpu, Globe, Server, FileText, Copy, Check } from 'lucide-react';
import { translateOfflineLocally } from '../utils/localTranslator';

interface TranslationStudioProps {
  apiKey: string;
  subtitles: SubtitleItem[];
  onUpdateSubtitle: (id: number, partial: Partial<SubtitleItem>) => void;
  onUpdateAllSubtitles: (items: SubtitleItem[]) => void;
  onProceedToTTS: () => void;
  onOpenApiKeyModal?: () => void;
}

export const TranslationStudio: React.FC<TranslationStudioProps> = ({
  apiKey,
  subtitles,
  onUpdateSubtitle,
  onUpdateAllSubtitles,
  onProceedToTTS,
  onOpenApiKeyModal,
}) => {
  const [selectedStyle, setSelectedStyle] = useState<TranslationStyle>('colloquial');
  const [translationEngine, setTranslationEngine] = useState<'gemini' | 'local'>('gemini');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLineId, setTranslatingLineId] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [globalVoice, setGlobalVoice] = useState<GeminiVoiceId>('Iapetus');
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const translatedCount = subtitles.filter((s) => s.farsiText.trim().length > 0).length;
  const isAllTranslated = subtitles.length > 0 && translatedCount === subtitles.length;
  // Batch Translate All Subtitles (Gemini or Local Engine)
  const handleTranslateAll = async () => {
    if (subtitles.length === 0) return;
    setIsTranslating(true);
    setTranslationError(null);

    // 1. Local Offline Engine Branch
    if (translationEngine === 'local') {
      try {
        const payloadLines = subtitles.map((s) => ({
          id: s.id,
          text: s.originalText,
        }));

        let fallbackData: any = null;
        try {
          const res = await fetch('/api/translate-fallback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines: payloadLines, style: selectedStyle }),
          });
          if (res.ok) {
            fallbackData = await res.json();
          }
        } catch (_) {}

        if (fallbackData?.translations && Array.isArray(fallbackData.translations)) {
          const translationMap = new Map<number, string>();
          for (const t of fallbackData.translations) {
            translationMap.set(t.id, t.farsiText);
          }
          const updated = subtitles.map((sub) => {
            const fa = translationMap.get(sub.id) || translateOfflineLocally(sub.originalText, selectedStyle);
            return {
              ...sub,
              farsiText: fa || sub.farsiText,
              status: 'translated' as const,
            };
          });
          onUpdateAllSubtitles(updated);
        } else {
          // In-browser rule-based fallback
          const updated = subtitles.map((sub) => {
            const translatedFa = translateOfflineLocally(sub.originalText, selectedStyle);
            return {
              ...sub,
              farsiText: translatedFa || sub.farsiText,
              status: 'translated' as const,
            };
          });
          onUpdateAllSubtitles(updated);
        }
      } catch (err: any) {
        setTranslationError(err?.message || 'خطا در ترجمه با موتور محلی.');
      } finally {
        setIsTranslating(false);
      }
      return;
    }

    // 2. Google Gemini AI Cloud Engine Branch
    try {
      const payloadLines = subtitles.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.originalText,
        duration: Number((s.end - s.start).toFixed(2)),
      }));

      let data: any;
      try {
        const res = await fetch('/api/translate-subtitles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
          },
          body: JSON.stringify({
            lines: payloadLines,
            style: selectedStyle,
            apiKey,
          }),
        });

        if (res.ok) {
          data = await res.json();
        } else {
          try {
            data = await res.json();
          } catch (_) {}
        }
      } catch (networkErr: any) {
        console.warn('Network issue during translate fetch, fallback to instant dubbing generator:', networkErr);
      }

      if (data?.translations && Array.isArray(data.translations) && data.translations.length > 0) {
        const translationMap = new Map<number, { farsiText: string; characterEmotion?: string; suggestedGender?: string }>();
        for (const t of data.translations) {
          translationMap.set(t.id, t);
        }

        const updated = subtitles.map((sub) => {
          const trans = translationMap.get(sub.id);
          if (trans) {
            let suggestedVoice = sub.voice;
            if (trans.suggestedGender?.toLowerCase() === 'female') {
              suggestedVoice = 'Kore';
            }

            return {
              ...sub,
              farsiText: trans.farsiText || sub.farsiText,
              emotion: trans.characterEmotion || sub.emotion,
              voice: suggestedVoice,
              status: 'translated' as const,
            };
          }
          return sub;
        });

        onUpdateAllSubtitles(updated);
        if (data.notice) {
          setTranslationError(data.notice);
        }
      } else {
        setTranslationError(data?.error || data?.message || 'خطا در دریافت ترجمه از هوش مصنوعی.');
      }
    } catch (err: any) {
      console.warn('Translation error caught:', err);
      setTranslationError(err.message || 'خطا در برقراری ارتباط با سرویس ترجمه هوش مصنوعی.');
    } finally {
      setIsTranslating(false);
    }
  };

  // Translate Single Line
  const handleTranslateSingleLine = async (sub: SubtitleItem) => {
    setTranslatingLineId(sub.id);
    setTranslationError(null);

    // Local Engine Single Line
    if (translationEngine === 'local') {
      try {
        let fa = '';
        try {
          const res = await fetch('/api/translate-fallback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lines: [{ id: sub.id, text: sub.originalText }],
              style: selectedStyle,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.translations?.[0]?.farsiText) {
              fa = data.translations[0].farsiText;
            }
          }
        } catch (_) {}

        if (!fa) {
          fa = translateOfflineLocally(sub.originalText, selectedStyle);
        }

        onUpdateSubtitle(sub.id, {
          farsiText: fa || sub.farsiText,
          status: 'translated',
        });
      } catch (err: any) {
        setTranslationError(err?.message || 'خطا در ترجمه محلی این خط.');
      } finally {
        setTranslatingLineId(null);
      }
      return;
    }

    // Gemini Cloud Single Line
    try {
      let data: any;
      try {
        const res = await fetch('/api/translate-subtitles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
          },
          body: JSON.stringify({
            lines: [
              {
                id: sub.id,
                start: sub.start,
                end: sub.end,
                text: sub.originalText,
                duration: Number((sub.end - sub.start).toFixed(2)),
              },
            ],
            style: selectedStyle,
            apiKey,
          }),
        });

        if (res.ok) {
          data = await res.json();
        } else {
          try {
            data = await res.json();
          } catch (_) {}
        }
      } catch (fetchErr) {
        console.warn('Single line fetch network error:', fetchErr);
      }

      if (data?.translations?.[0]) {
        const t = data.translations[0];
        onUpdateSubtitle(sub.id, {
          farsiText: t.farsiText,
          emotion: t.characterEmotion || sub.emotion,
          status: 'translated',
        });
      } else {
        const err = data?.error || 'خطا در ترجمه این خط با هوش مصنوعی.';
        setTranslationError(err);
      }
    } catch (err: any) {
      console.warn('Single line translation error:', err);
      setTranslationError(err?.message || 'خطا در ترجمه خط.');
    } finally {
      setTranslatingLineId(null);
    }
  };

  // Apply Global Voice
  const handleApplyGlobalVoice = (voiceId: typeof globalVoice) => {
    setGlobalVoice(voiceId);
    const updated = subtitles.map((s) => ({
      ...s,
      voice: voiceId,
    }));
    onUpdateAllSubtitles(updated);
  };

  if (subtitles.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Step Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 pb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30">
              ۲
            </span>
            <span>ترجمه تخصصی و تنظیم متن دوبله فارسی</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            ترجمه پرسرعت با هوش مصنوعی (Gemini 3.8 Flash) با بیان رسا، معنای شفاف و کامل و حفظ اصطلاحات تخصصی کامپیوتر.
          </p>
        </div>

        {/* Translation Status Pill & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="bg-slate-950 border border-slate-700/80 px-3.5 py-1.5 rounded-xl flex items-center gap-2">
            <span className="text-slate-400">وضعیت ترجمه:</span>
            <span className="font-bold text-amber-400">
              {translatedCount} از {subtitles.length} خط
            </span>
          </div>


          <button
            type="button"
            onClick={handleTranslateAll}
            disabled={isTranslating}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            {isTranslating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            <span>
              {isTranslating
                ? translationEngine === 'local'
                  ? 'در حال ترجمه با مدل داخلی...'
                  : 'در حال ترجمه سریع با Gemini 3.8 Flash...'
                : translationEngine === 'local'
                ? 'ترجمه با مدل داخلی (آفلاین)'
                : 'ترجمه پرسرعت با جمینای'}
            </span>
          </button>
        </div>
      </div>

      {/* Engine Selector Bar (Gemini Cloud vs Local Offline Engine) */}
      <div className="mb-6 p-4 bg-slate-950/70 rounded-2xl border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span>انتخاب موتور ترجمه:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTranslationEngine('gemini')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                translationEngine === 'gemini'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>هوش مصنوعی ابری (Google Gemini)</span>
            </button>

            <button
              type="button"
              onClick={() => setTranslationEngine('local')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                translationEngine === 'local'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>مدل داخلی و آفلاین (بدون اینترنت)</span>
            </button>
          </div>
        </div>

        {/* Engine Description Pill */}
        <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between flex-wrap gap-2">
          {translationEngine === 'gemini' ? (
            <span>
              ⚡ <strong className="text-amber-300">موتور جمینای:</strong> ترجمه غنی با هوش مصنوعی، لحن محاوره‌ای صمیمی دوبلاژ و حفظ اصطلاحات فنی کامپیوتر.
            </span>
          ) : (
            <span>
              🔒 <strong className="text-emerald-300">موتور داخلی:</strong> اجرای کاملاً لوکال و بدون نیاز به اینترنت با واژه‌نامه تخصصی برنامه‌نویسی و اصطلاحات کامپیوتری.
            </span>
          )}
          <span className="text-slate-500 text-[10px]">
            مدل پیشنهادی HuggingFace (Hy-MT2 1.8B): ۴.۰۸ گیگابایت (نیازمند دانلود در اولین بار)
          </span>
        </div>
      </div>

      {/* Style & Global Voice Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
        {/* Style Selector */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-2 flex items-center gap-1.5">
            <Languages className="w-4 h-4 text-amber-400" />
            <span>لحن و سبک ترجمه دوبله:</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TRANSLATION_STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setSelectedStyle(st.id)}
                className={`text-right p-2.5 rounded-xl border text-xs transition ${
                  selectedStyle === st.id
                    ? 'bg-amber-500/15 border-amber-500 text-amber-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-slate-200">{st.titleFa}</div>
                <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{st.descFa}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Global Default Voice */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-2 flex items-center gap-1.5">
            <User className="w-4 h-4 text-emerald-400" />
            <span>گوینده پیش‌فرض (صدای دوبلور):</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {AVAILABLE_VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => handleApplyGlobalVoice(v.id)}
                className={`text-right p-2 rounded-xl border text-xs transition ${
                  globalVoice === v.id
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>{v.nameFa}</span>
                  <span className="text-[10px] opacity-75">{v.genderFa}</span>
                </div>
                <div className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                  {v.descriptionFa}
                </div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            می‌توانید برای هر خط به تفکیک جنسیت کاراکتر، صداپیشه جداگانه انتخاب کنید.
          </p>
        </div>
      </div>

      {/* Master Translation Rules & Prompt Inspector */}
      <div className="mb-6 p-4 rounded-2xl bg-slate-950/80 border border-amber-500/30 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md">
        <div className="flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-slate-200 flex flex-wrap items-center gap-2">
              <span>قوانین طلایی ترجمه و پرامپت استودیو:</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-mono border border-emerald-500/30">
                مدرس ایرانی محاوره‌ای • عدم حذف مفاهیم • حفظ اصطلاحات فنی
              </span>
            </div>
            <div className="text-slate-400 text-[11px] mt-1 leading-relaxed">
              • <strong className="text-slate-300">لحن محاوره‌ای مدرس ایرانی:</strong> استفاده از عبارات روان و صمیمی («توی این درس می‌خوایم...»، «سلام مو هستم خوش اومدید») به جای ترجمه کتابی و خشک.<br />
              • <strong className="text-slate-300">حفظ کامل مفاهیم:</strong> هیچ بخش از جمله (مثل بخش دوم جملات) حذف نمی‌شود.<br />
              • <strong className="text-slate-300">سقف کلمات دوبله:</strong> تعداد کلمات فارسی حداکثر تا ۱۲۰٪ کلمات انگلیسی است تا صداها روی هم نیفتند.<br />
              • <strong className="text-slate-300">حفظ اصطلاحات تخصصی به انگلیسی:</strong> ابزارها و کلمات مانند VMware Player, Class, Function, Magic Method, API عیناً انگلیسی می‌مانند.
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowPromptModal(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition text-[11px] font-medium"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>مشاهده پرامپت ارسالی به هوش مصنوعی</span>
          </button>
        </div>
      </div>


      {translationError && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs shadow-lg">
          <div className="flex items-center gap-2 font-bold text-amber-300 mb-1.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{translationError}</span>
          </div>
          <p className="text-slate-300 leading-relaxed mb-3">
            اگر خطای ۵۰۳ ناشی از ترافیک موقت سرورهای گوگل است، با کلیک مجدد روی دکمه زیر ترجمه بلافاصله با مدل‌های جایگزین Flash و Flash-Lite انجام می‌شود:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTranslateAll}
              disabled={isTranslating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition text-xs shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTranslating ? 'animate-spin' : ''}`} />
              <span>تلاش مجدد ترجمه دیالوگ‌ها با جمینای</span>
            </button>
            {onOpenApiKeyModal && (
              <button
                type="button"
                onClick={onOpenApiKeyModal}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition text-xs border border-slate-700"
              >
                بررسی یا تغییر کلید API
              </button>
            )}
          </div>
        </div>
      )}

      {/* Lines Table / Cards */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1 select-text">
        {subtitles.map((sub, idx) => {
          const duration = (sub.end - sub.start).toFixed(1);
          const isCurrentTranslating = translatingLineId === sub.id;
          const enWords = sub.originalText.trim().split(/\s+/).filter(Boolean).length;
          const faWords = sub.farsiText.trim().split(/\s+/).filter(Boolean).length;
          const maxAllowedWords = Math.max(2, Math.min(enWords, Math.round(parseFloat(duration) * 2.0)));
          const isExceedingBudget = faWords > maxAllowedWords && faWords > 0;
          const wordRatio = enWords > 0 ? Math.round((faWords / enWords) * 100) : 100;

          return (
            <div
              key={sub.id}
              className={`p-4 rounded-2xl border transition-all ${
                sub.farsiText.trim()
                  ? 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  : 'bg-slate-950/40 border-amber-500/20'
              }`}
            >
              <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-slate-800/60 text-xs">
                <div className="flex items-center gap-2 text-slate-400 font-mono">
                  <span className="w-6 h-6 rounded-md bg-slate-800 text-amber-400 flex items-center justify-center font-bold text-xs">
                    {idx + 1}
                  </span>
                  <span className="text-slate-300">
                    {sub.startTimeStr} &larr; {sub.endTimeStr}
                  </span>
                  <span className="text-slate-500 text-[11px] flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {duration}s
                  </span>
                </div>

                {/* Voice Selector for this line */}
                <div className="flex items-center gap-2">
                  <select
                    value={sub.voice}
                    onChange={(e) =>
                      onUpdateSubtitle(sub.id, {
                        voice: e.target.value as any,
                      })
                    }
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg py-1 px-2.5 focus:outline-none focus:border-amber-500"
                  >
                    {AVAILABLE_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        صدا: {v.nameFa} ({v.genderFa})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleTranslateSingleLine(sub)}
                    disabled={isCurrentTranslating || isTranslating}
                    title="ترجمه مجدد این خط"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition disabled:opacity-50"
                  >
                    {isCurrentTranslating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Source (English) and Target (Farsi Dubbing Dialogue) with Dubbing Word Budget */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* English Source */}
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                    <span>زیرنویس انگلیسی اصلی:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {enWords} کلمه
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {duration} ثانیه
                      </span>
                    </div>
                  </div>
                  <div dir="ltr" className="text-xs text-slate-300 font-sans leading-relaxed">
                    {sub.originalText}
                  </div>
                </div>

                {/* Farsi Dubbing Dialogue (Editable) */}
                <div className={`rounded-xl p-3 border transition-all ${
                  isExceedingBudget
                    ? 'bg-rose-950/20 border-rose-500/40'
                    : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                  <div className="text-[11px] font-semibold text-amber-400 mb-1 flex items-center justify-between flex-wrap gap-1">
                    <span>دیالوگ دوبله فارسی:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {faWords > 0 && (
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            isExceedingBudget
                              ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                              : 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
                          }`}
                          title={
                            isExceedingBudget
                              ? `تعداد کلمات (${faWords}) از سقف ۱۲۰٪ (${maxAllowedWords} کلمه) بیشتر است. ممکن است صدا روی جمله بعدی بیفتد.`
                              : `تعداد کلمات منطبق با زمان صحنه است (نسبت: ${wordRatio}٪)`
                          }
                        >
                          {isExceedingBudget ? (
                            <span>⚠️ {faWords} کلمه ({wordRatio}٪ - سقف: {maxAllowedWords})</span>
                          ) : (
                            <span>✅ {faWords} کلمه ({wordRatio}٪ - منطبق)</span>
                          )}
                        </span>
                      )}
                      {sub.emotion && (
                        <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
                          {sub.emotion}
                        </span>
                      )}
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-emerald-300 bg-emerald-950/60 border-emerald-500/30">
                        {sub.farsiText.trim() ? 'ترجمه شده' : 'در انتظار ترجمه'}
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={sub.farsiText}
                    onChange={(e) =>
                      onUpdateSubtitle(sub.id, {
                        farsiText: e.target.value,
                        status: 'translated',
                      })
                    }
                    placeholder="ترجمه فارسی روان، واضح و کامل این خط دیالوگ..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 resize-none font-sans leading-relaxed"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Step Progression */}
      {isAllTranslated && (
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs text-emerald-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>تمام {subtitles.length} خط دیالوگ ترجمه شده و آماده تولید صدا هستند.</span>
          </div>

          <button
            type="button"
            onClick={onProceedToTTS}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
          >
            <Sparkles className="w-4 h-4" />
            <span>مرحله بعد: تولید صوت گویندگان دوبله &larr;</span>
          </button>
        </div>
      )}

      {/* Prompt Inspector Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-slate-200 text-sm">پرامپت اختصاصی سیستم برای ترجمه و دوبلاژ</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const fullPromptText = `You are a professional English-to-Persian translator specializing in programming, computer science, software development, AI, and educational content.

Your task is to translate English text into natural, concise, conversational Persian that sounds like a native Persian-speaking instructor explaining a topic, not someone reading from a textbook.

### 1. Natural, Conversational Persian (Instructor Style - مدرس ایرانی)
- Use simple, modern, fluent, conversational Persian.
- Make the translation sound natural when spoken aloud in educational videos and voiceovers (e.g. use spoken conversational forms: "توی این درس می‌خوایم...", "سلام مو هستم خوش اومدید", "قراره بررسی کنیم", "می‌ریم سراغ...").
- Avoid overly formal, literary, bookish, or unnatural phrasing (do NOT write stiff literal text like "دوباره مو هستم" or "ما قصد داریم").
- Preserve the original meaning while restructuring sentences when necessary to make them sound natural in Persian.
- Prefer everyday spoken expressions over formal equivalents whenever appropriate.

### 2. Strict Word Count, Conciseness & Completeness (DO NOT DROP CLAUSES)
- Use the fewest words possible while preserving the complete meaning.
- CRITICAL: Never cut off, omit, or delete parts of the sentence! If an English sentence has multiple clauses or ideas, ALL clauses must be translated and conveyed clearly.
- Avoid unnecessary explanations, filler words, redundant phrases, and repetitions.
- The Persian translation must NOT contain more than 120% of the words of the original English text (e.g., if English is 10 words, Persian should be around 8 to 12 words max).
- Whenever two translations are equally accurate, choose the shorter, punchier one.
- Never remove important technical details, conditions, examples, warnings, or logical relationships just to meet the word limit.
- Prioritize semantic accuracy and completeness while remaining as concise as possible.

### 3. Preserve Technical Terminology in English
- Keep established technical terms from computer science, programming, AI, networking, software engineering, and web development in their original English form.
- Do NOT translate technical terminology into Persian just to make it sound more localized.
- Examples: Magic Method, Class, Object, Function, Framework, API, Debugging, Runtime, Callback, Middleware, Machine Learning, Token, Prompt, VMware Player, Docker.

### 4. Semantic Accuracy & Completeness
- Preserve the original meaning, intent, technical accuracy, and logical relationships.
- Do not omit important details, examples, conditions, warnings, or second clauses.

### 5. Golden Examples (Follow these patterns strictly):
Example 1:
English: "downloading and installing the VMware Player. Now, this is one of our first choice"
CORRECT: "دانلود و نصب VMware Player؛ این یکی از انتخاب‌های اصلی ماست." ✅

Example 2:
English: "Hey, everybody, welcome back. It's Mo again. Well, this lecture what we're going to be doing is"
CORRECT: "سلام مو هستم خوش اومدید، توی این درس می‌خوایم..." ✅`;
                    navigator.clipboard.writeText(fullPromptText);
                    setCopiedPrompt(true);
                    setTimeout(() => setCopiedPrompt(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">کپی شد!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>کپی پرامپت</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPromptModal(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 text-sm"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono leading-relaxed bg-slate-950/80 text-slate-300">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 font-sans text-xs">
                این دقیقاً همان پرامپتی است که به مدل‌های Gemini در سرور ارسال می‌شود تا ترجمه مثل مدرس ایرانی صمیمی، کامل (بدون ناقص ماندن جملات)، با حفظ واژگان انگلیسی و با سقف تعداد کلمات انجام گیرد.
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl whitespace-pre-wrap select-all font-mono text-[11px] text-slate-300">
{`You are a professional English-to-Persian translator specializing in programming, computer science, software development, AI, and educational content.

Your task is to translate English text into natural, concise, conversational Persian that sounds like a native Persian-speaking instructor explaining a topic, not someone reading from a textbook.

### 1. Natural, Conversational Persian (Instructor Style - مدرس ایرانی)
- Use simple, modern, fluent, conversational Persian.
- Make the translation sound natural when spoken aloud in educational videos and voiceovers (e.g. use spoken conversational forms: "توی این درس می‌خوایم...", "سلام مو هستم خوش اومدید", "قراره بررسی کنیم").
- Avoid overly formal, literary, bookish, or unnatural phrasing (do NOT write stiff literal text like "دوباره مو هستم").
- Preserve the original meaning while restructuring sentences when necessary to make them sound natural in Persian.

### 2. Strict Word Count, Conciseness & Completeness (DO NOT DROP CLAUSES)
- Use the fewest words possible while preserving the complete meaning.
- CRITICAL: Never cut off, omit, or delete parts of the sentence! If an English sentence has multiple clauses or ideas, ALL clauses must be translated and conveyed clearly.
- The Persian translation must NOT contain more than 120% of the words of the original English text.
- Never remove important technical details, conditions, examples, warnings, or logical relationships just to meet the word limit.
- Prioritize semantic accuracy and completeness while remaining as concise as possible.

### 3. Preserve Technical Terminology in English
- Keep established technical terms in their original English form (VMware Player, Magic Method, Class, Object, Function, API, Debugging, Runtime, etc.).

### 4. Golden Examples:
Example 1:
English: "downloading and installing the VMware Player. Now, this is one of our first choice"
CORRECT: "دانلود و نصب VMware Player؛ این یکی از انتخاب‌های اصلی ماست." ✅

Example 2:
English: "Hey, everybody, welcome back. It's Mo again. Well, this lecture what we're going to be doing is"
CORRECT: "سلام مو هستم خوش اومدید، توی این درس می‌خوایم..." ✅`}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPromptModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
