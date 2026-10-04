export interface SubtitleItem {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  startTimeStr: string; // e.g. "00:00:01,200"
  endTimeStr: string;   // e.g. "00:00:04,500"
  originalText: string;
  farsiText: string;
  voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  emotion?: string;
  audioBase64?: string;
  audioBlobUrl?: string;
  audioDuration?: number;
  status: 'idle' | 'translating' | 'translated' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface VoiceOption {
  id: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  nameFa: string;
  genderFa: string;
  descriptionFa: string;
  color: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  {
    id: 'Puck',
    nameFa: 'پوک (Puck)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه پرانرژی، جوان و مناسب کاراکترهای اصلی و پرتحرک',
    color: 'emerald',
  },
  {
    id: 'Kore',
    nameFa: 'کوره (Kore)',
    genderFa: 'زن',
    descriptionFa: 'صدای زنانه گرم، دلنشین، رسا و مناسب نقش‌های زنانه و عاطفی',
    color: 'rose',
  },
  {
    id: 'Fenrir',
    nameFa: 'فنریر (Fenrir)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه عمیق، سینمایی، بم و مناسب کاراکترهای مقتدر و اکشن',
    color: 'amber',
  },
  {
    id: 'Zephyr',
    nameFa: 'زفیر (Zephyr)',
    genderFa: 'خنثی / ملایم',
    descriptionFa: 'صدای متعادل، روان، شیوا و مناسب راوی و دیالوگ‌های آرام',
    color: 'cyan',
  },
  {
    id: 'Charon',
    nameFa: 'کارون (Charon)',
    genderFa: 'مرد',
    descriptionFa: 'صدای پخته، جدی، سنگین و کلاسیک برای شخصیت‌های مسن‌تر یا جدی',
    color: 'purple',
  },
];

export type TranslationStyle = 'colloquial' | 'cinematic' | 'formal' | 'energetic';

export interface SpeechPersona {
  id: string;
  nameEn: string;
  nameFa: string;
  defaultVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  stylePrompt: string;
  descriptionFa: string;
}

export const SPEECH_PERSONAS: SpeechPersona[] = [
  {
    id: 'patient_teacher',
    nameEn: 'The Patient Teacher',
    nameFa: 'The Patient Teacher (معلم صبور و شیوا)',
    defaultVoice: 'Kore',
    stylePrompt: 'The Patient Teacher: Patient, articulate, warm, clear enunciation, measured pacing, calm and encouraging tone',
    descriptionFa: 'سبک معروف هوش مصنوعی گوگل (Generate Speech) با لحن آرام، شمرده، تلفظ دقیق، رسا و گوش‌نواز',
  },
  {
    id: 'cinematic_dubber',
    nameEn: 'The Cinematic Dubber',
    nameFa: 'The Cinematic Dubber (دوبلور سینمایی)',
    defaultVoice: 'Puck',
    stylePrompt: 'Theatrical, dramatic, cinematic movie dubbing actor, emotive, immersive and natural',
    descriptionFa: 'لحن دراماتیک، زنده و پرانرژی مناسب برای نقش‌های اول و سکانس‌های اکشن',
  },
  {
    id: 'deep_storyteller',
    nameEn: 'The Deep Storyteller',
    nameFa: 'The Deep Storyteller (راوی حماسی و بم)',
    defaultVoice: 'Fenrir',
    stylePrompt: 'Deep, resonant, cinematic storytelling, authoritative, majestic and atmospheric',
    descriptionFa: 'صدای بم، گیرا و پرصلابت برای راوی یا شخصیت‌های مقتدر',
  },
  {
    id: 'calm_broadcaster',
    nameEn: 'The Calm Broadcaster',
    nameFa: 'The Calm Broadcaster (گوینده ملایم و رادیویی)',
    defaultVoice: 'Zephyr',
    stylePrompt: 'Smooth, balanced, articulate radio broadcaster, calm and conversational rhythm',
    descriptionFa: 'بیان روان و متین برای دیالوگ‌های آرام، مستند و آموزشی',
  },
];

export interface StyleOption {
  id: TranslationStyle;
  titleFa: string;
  descFa: string;
}

export const TRANSLATION_STYLES: StyleOption[] = [
  {
    id: 'colloquial',
    titleFa: 'محاوره‌ای طبیعی (دوبله فیلم‌های محبوب)',
    descFa: 'روان، صمیمی، اصطلاحات روزمره و متناسب با لب‌خوانی طبیعی',
  },
  {
    id: 'cinematic',
    titleFa: 'سینمایی فاخر و کلاسیک',
    descFa: 'لحن شکوهمند دوبلاژ طلایی ایران، با کلمات سنجیده و ادبی‌تر',
  },
  {
    id: 'energetic',
    titleFa: 'پرهیجان و کمدی / انیمیشن',
    descFa: 'لحن شاداب با تکیه‌کلام‌های جذاب و تند برای کارتون و اکشن',
  },
  {
    id: 'formal',
    titleFa: 'رسمی و مستند',
    descFa: 'دقیق، بدون اصطلاحات کوچه بازاری برای فیلم‌های مستند و علمی',
  },
];
