import React, { useState } from 'react';
import { Key, X, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2, Sparkles, ExternalLink } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSaveApiKey: (newKey: string) => void;
  hasEnvKey: boolean;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSaveApiKey,
  hasEnvKey,
}) => {
  const [inputKey, setInputKey] = useState(apiKey);
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
        body: JSON.stringify({ apiKey: inputKey.trim() }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || 'اتصال با موفقیت برقرار شد!',
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'کلید وارد شده نامعتبر است یا مشکلی در اتصال به جمینای وجود دارد.',
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
    onSaveApiKey(inputKey.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-right">
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
            <h3 className="text-lg font-bold text-white">تنظیم کلید Gemini API</h3>
            <p className="text-xs text-slate-400">
              برای استفاده از مدل‌های هوش مصنوعی ترجمه و تولید صوت دوبله
            </p>
          </div>
        </div>

        {/* Info Note */}
        {hasEnvKey && (
          <div className="mb-4 p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">کلید پیش‌فرض محیطی فعال است:</span> می‌توانید بدون وارد کردن کلید از سیستم استفاده کنید یا کلید اختصاصی خود را در زیر وارد نمایید.
            </div>
          </div>
        )}

        {/* Input */}
        <div className="space-y-2 mb-4">
          <label className="text-xs font-semibold text-slate-300 block">
            کلید API اختصاصی شما (Google Gemini API Key):
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => {
                setInputKey(e.target.value);
                setTestResult(null);
              }}
              placeholder="AIzaSy..."
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
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span>کلید در مرورگر شما ذخیره می‌شود و مستقیماً برای درخواست‌ها به سرور ارسال می‌گردد.</span>
          </p>
        </div>

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
            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
            <span>تست و بررسی اعتبار</span>
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
