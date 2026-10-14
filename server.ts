import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Video to WAV extraction endpoint using FFmpeg (PCM 16-bit, 44100Hz, Stereo)
// Accepts raw video binary payload up to 300MB
app.post(
  '/api/convert-video-to-wav',
  express.raw({ type: () => true, limit: '300mb' }),
  async (req: Request, res: Response) => {
    const rawExt = typeof req.query.ext === 'string' ? req.query.ext.replace(/[^a-zA-Z0-9]/g, '') : 'mp4';
    const inputExt = rawExt || 'mp4';
    const tempId = `video_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const tempInputPath = path.join(os.tmpdir(), `${tempId}.${inputExt}`);
    const tempOutputPath = path.join(os.tmpdir(), `${tempId}.wav`);

    try {
      const fileBuffer = req.body;
      if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'فایل ویدیو دریافت نشد یا فرمت ارسالی خالی است.',
        });
      }

      await fs.promises.writeFile(tempInputPath, fileBuffer);

      // Determine FFmpeg binary location
      let ffmpegBin = 'ffmpeg';
      if (fs.existsSync('/usr/bin/ffmpeg')) {
        ffmpegBin = '/usr/bin/ffmpeg';
      }

      // Exact FFmpeg command as requested:
      // ffmpeg -i <input> -vn -acodec pcm_s16le -ar 44100 -ac 2 -y <output.wav>
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, [
          '-i',
          tempInputPath,
          '-vn',
          '-acodec',
          'pcm_s16le',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-y',
          tempOutputPath,
        ]);

        let stderr = '';
        proc.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            console.error('[FFmpeg Process Error Stderr]:', stderr);
            reject(new Error(`کد خطای FFmpeg (${code}): ${stderr.slice(-300)}`));
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`عدم امکان اجرای FFmpeg: ${err.message}`));
        });
      });

      if (!fs.existsSync(tempOutputPath)) {
        throw new Error('فایل خروجی صوتی WAV تولید نشد.');
      }

      const wavBuffer = await fs.promises.readFile(tempOutputPath);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="${tempId}.wav"`);
      res.send(wavBuffer);
    } catch (err: any) {
      console.error('[Video to WAV Error]:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'خطا در تبدیل ویدیو به صوت WAV با FFmpeg',
      });
    } finally {
      // Clean up temporary files
      try {
        if (fs.existsSync(tempInputPath)) await fs.promises.unlink(tempInputPath);
      } catch {}
      try {
        if (fs.existsSync(tempOutputPath)) await fs.promises.unlink(tempOutputPath);
      } catch {}
    }
  }
);

// Endpoint to extract embedded subtitle tracks (.srt) directly from video files via FFmpeg
app.post(
  '/api/extract-video-subtitles',
  express.raw({ type: ['video/*', 'application/octet-stream', 'multipart/form-data'], limit: '500mb' }),
  async (req: Request, res: Response) => {
    const tempId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const tempInputPath = path.join(os.tmpdir(), `${tempId}.video`);
    const tempOutputSrtPath = path.join(os.tmpdir(), `${tempId}.srt`);

    try {
      const fileBuffer = req.body;
      if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'فایل ویدیو دریافت نشد یا خالی است.',
        });
      }

      await fs.promises.writeFile(tempInputPath, fileBuffer);

      let ffmpegBin = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';
      let ffprobeBin = fs.existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : 'ffprobe';

      // 1. Probe for subtitle streams
      const probeResult = await new Promise<{ streams: any[] }>((resolve) => {
        const proc = spawn(ffprobeBin, [
          '-v', 'error',
          '-select_streams', 's',
          '-show_entries', 'stream=index,codec_name:stream_tags=language,title',
          '-of', 'json',
          tempInputPath
        ]);

        let stdout = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0 && stdout) {
            try {
              resolve(JSON.parse(stdout));
            } catch {
              resolve({ streams: [] });
            }
          } else {
            resolve({ streams: [] });
          }
        });
        proc.on('error', () => resolve({ streams: [] }));
      });

      const streams = probeResult.streams || [];
      if (streams.length === 0) {
        return res.json({
          success: false,
          reason: 'no_embedded_subs',
          message: 'هیچ ترک زیرنویس نهفته‌ای در این فایل ویدیویی یافت نشد. می‌توانید از هوش مصنوعی یا اسکریپت Whisper Large-v3 محلی برای استخراج زیرنویس استفاده نمایید.',
        });
      }

      // Find best match: English if available, or first subtitle stream
      let targetStreamIdx = 0;
      const engIdx = streams.findIndex((s) => {
        const lang = (s.tags?.language || '').toLowerCase();
        return lang === 'eng' || lang === 'en';
      });
      if (engIdx !== -1) {
        targetStreamIdx = engIdx;
      }

      // 2. Extract subtitle to SRT format
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, [
          '-i', tempInputPath,
          '-map', `0:s:${targetStreamIdx}`,
          '-c:s', 'srt',
          '-y',
          tempOutputSrtPath
        ]);

        let stderr = '';
        proc.stderr.on('data', (c) => { stderr += c.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`خطا در استخراج زیرنویس (${code}): ${stderr.slice(-200)}`));
        });
        proc.on('error', (err) => reject(new Error(`خطای اجرای FFmpeg: ${err.message}`)));
      });

      if (!fs.existsSync(tempOutputSrtPath)) {
        return res.json({
          success: false,
          reason: 'conversion_failed',
          message: 'استخراج ترک زیرنویس به فرمت SRT ناموفق بود.',
        });
      }

      const srtContent = await fs.promises.readFile(tempOutputSrtPath, 'utf-8');
      return res.json({
        success: true,
        srtText: srtContent,
        streamCount: streams.length,
        selectedStreamLanguage: streams[targetStreamIdx]?.tags?.language || 'نامشخص',
      });
    } catch (err: any) {
      console.error('[Extract Video Subtitles Error]:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'خطا در خواندن زیرنویس از ویدیو',
      });
    } finally {
      try {
        if (fs.existsSync(tempInputPath)) await fs.promises.unlink(tempInputPath);
      } catch {}
      try {
        if (fs.existsSync(tempOutputSrtPath)) await fs.promises.unlink(tempOutputSrtPath);
      } catch {}
    }
  }
);

// Helper to format seconds to SRT timestamp: 00:00:01,250
function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return (
    String(hrs).padStart(2, '0') +
    ':' +
    String(mins).padStart(2, '0') +
    ':' +
    String(secs).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  );
}

// Endpoint to automatically extract English subtitles (.srt) directly from video using FFmpeg audio extraction + Gemini Speech AI
app.post(
  '/api/transcribe-video-to-srt',
  express.raw({ type: ['video/*', 'audio/*', 'application/octet-stream', 'multipart/form-data'], limit: '500mb' }),
  async (req: Request, res: Response) => {
    const tempId = 'vid_stt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const tempInputVideo = path.join(os.tmpdir(), `${tempId}.video`);
    const tempAudioMp3 = path.join(os.tmpdir(), `${tempId}.mp3`);
    const customKey = (req.headers['x-gemini-api-key'] as string) || (req.query.apiKey as string);

    try {
      const fileBuffer = req.body;
      if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'فایل ویدیو دریافت نشد یا خالی است.',
        });
      }

      await fs.promises.writeFile(tempInputVideo, fileBuffer);

      let ffmpegBin = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';

      // 1. Extract audio stream to compact, high-clarity 16kHz mono MP3
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBin, [
          '-i', tempInputVideo,
          '-vn',
          '-acodec', 'libmp3lame',
          '-ar', '16000',
          '-ac', '1',
          '-b:a', '64k',
          '-y',
          tempAudioMp3,
        ]);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`خطا در استخراج صدای ویدیو با FFmpeg (${code}): ${stderr.slice(-200)}`));
        });
        proc.on('error', (err) => reject(new Error(`خطای اجرای FFmpeg: ${err.message}`)));
      });

      if (!fs.existsSync(tempAudioMp3)) {
        throw new Error('فایل صوتی استخراج شده تولید نشد.');
      }

      const audioBuffer = await fs.promises.readFile(tempAudioMp3);
      const audioBase64 = audioBuffer.toString('base64');

      // 2. Transcribe speech using Gemini Multimodal Audio Model
      const ai = getGenAIClient(customKey);

      const promptText = `You are a world-class speech-to-text and subtitle synchronization engine (equivalent to Whisper Large-v3 with high-resolution alignment).
Listen to the English spoken audio carefully.
Extract every spoken English sentence/dialogue with PRECISE start and end timestamps in seconds.
Requirements:
1. Provide accurate start time (seconds) and end time (seconds) for each dialogue line.
2. Segment sentences naturally (typically 2 to 7 seconds each) suitable for video subtitles and dubbing.
3. Transcribe exact spoken words without hallucination or omitting words.
4. Correct punctuation and capitalization for clean educational/instructional subtitles.
5. Strict JSON output adhering to the schema.`;

      const transcribeSchema = {
        type: Type.OBJECT,
        properties: {
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER, description: 'Segment index starting from 1' },
                start: { type: Type.NUMBER, description: 'Start time in seconds (e.g. 1.25)' },
                end: { type: Type.NUMBER, description: 'End time in seconds (e.g. 4.80)' },
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
                        mimeType: 'audio/mp3',
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
        throw lastError || new Error('مدل هوش مصنوعی پاسخی برای تبدیل گفتار ویدیو ارسال نکرد.');
      }

      const parsed = JSON.parse(transcriptionResponse.text);
      const rawSegments = parsed.segments || [];

      // Generate SRT text format & SubtitleItem array
      const subtitles = rawSegments.map((seg: any, idx: number) => {
        const id = idx + 1;
        const startSec = typeof seg.start === 'number' ? seg.start : 0;
        const endSec = typeof seg.end === 'number' ? Math.max(seg.end, startSec + 1) : startSec + 2;
        const startStr = formatSrtTimestamp(startSec);
        const endStr = formatSrtTimestamp(endSec);
        return {
          id,
          startTime: startStr,
          endTime: endStr,
          text: (seg.text || '').trim(),
          startSeconds: startSec,
          endSeconds: endSec,
        };
      });

      const srtBlocks = subtitles.map((s: any) => `${s.id}\n${s.startTime} --> ${s.endTime}\n${s.text}`).join('\n\n');

      return res.json({
        success: true,
        srtText: srtBlocks,
        subtitles,
        count: subtitles.length,
        notice: `زیرنویس انگلیسی با هوش مصنوعی و انطباق صوتی بالا استخراج شد (${subtitles.length} خط دیالوگ).`,
      });
    } catch (err: any) {
      console.error('[Transcribe Video to SRT Error]:', err);
      const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(err);
      return res.status(isRateLimited ? 429 : 500).json({
        success: false,
        isRateLimited,
        isDailyLimit,
        retryAfterSeconds,
        error: err.message || 'خطا در تبدیل ویدیوی ارسالی به زیرنویس با هوش مصنوعی',
      });
    } finally {
      try {
        if (fs.existsSync(tempInputVideo)) await fs.promises.unlink(tempInputVideo);
      } catch {}
      try {
        if (fs.existsSync(tempAudioMp3)) await fs.promises.unlink(tempAudioMp3);
      } catch {}
    }
  }
);

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

// Comprehensive fallback dictionary and colloquial speech generator
const FALLBACK_TRANSLATIONS: Record<string, string> = {
  'hey john, are you sure this is the right place?': 'هی جان، مطمئنی اینجا جای درسته؟',
  'trust me, sarah. the signal is coming directly from inside this room.': 'به من اعتماد کن سارا. سیگنال دقیقاً از داخل همین اتاق میاد.',
  "we don't have much time before the security guards arrive. let's hurry!": 'قبل از اینکه نگهبانا سر برسن وقت زیادی نداریم. زود باش عجله کن!',
  'look at that console! it seems like the entire system has been unlocked.': 'اون کنسول رو ببین! به نظر میاد کل سیستم قفلش باز شده.',
  "amazing work! download the secret files now and let's get out of here.": 'کارت حرف نداشت! فایل‌های محرمانه رو سریع دانلود کن تا از اینجا بزنیم به چاک.',
};

// Smart heuristic translator preserving technical computer terms and colloquial tone
function generateColloquialTranslation(rawText: string): string {
  const clean = (rawText || '').toLowerCase().trim();
  if (FALLBACK_TRANSLATIONS[clean]) {
    return FALLBACK_TRANSLATIONS[clean];
  }

  // Common colloquial spoken dubbing conversions for software tutorials and dialogues
  if (/welcome/i.test(rawText)) return 'خیلی خوش اومدین، با هم شروع می‌کنیم';
  if (/in this (video|lesson|course|chapter|part)/i.test(rawText)) return 'توی این ویدیو قصد داریم مباحث این بخش رو با هم بررسی کنیم';
  if (/magic method|dunder/i.test(rawText)) return 'توی پایتون مجیک متدها قابلیت‌های ویژه‌ای به کلاسمون اضافه می‌کنن';
  if (/let('s| us) (see|look|check|start)/i.test(rawText)) return 'بیاین با هم نگاهی به کد بندازیم و بررسی‌ش کنیم';
  if (/we are going to/i.test(rawText)) return 'قراره این بخش رو قدم به قدم با هم پیاده‌سازی کنیم';
  if (/how to (use|build|create|run)/i.test(rawText)) return 'توی این بخش نحوه راه‌اندازی و استفاده از این قابلیت رو می‌بینیم';
  if (/first(,| ) let('s| us)/i.test(rawText)) return 'اول از همه بیاین ساختار پروژه رو آماده کنیم';
  if (/as you can see/i.test(rawText)) return 'همون‌طور که اینجا مشاهده می‌کنید، خروجی کاملاً درسته';
  if (/now (we can|let's)/i.test(rawText)) return 'حالا می‌تونیم فانکشن و متد مورد نظرمون رو صدا بزنیم';
  if (/if you have any question/i.test(rawText)) return 'اگه هر سوالی براتون پیش اومد حتماً مطرح کنید';

  // Preserve technical programming terms with strict transliteration
  let text = (rawText || '')
    .replace(/\bmagic methods?\b/gi, 'مجیک متد')
    .replace(/\bdunder methods?\b/gi, 'داندر متد')
    .replace(/\bmethods?\b/gi, 'متد')
    .replace(/\bclasses?\b/gi, 'کلاس')
    .replace(/\bfunctions?\b/gi, 'فانکشن')
    .replace(/\bobjects?\b/gi, 'آبجکت')
    .replace(/\binstances?\b/gi, 'اینستنس')
    .replace(/\bconstructors?\b/gi, 'کانستراکتور')
    .replace(/\bvariables?\b/gi, 'متغیر')
    .replace(/\barrays?\b/gi, 'آرایه')
    .replace(/\bstrings?\b/gi, 'استرینگ')
    .replace(/\bloops?\b/gi, 'لوپ')
    .replace(/\bbugs?\b/gi, 'باگ')
    .replace(/\bdebug(ging)?\b/gi, 'دیباگ')
    .replace(/\bframeworks?\b/gi, 'فریم‌ورک')
    .replace(/\blibrar(y|ies)\b/gi, 'لایبرری')
    .replace(/\bpackages?\b/gi, 'پکیج')
    .replace(/\bapis?\b/gi, 'ای‌پی‌آی')
    .replace(/\bconsoles?\b/gi, 'کنسول')
    .replace(/\bterminals?\b/gi, 'ترمینال')
    .replace(/\bdatabases?\b/gi, 'دیتابیس')
    .replace(/\bqueries\b/gi, 'کوئری‌ها')
    .replace(/\bquery\b/gi, 'کوئری')
    .replace(/\bruntime\b/gi, 'ران‌تایم')
    .replace(/\bcompilers?\b/gi, 'کامپایلر')
    .replace(/\bsyntax\b/gi, 'سینتکس')
    .replace(/\bservers?\b/gi, 'سرور')
    .replace(/\bclients?\b/gi, 'کلاینت')
    .replace(/\bbackend\b/gi, 'بک‌اند')
    .replace(/\bfrontend\b/gi, 'فرانت‌اند');

  // If text is still primarily Latin, provide a natural Persian dialogue placeholder
  if (/^[a-zA-Z0-9\s,.'!?-]+$/.test(text)) {
    return `دیالوگ محاوره‌ای برای این بخش: ${text.slice(0, 40)}...`;
  }

  return text;
}

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
  const pingModels = ['gemini-3.8-flash', 'gemini-flash-latest'];
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
      continue;
    }
  }

  console.error('API Key Check Error:', lastError);
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

// 2. Translate English Subtitle Lines to Persian Dubbing Dialogue with High Speed & Semantic Clarity
app.post('/api/translate-subtitles', async (req: Request, res: Response) => {
  try {
    const { lines, style = 'colloquial', context = '' } = req.body;
    const customKey = req.body.apiKey || (req.headers['x-gemini-api-key'] as string);

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'هیچ خط زیرنویسی ارسال نشده است.' });
    }

    const ai = getGenAIClient(customKey);

    const styleInstructions: Record<string, string> = {
      colloquial: 'محاوره‌ای صمیمی، گفتاری و روان (دوبلاژ فیلم‌های رئال و ویدیوهای آموزشی با کلمات شکسته مانند: می‌ریم، ببین، قراره، انجام بدیم، اینه، چیه)',
      cinematic: 'سینمایی، استاندارد و محاوره‌ای فاخر با حس هنری بالا مناسب فیلم‌های درام و هالیوودی',
      formal: 'نیمه‌رسمی و دقیق مناسب فیلم‌های مستند و علمی، اما با روانی کامل و بدون جملات سنگین',
      energetic: 'پرهیجان، پرانرژی و اکشن مناسب برای انیمیشن‌ها و ویدیوهای آموزشی پرانرژی',
    };

    const selectedStyle = styleInstructions[style] || styleInstructions.colloquial;

    // Clean lines - without any word-count restrictions so translation is rich, natural, and crystal clear
    const simpleLines = lines.map((l: any) => ({
      id: l.id,
      text: (l.text || '').trim(),
    }));

    const buildPromptForLines = (subsetLines: Array<{ id: number; text: string }>) => `شما یک مدیر دوبلاژ و مترجم ارشد فیلم، سریال و ویدیوهای آموزشی تخصصی به زبان فارسی هستید.
وظیفه شما ترجمه کاملاً واضح، رسا، دقیق، خوش‌آهنگ، قابل فهم و غنی خطوط زیرنویس انگلیسی زیر به زبان فارسی محاوره‌ای برای دوبله است.

قوانین حیاتی ترجمه:
۱. روانی، وضوح و انتقال کامل معنا (Meaning & Clarity First):
معنا و مفهوم هر دیالوگ باید کاملاً شفاف، روان، رسا و بدون هیچ‌گونه ابهام منتقل شود. به هیچ عنوان کلمات یا معانی ضروری را حذف یا فدا نکنید. مخاطب فارسی‌زبان باید دقیقاً منظور گوینده را متوجه شود.

۲. حذف کامل محدودیت تعداد کلمات (No Word Count Restrictions):
هیچ‌گونه محدودیتی بر روی تعداد کلمات اعمال نکنید. نیازی به کوتاه کردن اجباری یا آسیب زدن به بار معنایی جمله نیست. اجازه دهید هر دیالوگ با جمله‌بندی کامل، طبیعی و روان دوبله فارسی بیان شود.

۳. لحن محاوره‌ای صمیمی دوبلاژ (Colloquial Persian Tone):
ترجمه باید با لحن گفتاری و صمیمی روزمره (دقیقاً مانند دوبله فارسی حرفه‌ای فیلم‌ها و ویدیوهای آموزشی) باشد. از افعال و کلمات شکسته و گفتاری استفاده کنید (مانند: می‌ریم، ببین، قراره، انجام بدیم، چیه، اینه، می‌خوایم، بیا، بریم سراغش). از جملات خشک، رسمی و کتابی اکیداً پرهیز کنید.

۴. حفظ دقیق اصطلاحات تخصصی کامپیوتر و برنامه‌نویسی (Technical IT Terms):
اصطلاحات تخصصی حوزه کامپیوتر، برنامه‌نویسی، هوش مصنوعی و نرم‌افزار را به هیچ وجه ترجمه لغوی نکنید! عین کلمه یا تلفظ رایج آن در جامعه برنامه‌نویسان را بنویسید:
- "magic method" یا "dunder method": اکیداً نباید «متد جادویی» ترجمه شود! بنویسید «مجیک متد» یا «داندر متد».
- method: بنویسید «متد» (اکیداً نه روش یا اسلوب!)
- class: بنویسید «کلاس»
- function: بنویسید «فانکشن» یا «تابع»
- object: بنویسید «آبجکت» (اکیداً نه شیء!)
- instance: بنویسید «اینستنس»
- constructor: بنویسید «کانستراکتور»
- loop: بنویسید «لوپ» یا «حلقه»
- array / string: بنویسید «آرایه» و «استرینگ»
- bug / debug: بنویسید «باگ» و «دیباگ»
- framework / library / package: بنویسید «فریم‌ورک»، «لایبرری»، «پکیج»
- API / endpoint: بنویسید «ای‌پی‌آی»، «اندپوینت»
- backend / frontend / fullstack: بنویسید «بک‌اند»، «فرانت‌اند»، «فول‌استک»
- compiler / runtime / code / script: بنویسید «کامپایلر»، «ران‌تایم»، «کد»، «اسکریپت»
- terminal / console / query / database: بنویسید «ترمینال»، «کنسول»، «کوئری»، «دیتابیس»
- cache / cookie / server / client: بنویسید «کش»، «کوکی»، «سرور»، «کلاینت»
- git / commit / push / pull / merge: بنویسید «گیت»، «کامیت»، «پوش»، «پول»، «مرج»
- hook / component / props / state: بنویسید «هوک»، «کامپوننت»، «پراپس»، «استیت»
- async / await / promise / thread: بنویسید «ای‌سینک»، «اوِیت»، «پرامیس»، «ترد»

۵. سبک انتخابی: ${selectedStyle}
${context ? `زمینه فیلم یا ویدیو: ${context}` : ''}

خطوط برای ترجمه:
${JSON.stringify(subsetLines, null, 2)}
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
              farsiText: { type: Type.STRING, description: 'ترجمه فارسی روان، واضح، کامل، رسا و خوش‌آهنگ' },
              characterEmotion: { type: Type.STRING, description: 'لحن و احساس پیشنهادی گوینده' },
              suggestedGender: { type: Type.STRING, description: 'جنسیت احتمالی گوینده (male یا female)' },
            },
            required: ['id', 'farsiText'],
          },
        },
      },
      required: ['translations'],
    };

    // Candidate models with multi-tier fallback: gemini-3.8-flash -> gemini-3.1-flash-lite -> gemini-flash-latest
    const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

    // Chunk large batches into sets of 20 to avoid payload timeouts and 503 capacity spikes
    const CHUNK_SIZE = 20;
    const allTranslations: Array<{ id: number; farsiText: string; characterEmotion?: string; suggestedGender?: string }> = [];

    for (let i = 0; i < simpleLines.length; i += CHUNK_SIZE) {
      const chunk = simpleLines.slice(i, i + CHUNK_SIZE);
      const promptText = buildPromptForLines(chunk);

      let chunkResponse: any = null;
      let chunkError: any = null;

      for (const modelName of candidateModels) {
        try {
          console.log(`[Fast Translate] Requesting ${modelName} for lines ${chunk[0].id}..${chunk[chunk.length - 1].id}...`);
          chunkResponse = await callWithRetry(
            () =>
              ai.models.generateContent({
                model: modelName,
                contents: promptText,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: translationSchema,
                  temperature: 0.3,
                },
              }),
            2, // Retries on 503 high demand
            1500 // 1.5s base delay
          );

          if (chunkResponse?.text) {
            const parsed = JSON.parse(chunkResponse.text || '{"translations": []}');
            if (Array.isArray(parsed.translations) && parsed.translations.length > 0) {
              allTranslations.push(...parsed.translations);
              chunkResponse = true;
              break;
            }
          }
        } catch (modelErr: any) {
          chunkError = modelErr;
          console.warn(`[Model Info] Translation on ${modelName} deferred. Trying next model...`, modelErr?.message || modelErr);
          if (isAuthenticationError(modelErr)) {
            throw modelErr;
          }
          continue;
        }
      }

      if (!chunkResponse) {
        throw chunkError || new Error('خطا در ترجمه خطوط با تمام مدل‌های هوش مصنوعی.');
      }
    }

    return res.json({
      success: true,
      translations: allTranslations,
    });
  } catch (error: any) {
    console.error('Translation error encountered:', error?.message);
    const isAuth = isAuthenticationError(error);
    const isHighDemand = isHighDemandError(error);
    const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(error);

    const errorMessage = isAuth
      ? 'کلید API وارد شده نامعتبر است یا هنوز تنظیم نشده است. لطفاً کلید معتبر خود را وارد نمایید.'
      : isHighDemand
      ? 'سرورهای هوش مصنوعی گوگل (Gemini 503) در این لحظه ترافیک سنگین دارند. این وضعیت موقتی است؛ لطفاً چند ثانیه دیگر دکمه تلاش مجدد را بزنید.'
      : isDailyLimit
      ? 'سهمیه روزانه کلید API شما به اتمام رسیده است. لطفاً از کلید دیگری استفاده نمایید.'
      : isRateLimited
      ? `محدودیت تعداد درخواست در دقیقه (Rate Limit). لطفاً ${retryAfterSeconds} ثانیه دیگر مجدداً امتحان کنید.`
      : error?.message || 'خطا در ارتباط با سرویس ترجمه هوش مصنوعی.';

    return res.status(isAuth ? 401 : isHighDemand ? 503 : isRateLimited ? 429 : 500).json({
      success: false,
      error: errorMessage,
      isAuthError: isAuth,
      isHighDemand,
      isRateLimited,
      retryAfterSeconds,
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

    // Persona styles customized specifically for top-tier Online Educational Courses (4 Male, 2 Female)
    // Enforces pedagogical clarity, crisp pronunciation of technical terms, and completely eliminates theatrical or radio tones.
    const personaConfigs: Record<string, { defaultVoice: string; style: string }> = {
      iapetus_online_instructor: {
        defaultVoice: 'Iapetus',
        style: 'Top-tier tech course instructor, masculine, authoritative yet conversational, precise enunciation of code and technical terms, measured pacing, confident pedagogical delivery, engaging and never theatrical or radio broadcaster style',
      },
      fenrir_senior_mentor: {
        defaultVoice: 'Fenrir',
        style: 'Senior online mentor, warm masculine tone, patient and thorough explanation, steady teaching cadence, friendly guidance, crystal-clear pronunciation, pedagogical focus',
      },
      charon_academic_lecturer: {
        defaultVoice: 'Charon',
        style: 'Deep analytical professor, masculine, clear articulation, intellectual depth, structured lecture rhythm, calm enunciation, focused purely on educational clarity and teaching mastery',
      },
      puck_interactive_coach: {
        defaultVoice: 'Puck',
        style: 'Dynamic interactive boot-camp instructor, masculine, clear enthusiastic delivery, conversational teaching style, crisp pronunciation, engaging educator without being cinematic or dramatic',
      },
      kore_master_educator: {
        defaultVoice: 'Kore',
        style: 'Master educator, warm feminine voice, patient, clear enunciation, gentle encouragement, natural pedagogical rhythm, articulate explanation of complex educational topics',
      },
      zephyr_methodology_trainer: {
        defaultVoice: 'Zephyr',
        style: 'Modern online course trainer, smooth feminine voice, articulate cadence, clear vocal inflection, clean pronunciation of terminology, balanced tempo, purely educational delivery',
      },
    };

    const selectedPersona =
      personaConfigs[persona] ||
      personaConfigs.iapetus_online_instructor;

    // Allowed prebuilt voices in Gemini 3.8 TTS: 'Iapetus', 'Fenrir', 'Charon', 'Puck', 'Kore', 'Zephyr'
    const validVoices = ['Iapetus', 'Fenrir', 'Charon', 'Puck', 'Kore', 'Zephyr'];
    const chosenVoice = voice && validVoices.includes(voice) ? voice : selectedPersona.defaultVoice;

    const speechStyle =
      style ||
      (emotion
        ? `${selectedPersona.style}. Teaching emphasis: ${emotion}`
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
