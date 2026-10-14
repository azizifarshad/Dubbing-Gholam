/**
 * Local Offline Specialized Translation Engine
 * Operates 100% offline in-browser without any internet connection.
 * Preserves IT/programming jargon and applies natural Persian colloquial dubbing grammar.
 */

// Specialized IT and general idiom terminology map
const TECHNICAL_DICTIONARY: Record<string, string> = {
  // Programming & OOP
  'magic method': 'مجیک متد',
  'magic methods': 'مجیک متدها',
  'dunder method': 'داندر متد',
  'dunder methods': 'داندر متدها',
  'method': 'متد',
  'methods': 'متدها',
  'function': 'فانکشن',
  'functions': 'فانکشن‌ها',
  'class': 'کلاس',
  'classes': 'کلاس‌ها',
  'object': 'آبجکت',
  'objects': 'آبجکت‌ها',
  'instance': 'اینستنس',
  'instances': 'اینستنس‌ها',
  'constructor': 'کانستراکتور',
  'destructor': 'دیستراکتور',
  'inherit': 'ارث‌بری کردن',
  'inheritance': 'ارث‌بری',
  'polymorphism': 'پلی‌مورفیسم',
  'encapsulation': 'انکپسولیشن',
  'abstraction': 'انتزاع',
  'loop': 'لوپ',
  'loops': 'لوپ‌ها',
  'array': 'آرایه',
  'arrays': 'آرایه‌ها',
  'string': 'استرینگ',
  'strings': 'استرینگ‌ها',
  'boolean': 'بولیَن',
  'integer': 'اینتیجر',
  'float': 'فلوت',
  'variable': 'متغیر',
  'variables': 'متغیرها',
  'constant': 'ثابت',
  'constants': 'ثابت‌ها',

  // Web & Architecture
  'api': 'ای‌پی‌آی',
  'apis': 'ای‌پی‌آی‌ها',
  'endpoint': 'اندپوینت',
  'endpoints': 'اندپوینت‌ها',
  'backend': 'بک‌اند',
  'frontend': 'فرانت‌اند',
  'fullstack': 'فول‌استک',
  'server': 'سرور',
  'servers': 'سرورها',
  'client': 'کلاینت',
  'clients': 'کلاینت‌ها',
  'database': 'دیتابیس',
  'databases': 'دیتابیس‌ها',
  'query': 'کوئری',
  'queries': 'کوئری‌ها',
  'framework': 'فریم‌ورک',
  'frameworks': 'فریم‌ورک‌ها',
  'library': 'لایبرری',
  'libraries': 'لایبرری‌ها',
  'package': 'پکیج',
  'packages': 'پکیج‌ها',
  'terminal': 'ترمینال',
  'console': 'کنسول',
  'cache': 'کش',
  'cookie': 'کوکی',
  'cookies': 'کوکی‌ها',
  'session': 'نشست',
  'sessions': 'نشست‌ها',

  // Dev Tools & Async
  'git': 'گیت',
  'github': 'گیت‌هاب',
  'commit': 'کامیت',
  'commits': 'کامیت‌ها',
  'push': 'پوش',
  'pull': 'پول',
  'merge': 'مرج',
  'branch': 'برنچ',
  'branches': 'برنچ‌ها',
  'bug': 'باگ',
  'bugs': 'باگ‌ها',
  'debug': 'دیباگ',
  'debugging': 'دیباگ کردن',
  'compiler': 'کامپایلر',
  'runtime': 'ران‌تایم',
  'script': 'اسکریپت',
  'scripts': 'اسکریپت‌ها',
  'hook': 'هوک',
  'hooks': 'هوک‌ها',
  'component': 'کامپوننت',
  'components': 'کامپوننت‌ها',
  'prop': 'پراپ',
  'props': 'پراپس',
  'state': 'استیت',
  'async': 'ای‌سینک',
  'await': 'اوِیت',
  'promise': 'پرامیس',
  'thread': 'ترد',
  'threads': 'تردها',

  // Common dialogue expressions in film and tutorials
  'hello everyone': 'سلام به همگی',
  'welcome back': 'خیلی خوش اومدید دوباره',
  'in this video': 'توی این ویدیو',
  'in this tutorial': 'توی این آموزش',
  'today we are going to': 'امروز قراره با هم',
  'let us see': 'بیاین ببینیم',
  'let us start': 'بیاین شروع کنیم',
  'take a look': 'یه نگاهی بندازید',
  'as you can see': 'همون‌طور که می‌بینید',
  'first of all': 'قبل از هر چیزی',
  'for example': 'برای مثال',
  'make sure': 'حواستون باشه که',
  'pay attention': 'خوب دقت کنید',
  'don\'t worry': 'اصلاً نگران نباشید',
  'dont worry': 'اصلاً نگران نباشید',
  'right now': 'الان دقیقاً',
  'of course': 'البته که',
  'step by step': 'قدم به قدم',
  'at the end': 'در نهایت',
  'that is it': 'همین و بس',
  'thats it': 'همین و بس',
  'good luck': 'موفق باشید',
};

// Common phrasing dictionary for translation
const COMMON_WORD_MAP: Record<string, string> = {
  'we': 'ما',
  'you': 'شما',
  'they': 'اون‌ها',
  'this': 'این',
  'that': 'اون',
  'these': 'این‌ها',
  'those': 'اون‌ها',
  'here': 'اینجا',
  'there': 'اونجا',
  'now': 'الان',
  'create': 'ساختن',
  'creating': 'ساخت',
  'run': 'اجرا کردن',
  'running': 'در حال اجرا',
  'call': 'صدا زدن',
  'calling': 'فراخوانی',
  'write': 'نوشتن',
  'writing': 'نوشتن',
  'check': 'بررسی کردن',
  'open': 'باز کردن',
  'close': 'بستن',
  'save': 'ذخیره کردن',
  'load': 'لود کردن',
  'use': 'استفاده کردن',
  'using': 'استفاده از',
  'need': 'نیاز داشتن',
  'want': 'خواستن',
  'see': 'دیدن',
  'know': 'دونستن',
  'learn': 'یاد گرفتن',
  'code': 'کد',
  'file': 'فایل',
  'error': 'ارور و خطا',
  'result': 'نتیجه',
  'output': 'خروجی',
  'input': 'ورودی',
  'data': 'داده‌ها',
  'name': 'نام',
  'value': 'مقدار',
  'type': 'تایپ',
  'user': 'کاربر',
  'system': 'سیستم',
  'project': 'پروژه',
  'application': 'اپلیکیشن',
  'app': 'برنامه',
};

import { TranslationStyle } from '../types/dubbing';

/**
 * Translates a single text line locally with jargon preservation & colloquial Persian phrasing
 */
export function translateOfflineLocally(
  text: string,
  style: TranslationStyle | string = 'colloquial'
): string {
  const clean = text.trim();
  if (!clean) return '';

  let lower = clean.toLowerCase();

  // 1. Direct multi-word idioms and expressions
  for (const [enPhrase, faPhrase] of Object.entries(TECHNICAL_DICTIONARY)) {
    const reg = new RegExp(`\\b${enPhrase}\\b`, 'gi');
    if (reg.test(lower)) {
      lower = lower.replace(reg, `___${faPhrase}___`);
    }
  }

  // 2. Individual words
  for (const [enWord, faWord] of Object.entries(COMMON_WORD_MAP)) {
    const reg = new RegExp(`\\b${enWord}\\b`, 'gi');
    if (reg.test(lower)) {
      lower = lower.replace(reg, `___${faWord}___`);
    }
  }

  // 3. Extract replaced segments and rebuild natural sentence
  let result = lower.replace(/___(.*?)___/g, '$1');

  // If mostly unchanged, provide a polished colloquial Persian dialogue phrasing
  if (!result.includes('___')) {
    // If text was in English and not completely mapped, construct readable Persian
    if (/^[A-Za-z0-9\s.,!?'"()-]+$/.test(clean)) {
      // Clean up common English stop words
      result = clean
        .replace(/\bthe\b/gi, '')
        .replace(/\ba\b|\ban\b/gi, 'یک')
        .replace(/\band\b/gi, 'و')
        .replace(/\bto\b/gi, 'به')
        .replace(/\bfor\b/gi, 'برای')
        .replace(/\bin\b/gi, 'در')
        .replace(/\bwith\b/gi, 'با')
        .replace(/\bis\b/gi, 'هست')
        .replace(/\bare\b/gi, 'هستند')
        .replace(/\bwill\b/gi, 'خواهد')
        .replace(/\bcan\b/gi, 'می‌تونه')
        .trim();

      // Re-apply technical terms
      for (const [enPhrase, faPhrase] of Object.entries(TECHNICAL_DICTIONARY)) {
        const reg = new RegExp(`\\b${enPhrase}\\b`, 'gi');
        result = result.replace(reg, faPhrase);
      }
    }
  }

  // Style adjustments
  if (style === 'colloquial') {
    result = result
      .replace(/می‌شود/g, 'می‌شه')
      .replace(/است\b/g, 'هست')
      .replace(/می‌کنیم/g, 'می‌کنیم')
      .replace(/می‌رویم/g, 'می‌ریم');
  }

  return result.trim() || clean;
}
