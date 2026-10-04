import React from 'react';
import { Mic2, Key, Sliders, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';

interface HeaderProps {
  onOpenApiKeyModal: () => void;
  hasApiKey: boolean;
  activeLinesCount: number;
  readyVoicesCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenApiKeyModal,
  hasApiKey,
  activeLinesCount,
  readyVoicesCount,
}) => {
  return (
    <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
        {/* Brand & Title */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950">
            <Mic2 className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                استودیو دوبله هوشمند فارسی
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium">
                Gemini 3.8 AI
              </span>
            </div>
            <p className="text-xs text-slate-400">
              ترجمه زیرنویس انگلیسی، صداپیشگی هوشمند و ساخت فایل صوتی دوبله همگام با فیلم
            </p>
          </div>
        </div>

        {/* Action Controls & API Key */}
        <div className="flex items-center gap-3">
          {activeLinesCount > 0 && (
            <div className="hidden md:flex items-center gap-3 text-xs bg-slate-800/80 border border-slate-700/60 px-3.5 py-1.5 rounded-lg text-slate-300">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">دیالوگ‌ها:</span>
                <span className="font-semibold text-amber-400">{activeLinesCount}</span>
              </div>
              <span className="text-slate-600">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">صداهای آماده:</span>
                <span className="font-semibold text-emerald-400">{readyVoicesCount}</span>
              </div>
            </div>
          )}

          <button
            onClick={onOpenApiKeyModal}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border ${
              hasApiKey
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>{hasApiKey ? 'کلید API متصل است' : 'تنظیم کلید Gemini API'}</span>
            {hasApiKey ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
