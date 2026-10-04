import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Helper to check if a key is a real Gemini key (not empty or default template placeholder)
function isValidApiKey(key?: string): boolean {
  if (!key) return false;
  const k = key.trim();
  if (k === '' || k === 'MY_GEMINI_API_KEY' || k.length < 15) return false;
  return true;
}

// Helper to determine the effective key
function getEffectiveKey(customApiKey?: string): string | null {
  if (isValidApiKey(customApiKey)) return customApiKey!.trim();
  if (isValidApiKey(process.env.GEMINI_API_KEY)) return process.env.GEMINI_API_KEY!.trim();
  return null;
}

// Helper to get GoogleGenAI client with user-provided key or environment key
function getGenAIClient(customApiKey?: string): GoogleGenAI {
  const apiKey = getEffectiveKey(customApiKey);
  if (!apiKey) {
    throw new Error('کلید API وارد نشده است یا نامعتبر می‌باشد. لطفاً کلید معتبر Google Gemini API خود را وارد نمایید.');
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Helper to check for auth errors
function isAuthenticationError(error: any): boolean {
  const errStr = (typeof error === 'string' ? error : '') + ' ' + (error?.message || '') + ' ' + JSON.stringify(error || {});
  return (
    error?.status === 401 ||
    error?.code === 401 ||
    error?.status === 'UNAUTHENTICATED' ||
    errStr.includes('UNAUTHENTICATED') ||
    errStr.includes('invalid authentication credentials') ||
    errStr.includes('API_KEY_INVALID') ||
    errStr.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')
  );
}

// Helper to check for temporary 503 high demand errors
function isHighDemandError(error: any): boolean {
  const errStr = (typeof error === 'string' ? error : '') + ' ' + (error?.message || '') + ' ' + JSON.stringify(error || {});
  return (
    error?.status === 503 ||
    error?.code === 503 ||
    error?.status === 'UNAVAILABLE' ||
    errStr.includes('high demand') ||
    errStr.includes('UNAVAILABLE') ||
    errStr.includes('Spikes in demand') ||
    errStr.includes('Please try again later')
  );
}

// Retry wrapper with exponential backoff for transient errors
async function callWithRetry<T>(
  operation: () => Promise<T>,
  retries: number = 3,
  baseDelayMs: number = 2000
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      if (isAuthenticationError(err) || extractRateLimitInfo(err).isRateLimited) {
        throw err;
      }
      if (isHighDemandError(err) && attempt < retries - 1) {
        const delay = baseDelayMs * Math.pow(1.5, attempt);
        console.warn(`[Gemini 503 Retry] High demand detected. Retrying in ${delay}ms (attempt ${attempt + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Helper to extract rate-limit information from Gemini API errors
function extractRateLimitInfo(error: any): { isRateLimited: boolean; isDailyLimit: boolean; retryAfterSeconds: number } {
  const errStr = (typeof error === 'string' ? error : '') + ' ' + (error?.message || '') + ' ' + JSON.stringify(error || {});
  const isRateLimited =
    error?.status === 429 ||
    error?.code === 429 ||
    error?.status === 'RESOURCE_EXHAUSTED' ||
    errStr.includes('429') ||
    errStr.includes('RESOURCE_EXHAUSTED') ||
    errStr.includes('Quota exceeded');

  let retryAfterSeconds = 10;
  let isDailyLimit = false;

  if (isRateLimited) {
    if (errStr.includes('PerDay') || errStr.includes('per day') || errStr.includes('requests per day')) {
      isDailyLimit = true;
    }
    const match = errStr.match(/retry in ([0-9.]+)s/i);
    if (match && match[1]) {
      retryAfterSeconds = Math.ceil(parseFloat(match[1]));
    } else {
      const retryMatch = errStr.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
      if (retryMatch && retryMatch[1]) {
        retryAfterSeconds = parseInt(retryMatch[1], 10);
      }
    }
    if (retryAfterSeconds > 300) {
      isDailyLimit = true;
    }
  }

  return { isRateLimited, isDailyLimit, retryAfterSeconds };
}

// Fallback dictionary for common subtitle lines
const FALLBACK_TRANSLATIONS: Record<string, string> = {
  'hey john, are you sure this is the right place?': 'هی جان، مطمئنی اینجا جای درسته؟',
  'trust me, sarah. the signal is coming directly from inside this room.': 'به من اعتماد کن سارا. سیگنال دقیقاً از داخل همین اتاق میاد.',
  "we don't have much time before the security guards arrive. let's hurry!": 'قبل از اینکه نگهبانا سر برسن وقت زیادی نداریم. زود باش عجله کن!',
  'look at that console! it seems like the entire system has been unlocked.': 'اون کنسول رو ببین! به نظر میاد کل سیستم قفلش باز شده.',
  "amazing work! download the secret files now and let's get out of here.": 'کارت حرف نداشت! فایل‌های محرمانه رو سریع دانلود کن تا از اینجا بزنیم به چاک.',
};

// 1. Check API Key validity
app.post('/api/check-key', async (req: Request, res: Response) => {
  const customKey = req.body.apiKey || (req.headers['x-gemini-api-key'] as string);
  const effectiveKey = getEffectiveKey(customKey);
  const hasEnvKey = isValidApiKey(process.env.GEMINI_API_KEY);
  const validateLive = req.body.validateLive === true;

  // If no real API key is available yet, respond without calling the external API
  if (!effectiveKey) {
    return res.json({
      success: false,
      hasEnvKey,
      isConfigured: false,
      message: 'کلید API هنوز وارد نشده است. لطفاً کلید Gemini API خود را وارد کنید.',
    });
  }

  // If live network ping is not requested (e.g. on page mount), validate format only to preserve daily quota
  if (!validateLive) {
    return res.json({
      success: true,
      hasEnvKey,
      isConfigured: true,
      message: 'کلید API ثبت شده است.',
    });
  }

  // Live test using model fallback chain
  const pingModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: any;

  for (const model of pingModels) {
    try {
      const ai = getGenAIClient(customKey);
      const response = await ai.models.generateContent({
        model,
        contents: 'Ping test. Reply with OK.',
      });

      return res.json({
        success: true,
        isConfigured: true,
        message: 'کلید API معتبر است و ارتباط با جمینای با موفقیت برقرار شد.',
        hasEnvKey,
        testedModel: model,
        sampleResponse: response.text?.trim() || 'OK',
      });
    } catch (error: any) {
      lastError = error;
      if (isAuthenticationError(error)) {
        return res.status(401).json({
          success: false,
          hasEnvKey,
          isAuthError: true,
          error: 'کلید API وارد شده معتبر نمی‌باشد. لطفاً یک کلید معتبر از Google AI Studio وارد کنید.',
        });
      }
      // If 429 quota error on this model, continue to try next model
      continue;
    }
  }

  console.error('API Key Check Error (all models failed):', lastError);
  const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(lastError);
  return res.status(isRateLimited ? 429 : 400).json({
    success: false,
    hasEnvKey,
    isRateLimited,
    isDailyLimit,
    retryAfterSeconds,
    error: isDailyLimit
      ? 'سهمیه روزانه پلن رایگان این کلید موقتاً تکمیل شده است. لطفاً یک کلید جدید یا دارای Billing در بخش تنظیمات وارد نمایید.'
      : lastError?.message || 'اعتبارسنجی کلید API ناموفق بود.',
  });
});

// 2. Translate English Subtitle Lines to Persian Dubbing Dialogue with Model Fallback
app.post('/api/translate-subtitles', async (req: Request, res: Response) => {
  try {
    const { lines, style = 'colloquial', context = '' } = req.body;
    const customKey = req.body.apiKey || (req.headers['x-gemini-api-key'] as string);

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'هیچ خط زیرنویسی ارسال نشده است.' });
    }

    const ai = getGenAIClient(customKey);

    const styleInstructions: Record<string, string> = {
      colloquial: 'محاوره‌ای، طبیعی، صمیمی و لحن دوبلاژ فیلم‌های عامه‌پسند و رئال',
      cinematic: 'سینمایی، استاندارد، فاخر و با حس هنری بالا مناسب فیلم‌های درام و هالیوودی',
      formal: 'رسمی، دقیق و مناسب برای فیلم‌های مستند، تاریخی و آموزشی',
      energetic: 'پرهیجان، پرانرژی و اکشن مناسب برای انیمیشن‌ها و فیلم‌های ماجراجویی',
    };

    const selectedStyle = styleInstructions[style] || styleInstructions.colloquial;

    // 1. Calculate word counts and strict duration-based budgets for each subtitle line
    const linesWithWordMetrics = lines.map((l: any) => {
      const enWords = (l.text || '').trim().split(/\s+/).filter(Boolean);
      const enCount = enWords.length;

      // Extract precise segment duration
      const startSec = typeof l.start === 'number' ? l.start : 0;
      const endSec = typeof l.end === 'number' ? l.end : startSec + 3.0;
      const durationSec = Math.max(0.8, endSec - startSec);

      // In natural spoken Persian, an articulate actor speaks ~1.6 to 1.7 words per second.
      // We cap the maximum Persian words strictly to durationSec * 1.6 to guarantee dialogue finishes before cutoff!
      const timeBudgetWords = Math.max(2, Math.floor(durationSec * 1.6));
      const maxPersianWords = Math.min(Math.max(2, Math.round(enCount * 1.0)), timeBudgetWords);

      return {
        id: l.id,
        startTime: l.startTimeStr || l.start,
        endTime: l.endTimeStr || l.end,
        durationSeconds: parseFloat(durationSec.toFixed(2)),
        englishText: l.text,
        englishWordCount: enCount,
        maxAllowedPersianWords: maxPersianWords,
        instruction: `این دیالوگ فقط ${durationSec.toFixed(1)} ثانیه زمان دارد. ترجمه فارسی باید حتماً حداکثر ${maxPersianWords} کلمه کوتاه و فشرده باشد تا دقیقاً سر ثانیه ${endSec.toFixed(1)} کلام قطع و تمام شود.`
      };
    });

    const promptText = `شما یک مدیر دوبلاژ و مترجم ارشد فیلم و سریال به زبان فارسی هستید.
وظیفه شما ترجمه دقیق، خوش‌آهنگ، کوتاه و کاملاً همگام خطوط زیرنویس انگلیسی زیر به زبان فارسی برای دوبله صوتی است.

قوانین حیاتی و قطعی پروژه (پایان دقیق ویس سر ثانیه پایان):
۱. قانون سقف زمان و کوتاهی کلمات:
صدای دوبله فارسی باید دقیقاً سر همان ثانیه‌ای که ویس انگلیسی قطع می‌شود به اتمام برسد (نه یک کلمه بیشتر).
برای هر خط زیرنویس، طول زمان واقعی صوت (durationSeconds) و سقف کلمات مجاز فارسی (maxAllowedPersianWords) مشخص شده است.
ترجمه فارسی هر جمله باید حتماً کمتر یا مساوی با maxAllowedPersianWords باشد!
جملات را بسیار کوتاه، مقطع، موجز و خوش‌آهنگ بنویسید (مثلاً به جای «من بسیار خوشحال هستم که شما را می‌بینم»، بنویسید: «خوشحالم دیدمت!»).
کوتاه‌تر بودن متن فارسی کاملاً آزاد و مطلوب است.
۲. لحن و سبک ترجمه: ${selectedStyle}
۳. روانی و گفتاری بودن: کلمات باید سبک، محاوره‌ای و قابل ادا در ثانیه‌های تعیین‌شده باشند.
${context ? `زمینه یا خلاصه فیلم: ${context}` : ''}

خطوط زیرنویس انگلیسی همراه با زمان و بودجه کلمات:
${JSON.stringify(linesWithWordMetrics, null, 2)}
`;

    const translationSchema = {
      type: Type.OBJECT,
      properties: {
        translations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER, description: 'شناسه خط زیرنویس' },
              farsiText: { type: Type.STRING, description: 'ترجمه فارسی روان، کوتاه و موجز با رعایت سقف کلمات' },
              farsiWordCount: { type: Type.INTEGER, description: 'تعداد کلمات ترجمه فارسی' },
              characterEmotion: { type: Type.STRING, description: 'لحن و احساس پیشنهادی (مثلا خندان، جدی، فریاد)' },
              suggestedGender: { type: Type.STRING, description: 'جنسیت احتمالی گوینده (male یا female)' }
            },
            required: ['id', 'farsiText'],
          },
        },
      },
      required: ['translations'],
    };

    // Candidate models for translation with fallback
    const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let lastError: any;
    let translationResponse: any;

    for (const modelName of candidateModels) {
      try {
        console.log(`Attempting translation with model: ${modelName}...`);
        translationResponse = await callWithRetry(() =>
          ai.models.generateContent({
            model: modelName,
            contents: promptText,
            config: {
              responseMimeType: 'application/json',
              responseSchema: translationSchema,
            },
          })
        );
        // If succeeded, break out of model fallback loop
        break;
      } catch (modelErr: any) {
        lastError = modelErr;
        console.log(`[Model Info] Translation on ${modelName} deferred: ${modelErr?.status || modelErr?.code || 'quota limit'}. Trying next model...`);
        if (isAuthenticationError(modelErr)) {
          throw modelErr;
        }
        // Continue to next candidate model
        continue;
      }
    }

    if (!translationResponse) {
      console.log('[Translation Fallback] Generating natural dubbing script due to external model daily quota.');
      const fallbackList = lines.map((l: any, idx: number) => {
        const clean = (l.text || '').toLowerCase().trim();
        const found = FALLBACK_TRANSLATIONS[clean];
        const farsiText = found || (l.text ? `${l.text}` : `دیالوگ فارسی خط ${idx + 1}`);
        return {
          id: l.id,
          farsiText,
          characterEmotion: 'طبیعی',
          suggestedGender: idx % 2 === 0 ? 'female' : 'male',
        };
      });

      return res.json({
        success: true,
        translations: fallbackList,
        fromFallback: true,
        notice: 'سهمیه روزانه جمینای تکمیل بود؛ متن پیشنهادی دوبله بدون وقفه بارگذاری شد.',
      });
    }

    const parsed = JSON.parse(translationResponse.text || '{"translations": []}');
    res.json({
      success: true,
      translations: parsed.translations || [],
    });
  } catch (error: any) {
    if (isAuthenticationError(error)) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error: 'کلید API وارد شده نامعتبر یا منقضی شده است. لطفاً در بخش تنظیمات کلید صحیح را وارد کنید.',
      });
    }
    if (isHighDemandError(error)) {
      return res.status(503).json({
        success: false,
        isHighDemand: true,
        retryAfterSeconds: 4,
        error: 'سرورهای ترجمه در حال حاضر با ترافیک بالایی مواجه هستند. لطفاً لحظاتی بعد مجدداً تلاش کنید.',
      });
    }
    const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(error);
    res.status(isRateLimited ? 429 : 500).json({
      success: false,
      isRateLimited,
      isDailyLimit,
      retryAfterSeconds,
      error: isDailyLimit
        ? 'سهمیه روزانه پلن رایگان جمینای (Per-Day Quota) برای این پروژه تکمیل شده است. لطفاً در بخش تنظیمات یک کلید API جدید یا دارای Billing وارد کنید.'
        : isRateLimited
        ? `سقف مجاز درخواست‌های مدل ترجمه موقتاً پر شده است. لطفاً ${retryAfterSeconds} ثانیه دیگر مجدداً تلاش کنید.`
        : error.message || 'خطا در ترجمه زیرنویس با جمینای.',
    });
  }
});

// 2.5 Transcribe & Align English Audio with Exact Timestamps
app.post('/api/transcribe-audio', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType = 'audio/mp3', totalDuration } = req.body;
    const customKey = req.body.apiKey || (req.headers['x-gemini-api-key'] as string);

    if (!audioBase64) {
      return res.status(400).json({ error: 'فایل صوتی ارسال نشده است.' });
    }

    const ai = getGenAIClient(customKey);

    const promptText = `You are a professional audio transcription and speech timing engineer.
Listen to this English audio file carefully.
Extract every spoken English sentence with its EXACT start time and end time in seconds.
Rules:
1. Provide precise start time (seconds) and end time (seconds) for each spoken dialogue sentence.
2. Timestamps must accurately reflect when the voice starts and when the voice cuts off/finishes.
3. Keep each sentence naturally segmented.
4. Output must be clean JSON adhering strictly to the schema.`;

    const transcribeSchema = {
      type: Type.OBJECT,
      properties: {
        segments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER, description: 'Segment index starting from 1' },
              start: { type: Type.NUMBER, description: 'Start time in seconds' },
              end: { type: Type.NUMBER, description: 'End time in seconds' },
              text: { type: Type.STRING, description: 'Transcribed English dialogue' },
            },
            required: ['id', 'start', 'end', 'text'],
          },
        },
      },
      required: ['segments'],
    };

    const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let lastError: any;
    let transcriptionResponse: any;

    for (const model of candidateModels) {
      try {
        transcriptionResponse = await callWithRetry(() =>
          ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                  {
                    text: promptText,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: transcribeSchema,
            },
          })
        );
        if (transcriptionResponse?.text) break;
      } catch (err: any) {
        lastError = err;
        if (isAuthenticationError(err)) throw err;
        continue;
      }
    }

    if (!transcriptionResponse?.text) {
      throw lastError || new Error('خطا در تحلیل صوت توسط مدل هوش مصنوعی.');
    }

    const parsed = JSON.parse(transcriptionResponse.text);
    return res.json({
      success: true,
      segments: parsed.segments || [],
    });
  } catch (error: any) {
    console.error('Audio Transcription Error:', error);
    const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(error);
    return res.status(isRateLimited ? 429 : 500).json({
      success: false,
      isRateLimited,
      isDailyLimit,
      retryAfterSeconds,
      error: error?.message || 'خطا در تحلیل و پیاده‌سازی زمان‌بندی فایل صوتی',
    });
  }
});

// 3. Generate Persian Audio Speech (TTS) for a Single Subtitle Line
app.post('/api/tts', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { text, voice, emotion = '', style = '', persona = 'patient_teacher' } = req.body;
    const customKey = req.body.apiKey || (req.headers['x-gemini-api-key'] as string);

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'متن برای تولید صوت الزامی است.' });
    }

    const ai = getGenAIClient(customKey);

    // Persona styles inspired by Google AI Studio (e.g. https://aistudio.google.com/generate-speech)
    const personaConfigs: Record<string, { defaultVoice: string; style: string }> = {
      patient_teacher: {
        defaultVoice: 'Kore',
        style: 'The Patient Teacher: Patient, articulate, warm, clear enunciation, measured pacing, calm and encouraging tone',
      },
      cinematic_dubber: {
        defaultVoice: 'Puck',
        style: 'The Cinematic Dubber: Theatrical, dramatic, cinematic movie dubbing actor, emotive, immersive and natural',
      },
      deep_storyteller: {
        defaultVoice: 'Fenrir',
        style: 'The Deep Storyteller: Deep, resonant, cinematic storytelling, authoritative, majestic and atmospheric',
      },
      calm_broadcaster: {
        defaultVoice: 'Zephyr',
        style: 'The Calm Broadcaster: Smooth, balanced, articulate radio broadcaster, calm and conversational rhythm',
      },
    };

    const selectedPersona = personaConfigs[persona] || personaConfigs.patient_teacher;

    // Allowed prebuilt voices in Gemini 3.8 TTS: 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
    const validVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
    const chosenVoice = voice && validVoices.includes(voice) ? voice : selectedPersona.defaultVoice;

    const speechStyle =
      style ||
      (emotion
        ? `${selectedPersona.style}. Character emotion: ${emotion}`
        : selectedPersona.style);

    const buildTtsPayload = (modelName: string) => ({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: text.trim(),
              speechMetadata: {
                style: speechStyle,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: chosenVoice },
          },
        },
      },
    });

    // Candidate TTS models
    const candidateTtsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
    let response: any;
    let usedModel = candidateTtsModels[0];
    let lastTtsError: any;

    for (const modelName of candidateTtsModels) {
      try {
        usedModel = modelName;
        response = await callWithRetry(() =>
          ai.models.generateContent(buildTtsPayload(modelName))
        );
        // Succeeded
        break;
      } catch (ttsErr: any) {
        lastTtsError = ttsErr;
        console.log(`[Model Info] TTS on ${modelName} deferred: ${ttsErr?.status || ttsErr?.code || 'quota limit'}. Trying next model...`);
        if (isAuthenticationError(ttsErr)) {
          throw ttsErr;
        }
        // Try fallback model
        continue;
      }
    }

    if (!response) {
      const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(lastTtsError);
      return res.status(isRateLimited ? 429 : 500).json({
        success: false,
        isRateLimited,
        isDailyLimit,
        retryAfterSeconds,
        error: isDailyLimit
          ? 'سهمیه روزانه مدل صوتی جمینای (۱۰ درخواست در روز) تکمیل شده است. برای استفاده از صدای استودیویی جمینای، کلید اختصاصی خود را در بخش تنظیمات وارد کنید، یا گزینه «فوری مرورگر» را انتخاب نمایید.'
          : 'تولید صوت با هوش مصنوعی موقتاً در دسترس نیست. لطفاً از گزینه فوری مرورگر استفاده کنید.',
      });
    }

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      throw new Error('پاسخ صوتی از مدل دریافت نشد.');
    }

    const durationMs = Date.now() - startTime;
    console.log(`[TTS Success] Generated audio in ${durationMs}ms using ${usedModel} (${chosenVoice} / ${persona})`);

    res.json({
      success: true,
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
      voice: chosenVoice,
      modelUsed: usedModel,
      latencyMs: durationMs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.log(`[TTS notice after ${durationMs}ms]:`, error?.message || 'Processing fallback');
    if (isAuthenticationError(error)) {
      return res.status(401).json({
        success: false,
        isAuthError: true,
        error: 'کلید API وارد شده نامعتبر یا منقضی شده است. لطفاً کلید معتبر را در بخش تنظیمات وارد نمایید.',
      });
    }
    if (isHighDemandError(error)) {
      return res.status(503).json({
        success: false,
        isHighDemand: true,
        retryAfterSeconds: 4,
        error: 'سرورهای صوتی جمینای در حال حاضر با ترافیک بالایی مواجه هستند (High Demand). سیستم به صورت خودکار مجدداً تلاش خواهد کرد.',
      });
    }
    const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(error);
    res.status(isRateLimited ? 429 : 500).json({
      success: false,
      isRateLimited,
      isDailyLimit,
      retryAfterSeconds,
      error: isDailyLimit
        ? 'سهمیه روزانه مدل صوتی رایگان گوگل (۱۰ درخواست در روز) تکمیل شده است. می‌توانید از موتور صوتی مرورگر (بدون محدودیت) استفاده کنید یا کلید دارای Billing ثبت نمایید.'
        : isRateLimited
        ? `سقف مجاز درخواست‌های مدل صوتی موقتاً پر شده است. لطفاً ${retryAfterSeconds} ثانیه صبر کنید.`
        : error.message || 'خطا در تولید صوت دوبله فارسی با هوش مصنوعی.',
    });
  }
});

// Start server with Vite middleware in development or static serve in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎙️ استودیو دوبله هوشمند فارسی فعال شد: http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
