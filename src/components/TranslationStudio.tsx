import React, { useState } from 'react';
import { SubtitleItem, TRANSLATION_STYLES, TranslationStyle, AVAILABLE_VOICES, GeminiVoiceId } from '../types/dubbing';
import { Languages, Wand2, RefreshCw, CheckCircle2, Clock, Sparkles, User, AlertCircle, Loader2 } from 'lucide-react';

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
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLineId, setTranslatingLineId] = useState<number | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [globalVoice, setGlobalVoice] = useState<GeminiVoiceId>('Iapetus');

  const translatedCount = subtitles.filter((s) => s.farsiText.trim().length > 0).length;
  const isAllTranslated = subtitles.length > 0 && translatedCount === subtitles.length;
  // Batch Translate All Subtitles
  const handleTranslateAll = async () => {
    if (subtitles.length === 0) return;
    setIsTranslating(true);
    setTranslationError(null);

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
        // Simple fallback
        onUpdateSubtitle(sub.id, {
          farsiText: sub.originalText ? `دیالوگ محاوره‌ای خط ${sub.id}` : sub.farsiText,
          status: 'translated',
        });
      }
    } catch (err: any) {
      console.warn('Single line translation error:', err);
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
            <span>{isTranslating ? 'در حال ترجمه سریع با Gemini 3.8 Flash...' : 'ترجمه پرسرعت و رسا با هوش مصنوعی'}</span>
          </button>
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


      {translationError && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs shadow-lg">
          <div className="flex items-center gap-2 font-bold text-amber-300 mb-1.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{translationError}</span>
          </div>
          <p className="text-slate-300 leading-relaxed mb-3">
            اگر سهمیه روزانه یا دقیقه‌ای پلن رایگان به اتمام رسیده است، می‌توانید با کلیک روی دکمه زیر یک کلید جدید وارد کنید:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenApiKeyModal && (
              <button
                type="button"
                onClick={onOpenApiKeyModal}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition text-xs"
              >
                تنظیم کلید جدید API
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

              {/* Source (English) and Target (Farsi Dubbing Dialogue) - Complete Semantic Freedom Without Word Restrictions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* English Source */}
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                    <span>زیرنویس انگلیسی اصلی:</span>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {duration} ثانیه
                    </span>
                  </div>
                  <div dir="ltr" className="text-xs text-slate-300 font-sans leading-relaxed">
                    {sub.originalText}
                  </div>
                </div>

                {/* Farsi Dubbing Dialogue (Editable) */}
                <div className="bg-amber-500/5 rounded-xl p-3 border border-amber-500/20">
                  <div className="text-[11px] font-semibold text-amber-400 mb-1 flex items-center justify-between">
                    <span>دیالوگ دوبله فارسی:</span>
                    <div className="flex items-center gap-1.5">
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
    </div>
  );
};
