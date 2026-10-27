import React, { useState } from 'react';
import {
  Key,
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  Globe,
  Bot,
  Volume2,
  Layers,
} from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  baseUrl?: string;
  translationModel?: string;
  ttsModel?: string;
  onSaveApiKey: (newKey: string, newBaseUrl?: string, newTransModel?: string, newTtsModel?: string) => void;
  hasEnvKey: boolean;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  baseUrl = 'https://api.hormouz.net/v1',
  translationModel = 'OpenAI: GPT-6 Luna',
  ttsModel = 'google/gemini-3.8-flash-lite-tts',
  onSaveApiKey,
  hasEnvKey,
}) => {
  const [provider, setProvider] = useState<'hormouz' | 'gemini'>(() => {
    return baseUrl.includes('hormouz') || !apiKey.startsWith('AIzaSy') ? 'hormouz' : 'gemini';
  });

  const [inputKey, setInputKey] = useState(apiKey);
  const [inputBaseUrl, setInputBaseUrl] = useState(baseUrl);
  const [inputTransModel, setInputTransModel] = useState(translationModel);
  const [inputTtsModel, setInputTtsModel] = useState(ttsModel);

  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    if (!inputKey.trim()) {
      setTestResult({
        success: false,
        message: 'لطفاً ابتدا کلید API خود را در کادر زیر وارد کنید.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/check-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: inputKey.trim(),
          baseUrl: provider === 'hormouz' ? inputBaseUrl.trim() : '',
          translationModel: inputTransModel.trim(),
          ttsModel: inputTtsModel.trim(),
          validateLive: true,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || 'ارتباط با هوش مصنوعی با موفقیت برقرار شد!',
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'کلید وارد شده نامعتبر است یا مشکلی در اتصال وجود دارد.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'خطا در برقراری ارتباط با سرور.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    const activeBaseUrl = provider === 'hormouz' ? inputBaseUrl.trim() : 'https://generativelanguage.googleapis.com';
    onSaveApiKey(inputKey.trim(), activeBaseUrl, inputTransModel.trim(), inputTtsModel.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative text-right max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute left-4 top-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">تنظیمات اتصال به هوش مصنوعی</h3>
            <p className="text-xs text-slate-400">
              اتصال به پلتفرم هوش مصنوعی هرمز (Hormouz AI) یا Google Gemini
            </p>
          </div>
        </div>

        {/* Provider Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950/80 rounded-xl border border-slate-800 mb-5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setProvider('hormouz');
              setInputBaseUrl('https://api.hormouz.net/v1');
              setTestResult(null);
            }}
            className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition ${
              provider === 'hormouz'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-4 h-4 text-amber-400" />
            <span>هوش مصنوعی هرمز (Hormouz AI)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setProvider('gemini');
              setTestResult(null);
            }}
            className={`py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition ${
              provider === 'gemini'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Google Gemini مستقیم</span>
          </button>
        </div>

        {/* Info Note if env key is detected */}
        {hasEnvKey && (
          <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">کلید پیش‌فرض در فایل محیطی (.env) فعال است:</span> می‌توانید بدون تغییر، از کلید سرور استفاده کنید یا کلید اختصاصی خود را در زیر ثبت نمایید.
            </div>
          </div>
        )}

        {/* API Key Input */}
        <div className="space-y-2 mb-4">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>
              {provider === 'hormouz' ? 'کلید API هرمز (Hormouz API Key):' : 'کلید اختصاصی Google Gemini API:'}
            </span>
            <span className="text-[11px] text-slate-500 font-normal">
              {provider === 'hormouz' ? 'دریافت شده از پنل هرمز' : 'دریافت شده از AI Studio'}
            </span>
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => {
                setInputKey(e.target.value);
                setTestResult(null);
              }}
              placeholder={provider === 'hormouz' ? 'کلید اختصاصی هرمز...' : 'AIzaSy...'}
              dir="ltr"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2.5 px-4 pl-12 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-mono transition"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Hormouz Custom Configuration */}
        {provider === 'hormouz' && (
          <div className="space-y-4 mb-4 p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
            {/* Base URL */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-amber-400" />
                <span>آدرس پایه سرویس (Base URL):</span>
              </label>
              <input
                type="text"
                value={inputBaseUrl}
                onChange={(e) => {
                  setInputBaseUrl(e.target.value);
                  setTestResult(null);
                }}
                placeholder="https://api.hormouz.net/v1"
                dir="ltr"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-xs text-slate-200 placeholder:text-slate-600 font-mono focus:outline-none focus:border-amber-500 transition"
              />
            </div>

            {/* Translation Model */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-blue-400" />
                  <span>مدل ترجمه زیرنویس (Translation Model):</span>
                </span>
              </label>
              <input
                type="text"
                value={inputTransModel}
                onChange={(e) => {
                  setInputTransModel(e.target.value);
                  setTestResult(null);
                }}
                placeholder="OpenAI: GPT-6 Luna"
                dir="ltr"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-xs text-slate-200 placeholder:text-slate-600 font-mono focus:outline-none focus:border-amber-500 transition"
              />
              {/* Quick tags */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-500">پیشنهادی:</span>
                {[
                  'OpenAI: GPT-6 Luna',
                  'openai/gpt-4o',
                  'openai/gpt-4o-mini',
                  'deepseek-chat',
                ].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInputTransModel(m)}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* TTS Model */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>مدل صوتی دوبله فارسی (TTS Model):</span>
                </span>
              </label>
              <input
                type="text"
                value={inputTtsModel}
                onChange={(e) => {
                  setInputTtsModel(e.target.value);
                  setTestResult(null);
                }}
                placeholder="google/gemini-3.8-flash-lite-tts"
                dir="ltr"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-xs text-slate-200 placeholder:text-slate-600 font-mono focus:outline-none focus:border-amber-500 transition"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-slate-500">پیش‌فرض:</span>
                <button
                  type="button"
                  onClick={() => setInputTtsModel('google/gemini-3.8-flash-lite-tts')}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                >
                  google/gemini-3.8-flash-lite-tts
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Test Result Message */}
        {testResult && (
          <div
            className={`p-3 rounded-xl mb-4 text-xs flex items-start gap-2.5 border ${
              testResult.success
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            )}
            <span className="leading-relaxed">{testResult.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={handleTestKey}
            disabled={isTesting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>تست و بررسی اتصال</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-amber-500/20"
            >
              ذخیره و اعمال
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
