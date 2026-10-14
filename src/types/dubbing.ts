export type GeminiVoiceId = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Iapetus';

export interface SubtitleItem {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  startTimeStr: string; // e.g. "00:00:01,200"
  endTimeStr: string;   // e.g. "00:00:04,500"
  originalText: string;
  farsiText: string;
  voice: GeminiVoiceId;
  emotion?: string;
  audioBase64?: string;
  audioBlobUrl?: string;
  audioDuration?: number;
  status: 'idle' | 'translating' | 'translated' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface VoiceOption {
  id: GeminiVoiceId;
  nameFa: string;
  genderFa: string;
  descriptionFa: string;
  color: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  {
    id: 'Iapetus',
    nameFa: 'ایپتوس (Iapetus)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه عمیق، مقتدر، رسا و مطمئن؛ ادای دقیق مفاهیم تخصصی و آموزشی',
    color: 'blue',
  },
  {
    id: 'Fenrir',
    nameFa: 'فنریر (Fenrir)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه گرم، باوقار، شمرده و مسلط؛ تدریس قدم‌به‌قدم با لحن استادانه',
    color: 'amber',
  },
  {
    id: 'Charon',
    nameFa: 'کارون (Charon)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه آکادمیک، پخته، جدی و تحلیلی؛ انتقال عمیق مباحث پیچیده',
    color: 'purple',
  },
  {
    id: 'Puck',
    nameFa: 'پوک (Puck)',
    genderFa: 'مرد',
    descriptionFa: 'صدای مردانه پویا، تعاملی و پرانرژی؛ آموزش جذاب و همراه با انگیزه',
    color: 'emerald',
  },
  {
    id: 'Kore',
    nameFa: 'کوره (Kore)',
    genderFa: 'زن',
    descriptionFa: 'صدای زنانه شیوا، صبور، شفاف و ترغیب‌کننده؛ ایده‌آل برای تدریس صمیمی و مفهومی',
    color: 'rose',
  },
  {
    id: 'Zephyr',
    nameFa: 'زفیر (Zephyr)',
    genderFa: 'زن',
    descriptionFa: 'صدای زنانه متین، روشن، با آهنگ کلام منظم و استاندارد دوره‌های بین‌المللی',
    color: 'cyan',
  },
];

export type TranslationStyle = 'colloquial' | 'educational' | 'formal';

export interface SpeechPersona {
  id: string;
  nameEn: string;
  nameFa: string;
  genderFa: 'مرد' | 'زن';
  defaultVoice: GeminiVoiceId;
  stylePrompt: string;
  descriptionFa: string;
}

export const SPEECH_PERSONAS: SpeechPersona[] = [
  {
    id: 'iapetus_online_instructor',
    nameEn: 'Iapetus (Tech Course Lead)',
    nameFa: 'ایپتوس (مدرس ارشد و فنی)',
    genderFa: 'مرد',
    defaultVoice: 'Iapetus',
    stylePrompt: 'Top-tier tech course instructor, masculine, authoritative yet conversational, precise enunciation of code and technical terms, measured pacing, confident pedagogical delivery, engaging and never theatrical',
    descriptionFa: 'مدرس مسلط بر مباحث فنی؛ تلفظ بی‌نقص لغات تخصصی با بیان مقتدر و روان دوره‌های روز دنیا',
  },
  {
    id: 'fenrir_senior_mentor',
    nameEn: 'Fenrir (Senior Mentor)',
    nameFa: 'فنریر (منتور باتجربه)',
    genderFa: 'مرد',
    defaultVoice: 'Fenrir',
    stylePrompt: 'Senior online mentor, warm masculine tone, patient and thorough explanation, steady teaching cadence, friendly guidance, crystal-clear pronunciation',
    descriptionFa: 'لحن گرم و راهنمای منتور آموزشی؛ شمرده، قابل فهم، باوقار و اطمینان‌بخش برای یادگیری گام‌به‌گام',
  },
  {
    id: 'charon_academic_lecturer',
    nameEn: 'Charon (Academic Lecturer)',
    nameFa: 'کارون (استاد مفاهیم پایه و معماری)',
    genderFa: 'مرد',
    defaultVoice: 'Charon',
    stylePrompt: 'Deep analytical professor, clear articulation, intellectual depth, structured lecture rhythm, calm enunciation, focused purely on educational clarity',
    descriptionFa: 'بیان سنجیده و آکادمیک برای انتقال سرفصل‌های پایه‌ای، الگوهای طراحی و مفاهیم سنگین',
  },
  {
    id: 'puck_interactive_coach',
    nameEn: 'Puck (Interactive Coach)',
    nameFa: 'پوک (مربی پویا و ورکشاپ)',
    genderFa: 'مرد',
    defaultVoice: 'Puck',
    stylePrompt: 'Dynamic interactive boot-camp instructor, clear enthusiastic delivery, conversational teaching style, crisp pronunciation, engaging without being radio or broadcasty',
    descriptionFa: 'آموزش پرانرژی و تعاملی؛ حفظ تمرکز دانشجو در بوت‌کمپ‌ها و پروژه‌های عملی با لحن زنده و صمیمی',
  },
  {
    id: 'kore_master_educator',
    nameEn: 'Kore (Master Educator)',
    nameFa: 'کوره (مدرس صبور و مفهومی)',
    genderFa: 'زن',
    defaultVoice: 'Kore',
    stylePrompt: 'Master educator, warm feminine voice, patient, clear enunciation, gentle encouragement, natural pedagogical rhythm, articulate explanation of complex topics',
    descriptionFa: 'سبک مشهور آموزش استاندارد؛ بیانی صبورانه، شمرده، عاری از هرگونه اغراق و کاملاً قابل درک',
  },
  {
    id: 'zephyr_methodology_trainer',
    nameEn: 'Zephyr (Structured Trainer)',
    nameFa: 'زفیر (مدرس ساختاریافته و استاندارد)',
    genderFa: 'زن',
    defaultVoice: 'Zephyr',
    stylePrompt: 'Modern online course trainer, smooth feminine voice, articulate cadence, clear vocal inflection, clean pronunciation of terminology, balanced tempo',
    descriptionFa: 'تدریس استاندارد و مدرن دوره‌های آنلاین؛ ادای شفاف سیلاب‌ها، وزن کلام یکدست و تمرکز بر یادگیری سریع',
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
    titleFa: 'محاوره‌ای آموزشی (مانند بهترین دوره‌های آنلاین)',
    descFa: 'روان، صمیمی، استادانه، حفظ تلفظ اصلی واژگان تخصصی و بدون اغراق سینمایی',
  },
  {
    id: 'educational',
    titleFa: 'تخصصی و گام‌به‌گام (تدریس فنی و کدنویسی)',
    descFa: 'دقیق، شفاف و رسا؛ بیان استاندارد مفاهیم برنامه‌نویسی و اصطلاحات مهندسی',
  },
  {
    id: 'formal',
    titleFa: 'رسمی و دانشگاهی',
    descFa: 'ساختاریافته و متین برای دوره‌ها و ارائه‌های سازمانی و آکادمیک',
  },
];
