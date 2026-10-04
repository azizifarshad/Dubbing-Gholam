import React, { useState } from 'react';
import { SubtitleItem, TRANSLATION_STYLES, TranslationStyle, AVAILABLE_VOICES } from '../types/dubbing';
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
  const [globalVoice, setGlobalVoice] = useState<'Puck' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Charon'>('Puck');

  const translatedCount = subtitles.filter((s) => s.farsiText.trim().length > 0).length;
  const isAllTranslated = subtitles.length > 0 && translatedCount === subtitles.length;

  // Instant fallback dubbing script for standard action/movie lines without consuming API quota
  const handleLoadSuggestedDubbing = () => {
    const suggestedMap: Record<number, { text: string; voice: any; emotion: string }> = {
      1: {
        text: 'هی جان، مطمئنی اینجا جای درسته؟',
        voice: 'Kore',
        emotion: 'کنجکاو و نگران',
      },
      2: {
        text: 'به من اعتماد کن سارا. سیگنال دقیقاً از داخل همین اتاق میاد.',
        voice: 'Puck',
        emotion: 'با اطمینان و جدی',
      },
      3: {
        text: 'قبل از اینکه نگهبانا سر برسن وقت زیادی نداریم. زود باش عجله کن!',
        voice: 'Kore',
        emotion: 'مضطرب و سریع',
      },
      4: {
        text: 'اون کنسول رو ببین! به نظر میاد کل سیستم قفلش باز شده.',
        voice: 'Fenrir',
        emotion: 'هیجان‌زده و غافلگیر',
      },
      5: {
        text: 'کارت حرف نداشت! فایل‌های محرمانه رو سریع دانلود کن تا از اینجا بزنیم به چاک.',
        voice: 'Puck',
        emotion: 'راضی و پرانرژی',
      },
    };

    const updated = subtitles.map((sub, idx) => {
      const match = suggestedMap[sub.id] || suggestedMap[idx + 1];
      if (match) {
        return {
          ...sub,
          farsiText: match.text,
          voice: match.voice || sub.voice,
          emotion: match.emotion || 'طبیعی',
          status: 'translated' as const,
        };
      } else if (!sub.farsiText.trim()) {
        return {
          ...sub,
          farsiText: `دیالوگ فارسی خط شماره ${idx + 1}`,
          status: 'translated' as const,
        };
      }
      return sub;
    });

    onUpdateAllSubtitles(updated);
    setTranslationError(null);
  };

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

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'خطا در ترجمه با جمینای');
      }

      const translationMap = new Map<number, { farsiText: string; characterEmotion?: string; suggestedGender?: string }>();
      for (const t of data.translations) {
        translationMap.set(t.id, t);
      }

      const updated = subtitles.map((sub) => {
        const trans = translationMap.get(sub.id);
        if (trans) {
          // If suggestion is female, default to Kore; if male, default to Puck or Fenrir
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
    } catch (err: any) {
      console.error(err);
      setTranslationError(err.message || 'خطا در ترجمه زیرنویس‌ها');
    } finally {
      setIsTranslating(false);
    }
  };

  // Translate Single Line
  const handleTranslateSingleLine = async (sub: SubtitleItem) => {
    setTranslatingLineId(sub.id);
    setTranslationError(null);

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

      const data = await res.json();
      if (!res.ok || !data.success || !data.translations?.[0]) {
        throw new Error(data.error || 'خطا در ترجمه این خط');
      }

      const t = data.translations[0];
      onUpdateSubtitle(sub.id, {
        farsiText: t.farsiText,
        emotion: t.characterEmotion || sub.emotion,
        status: 'translated',
      });
    } catch (err: any) {
      setTranslationError(err.message || 'خطا در ترجمه خط');
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
            هوش مصنوعی جملات را به فارسی روان و متناسب با ایجاز و زمان‌بندی لب‌خوانی فیلم ترجمه می‌کند.
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
            onClick={handleLoadSuggestedDubbing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition"
            title="پر کردن سریع با متن فارسی دوبله بدون مصرف سهمیه"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>متن پیشنهادی دوبله (آفلاین)</span>
          </button>

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
            <span>{isTranslating ? 'در حال ترجمه...' : 'ترجمه تمام خطوط با هوش مصنوعی'}</span>
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

      {/* Error Alert */}
      {translationError && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-950/40 border border-amber-500/50 text-amber-200 text-xs shadow-lg">
          <div className="flex items-center gap-2 font-bold text-amber-300 mb-1.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{translationError}</span>
          </div>
          <p className="text-slate-300 leading-relaxed mb-3">
            اگر سهمیه روزانه یا دقیقه‌ای پلن رایگان به اتمام رسیده است، می‌توانید یک کلید جدید وارد کنید یا با کلیک روی دکمه زیر متن پیشنهادی دوبله را بارگذاری نمایید تا بدون وقفه به مرحله تولید صدا بروید:
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
            <button
              type="button"
              onClick={handleLoadSuggestedDubbing}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold transition text-xs flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>بارگذاری متن پیشنهادی دوبله (آفلاین)</span>
            </button>
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

              {/* Source (English) and Target (Farsi) Columns with Word Count Guidance */}
              {(() => {
                const enWordsCount = sub.originalText.trim().split(/\s+/).filter(Boolean).length;
                const faWordsCount = sub.farsiText.trim().split(/\s+/).filter(Boolean).length;
                const maxTarget = Math.max(1, Math.round(enWordsCount * 1.05));
                const isAcceptable = faWordsCount <= maxTarget;

                return (
                  <div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* English Source */}
                      <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800/80">
                        <div className="text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                          <span>زیرنویس انگلیسی اصلی:</span>
                          <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                            {enWordsCount} کلمه انگلیسی
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
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                isAcceptable || faWordsCount === 0
                                  ? 'text-emerald-300 bg-emerald-950/60 border-emerald-500/30'
                                  : 'text-amber-300 bg-amber-950/60 border-amber-500/30'
                              }`}
                            >
                              {faWordsCount} کلمه فارسی
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
                          placeholder="ترجمه فارسی این خط دیالوگ..."
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 resize-none font-sans leading-relaxed"
                        />
                      </div>
                    </div>

                    {/* Word Count Rule Feedback Pill */}
                    {faWordsCount > 0 && (
                      <div className="mt-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isAcceptable ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          <span className={isAcceptable ? 'text-emerald-300' : 'text-amber-300'}>
                            {isAcceptable
                              ? `طول دیالوگ استاندارد (فارسی: ${faWordsCount} کلمه <= انگلیسی: ${enWordsCount} کلمه - زمان‌بندی راحت و آزاد)`
                              : `متن فارسی طولانی‌تر از انگلیسی است (${faWordsCount} در برابر ${enWordsCount} کلمه - پیشنهاد: خلاصه‌تر کنید)`}
                          </span>
                        </div>
                        <span className="text-slate-500 font-mono text-[10px]">
                          سقف مجاز: حداکثر {maxTarget} کلمه (کوتاه‌تر بودن مطلوب است)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
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
