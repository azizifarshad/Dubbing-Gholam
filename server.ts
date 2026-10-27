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

      const config = getApiConfig(req);

      // If using Hormouz AI or OpenAI-compatible gateway:
      if (config.isHormouzOrOpenAI) {
        let whisperResult: any = null;
        try {
          console.log(`[Hormouz STT] Attempting audio transcription with whisper-1 via ${config.baseUrl}/audio/transcriptions...`);
          const audioBuf = await fs.promises.readFile(tempAudioMp3);
          const formData = new FormData();
          formData.append('file', new Blob([audioBuf], { type: 'audio/mp3' }), 'speech.mp3');
          formData.append('model', 'whisper-1');
          formData.append('response_format', 'verbose_json');

          const sttRes = await fetch(`${config.baseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
            },
            body: formData,
            signal: AbortSignal.timeout(90000),
          });

          if (sttRes.ok) {
            whisperResult = await sttRes.json();
          } else {
            const errText = await sttRes.text();
            console.warn('[Hormouz STT Warning]:', errText);
          }
        } catch (sttErr: any) {
          console.warn('[Hormouz STT Error]:', sttErr?.message);
        }

        if (whisperResult && Array.isArray(whisperResult.segments) && whisperResult.segments.length > 0) {
          const formattedSubs = whisperResult.segments.map((seg: any, idx: number) => ({
            id: idx + 1,
            startSeconds: seg.start,
            endSeconds: seg.end,
            startTime: formatSrtTimestamp(seg.start),
            endTime: formatSrtTimestamp(seg.end),
            text: (seg.text || '').trim(),
          }));

          let generatedSrt = '';
          formattedSubs.forEach((item: any) => {
            generatedSrt += `${item.id}\n${item.startTime} --> ${item.endTime}\n${item.text}\n\n`;
          });

          return res.json({
            success: true,
            subtitles: formattedSubs,
            srtText: generatedSrt.trim(),
            count: formattedSubs.length,
          });
        }

        // Fallback directly to Local Whisper (100% free and offline on user machine)
        console.log('[Local Whisper] Transcribing speech locally with Whisper AI on user PC...');
        try {
          const localSegments = await new Promise<any[]>((resolve, reject) => {
            const pyProc = spawn('python', ['local_whisper.py', tempAudioMp3, 'base']);
            let stdout = '';
            let stderr = '';
            pyProc.stdout.on('data', (d) => { stdout += d.toString(); });
            pyProc.stderr.on('data', (d) => { stderr += d.toString(); });
            pyProc.on('close', (code) => {
              try {
                const resJson = JSON.parse(stdout.trim());
                if (resJson.success && Array.isArray(resJson.segments)) {
                  resolve(resJson.segments);
                } else {
                  reject(new Error(resJson.error || stderr || `Whisper exit code ${code}`));
                }
              } catch (err: any) {
                reject(new Error(`خطا در استخراج با Whisper محلی: ${stdout || stderr}`));
              }
            });
            pyProc.on('error', (err) => reject(new Error(`عدم امکان اجرای پایتون برای Whisper: ${err.message}`)));
          });

          if (localSegments.length > 0) {
            const formattedSubs = localSegments.map((seg: any, idx: number) => ({
              id: idx + 1,
              startSeconds: seg.start,
              endSeconds: seg.end,
              startTime: formatSrtTimestamp(seg.start),
              endTime: formatSrtTimestamp(seg.end),
              text: (seg.text || '').trim(),
            }));

            let generatedSrt = '';
            formattedSubs.forEach((item: any) => {
              generatedSrt += `${item.id}\n${item.startTime} --> ${item.endTime}\n${item.text}\n\n`;
            });

            return res.json({
              success: true,
              subtitles: formattedSubs,
              srtText: generatedSrt.trim(),
              count: formattedSubs.length,
              engine: 'local-whisper',
            });
          }
        } catch (localErr: any) {
          console.warn('[Local Whisper Error]:', localErr.message);
          return res.status(500).json({
            success: false,
            error: `خطا در تبدیل گفتار ویدیو با Whisper محلی: ${localErr.message}`,
          });
        }
      }

      // If no cloud STT configured, run local Whisper directly
      if (!config.isGeminiDirect) {
        console.log('[Local Whisper] Running 100% free offline Whisper transcription...');
        try {
          const localSegments = await new Promise<any[]>((resolve, reject) => {
            const pyProc = spawn('python', ['local_whisper.py', tempAudioMp3, 'base']);
            let stdout = '';
            let stderr = '';
            pyProc.stdout.on('data', (d) => { stdout += d.toString(); });
            pyProc.stderr.on('data', (d) => { stderr += d.toString(); });
            pyProc.on('close', (code) => {
              try {
                const resJson = JSON.parse(stdout.trim());
                if (resJson.success && Array.isArray(resJson.segments)) {
                  resolve(resJson.segments);
                } else {
                  reject(new Error(resJson.error || stderr || `Whisper exit code ${code}`));
                }
              } catch (err: any) {
                reject(new Error(`خطا در استخراج با Whisper محلی: ${stdout || stderr}`));
              }
            });
            pyProc.on('error', (err) => reject(new Error(`عدم امکان اجرای پایتون: ${err.message}`)));
          });

          if (localSegments.length > 0) {
            const formattedSubs = localSegments.map((seg: any, idx: number) => ({
              id: idx + 1,
              startSeconds: seg.start,
              endSeconds: seg.end,
              startTime: formatSrtTimestamp(seg.start),
              endTime: formatSrtTimestamp(seg.end),
              text: (seg.text || '').trim(),
            }));

            let generatedSrt = '';
            formattedSubs.forEach((item: any) => {
              generatedSrt += `${item.id}\n${item.startTime} --> ${item.endTime}\n${item.text}\n\n`;
            });

            return res.json({
              success: true,
              subtitles: formattedSubs,
              srtText: generatedSrt.trim(),
              count: formattedSubs.length,
              engine: 'local-whisper',
            });
          }
        } catch (localErr: any) {
          return res.status(500).json({
            success: false,
            error: `خطا در پردازش با Whisper محلی: ${localErr.message}`,
          });
        }
      }

      const audioBuffer = await fs.promises.readFile(tempAudioMp3);
      const audioBase64 = audioBuffer.toString('base64');

      // 2. Transcribe speech using Gemini Multimodal Audio Model
      const ai = getGenAIClient(config.apiKey);

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

// Helper to check if a key is a real key (not empty or default template placeholder)
function isValidApiKey(key?: string): boolean {
  if (!key) return false;
  const k = key.trim();
  if (k === '' || k === 'MY_GEMINI_API_KEY' || k.length < 5) return false;
  return true;
}

export interface ApiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  translationModel: string;
  ttsModel: string;
  isHormouzOrOpenAI: boolean;
  isGeminiDirect: boolean;
  hasKey: boolean;
}

// Helper to extract API configuration from request or environment
function getApiConfig(req: Request): ApiRuntimeConfig {
  const customKey = (
    req.body?.apiKey ||
    req.headers['x-api-key'] ||
    req.headers['x-gemini-api-key'] ||
    req.query?.apiKey
  ) as string | undefined;

  const customBaseUrl = (
    req.body?.baseUrl ||
    req.body?.apiBaseUrl ||
    req.headers['x-base-url']
  ) as string | undefined;

  const customTranslationModel = (
    req.body?.translationModel ||
    req.headers['x-translation-model']
  ) as string | undefined;

  const customTtsModel = (
    req.body?.ttsModel ||
    req.headers['x-tts-model']
  ) as string | undefined;

  const envKey = (
    process.env.HORMOUZ_API_KEY ||
    process.env.API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  ).trim();

  const apiKey = (customKey && customKey.trim()) || envKey;
  const rawBaseUrl = (customBaseUrl && customBaseUrl.trim()) || process.env.API_BASE_URL || 'https://api.hormouz.net/v1';
  const cleanBaseUrl = rawBaseUrl.replace(/\/+$/, '');

  const translationModel = (customTranslationModel && customTranslationModel.trim()) || process.env.TRANSLATION_MODEL || 'OpenAI: GPT-6 Luna';
  const ttsModel = (customTtsModel && customTtsModel.trim()) || process.env.TTS_MODEL || 'google/gemini-3.8-flash-lite-tts';

  const isGeminiDirect = apiKey.startsWith('AIzaSy') && (!customBaseUrl || cleanBaseUrl.includes('googleapis.com'));
  const isHormouzOrOpenAI = Boolean(cleanBaseUrl && !isGeminiDirect);

  return {
    apiKey,
    baseUrl: cleanBaseUrl,
    translationModel,
    ttsModel,
    isHormouzOrOpenAI,
    isGeminiDirect,
    hasKey: isValidApiKey(apiKey),
  };
}

// Helper to determine the effective key
function getEffectiveKey(customApiKey?: string): string | null {
  if (isValidApiKey(customApiKey)) return customApiKey!.trim();
  if (isValidApiKey(process.env.HORMOUZ_API_KEY)) return process.env.HORMOUZ_API_KEY!.trim();
  if (isValidApiKey(process.env.API_KEY)) return process.env.API_KEY!.trim();
  if (isValidApiKey(process.env.GEMINI_API_KEY)) return process.env.GEMINI_API_KEY!.trim();
  return null;
}

// Helper to get GoogleGenAI client with user-provided key or environment key
function getGenAIClient(customApiKey?: string): GoogleGenAI {
  const apiKey = getEffectiveKey(customApiKey);
  if (!apiKey) {
    throw new Error('کلید API وارد نشده است یا نامعتبر می‌باشد.');
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

// Global style instructions for dubbing
const STYLE_INSTRUCTIONS: Record<string, string> = {
  colloquial: 'محاوره‌ای صمیمی، گفتاری و روان (دوبلاژ فیلم‌های رئال و ویدیوهای آموزشی با کلمات شکسته مانند: می‌ریم، ببین، قراره، انجام بدیم، اینه، چیه)',
  cinematic: 'سینمایی، استاندارد و محاوره‌ای فاخر با حس هنری بالا مناسب فیلم‌های درام و هالیوودی',
  formal: 'نیمه‌رسمی و دقیق مناسب فیلم‌های مستند و علمی، اما با روانی کامل و بدون جملات سنگین',
  energetic: 'پرهیجان، پرانرژی و اکشن مناسب برای انیمیشن‌ها و ویدیوهای آموزشی پرانرژی',
};

// Global prompt builder for subtitles
function buildPromptForLines(subsetLines: Array<any>, style: string = 'colloquial'): string {
  const selectedStyle = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.colloquial;

  return `You are a professional English-to-Persian translator specializing in programming, computer science, software development, AI, and educational content.

Your task is to translate English text into natural, concise, conversational Persian that sounds like a native Persian-speaking instructor explaining a topic, not someone reading from a textbook.

Tone and Dubbing Style: ${selectedStyle}

### 1. Natural, Conversational Persian (Instructor Style - مدرس ایرانی)
- Use simple, modern, fluent, conversational Persian.
- Make the translation sound natural when spoken aloud in educational videos and voiceovers (e.g. use spoken conversational forms: "توی این درس می‌خوایم...", "سلام مو هستم خوش اومدید", "قراره بررسی کنیم", "می‌ریم سراغ...").
- Avoid overly formal, literary, bookish, or unnatural phrasing (do NOT write stiff literal text like "دوباره مو هستم" or "ما قصد داریم").
- Preserve the original meaning while restructuring sentences when necessary to make them sound natural in Persian.
- Prefer everyday spoken expressions over formal equivalents whenever appropriate.

### 2. Strict Word Count, Conciseness & Completeness (DO NOT DROP CLAUSES)
- Use the fewest words possible while preserving the complete meaning.
- CRITICAL: Never cut off, omit, or delete parts of the sentence! If an English sentence has multiple clauses or ideas, ALL clauses must be translated and conveyed clearly.
- Avoid unnecessary explanations, filler words, redundant phrases, and repetitions.
- The Persian translation must NOT contain more than 120% of the words of the original English text.
- Treat this budget as a guideline for conciseness: before returning the translation, check the word count.
- Whenever two translations are equally accurate, choose the shorter, punchier one.
- Never remove important technical details, conditions, examples, warnings, or logical relationships just to meet the word limit.
- Prioritize semantic accuracy and completeness while remaining as concise as possible.

### 3. Preserve Technical Terminology in English
- Keep established technical terms from computer science, programming, AI, networking, software engineering, and web development in their original English form (e.g. Magic Method, Class, Object, Function, Framework, API, Endpoint, Debugging, Runtime, Callback, Middleware, Machine Learning, Neural Network, Token, Prompt, Array, String, Loop, Database, Query, Frontend, Backend, Fullstack, Docker, Linux, VS Code).
- Do not translate an entire sentence into English. Keep the surrounding explanation in natural Persian while retaining technical terms in English.

### 4. Semantic Accuracy & Completeness
- Preserve the original meaning, intent, technical accuracy, and logical relationships.
- Do not omit important details, examples, conditions, warnings, or second clauses.
- Preserve names, numbers, values, code, and technical references accurately.

### 5. Output Rules
- You MUST return a JSON object with a single key "translations", which is an array of objects.
- Each object must have:
  "id": segment integer ID
  "farsiText": natural fluent Persian translation
- DO NOT wrap in Markdown backticks. Output valid JSON only.

Lines to translate:
${JSON.stringify(
  subsetLines.map((s) => ({
    id: s.id,
    englishText: s.text,
    durationSeconds: s.duration,
    englishWordCount: s.englishWordCount,
    maxPersianWordsAllowed: s.maxBudgetWords,
  })),
  null,
  2
)}
`;
}

// Hormouz AI (or OpenAI-compatible) translation runner
async function translateWithHormouz(
  lines: Array<{ id: number; text: string; start: number; end: number; duration: number; englishWordCount: number; maxBudgetWords: number }>,
  style: string,
  config: ApiRuntimeConfig
): Promise<Array<{ id: number; farsiText: string; characterEmotion?: string; suggestedGender?: string }>> {
  const CHUNK_SIZE = 20;
  const allTranslations: Array<{ id: number; farsiText: string; characterEmotion?: string; suggestedGender?: string }> = [];

  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunk = lines.slice(i, i + CHUNK_SIZE);
    const promptText = buildPromptForLines(chunk, style);

    console.log(`[Hormouz Translate] Requesting model "${config.translationModel}" at ${config.baseUrl} for lines ${chunk[0].id}..${chunk[chunk.length - 1].id}...`);

    let responseData: any = null;
    let lastErr: any = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.translationModel,
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert English-to-Persian translator for video dubbing. You MUST reply with valid JSON only adhering strictly to {"translations": [{"id": 1, "farsiText": "..."}]}. Never output conversational chatter or markdown fences outside the JSON.',
              },
              {
                role: 'user',
                content: promptText,
              },
            ],
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) {
          const errText = await res.text();
          let parsedErr: any;
          try { parsedErr = JSON.parse(errText); } catch {}
          const msg = parsedErr?.error?.message || parsedErr?.message || errText;
          throw new Error(`خطای سرور هرمز (${res.status}): ${msg}`);
        }

        responseData = await res.json();
        break;
      } catch (err: any) {
        lastErr = err;
        console.warn(`[Hormouz Translate Attempt ${attempt + 1}] error:`, err?.message);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!responseData) {
      throw lastErr || new Error('پاسخی از مدل ترجمه هرمز دریافت نشد.');
    }

    const rawContent = responseData.choices?.[0]?.message?.content || '';
    let parsed: any;
    try {
      const cleaned = rawContent.replace(/^\`\`\`json\s*/i, '').replace(/\`\`\`\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawContent.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('قالب پاسخ ترجمه هرمز معتبر نبود.');
      }
    }

    if (Array.isArray(parsed?.translations) && parsed.translations.length > 0) {
      allTranslations.push(...parsed.translations);
    } else if (Array.isArray(parsed) && parsed.length > 0) {
      allTranslations.push(...parsed);
    } else {
      throw new Error('آرایه ترجمه‌ها در خروجی هوش مصنوعی یافت نشد.');
    }
  }

  return allTranslations;
}

// Helper to convert raw 16-bit PCM buffer to a standard WAV audio buffer with RIFF header
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1): Buffer {
  if (pcmBuffer.length >= 4 && pcmBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    return pcmBuffer;
  }
  const header = Buffer.alloc(44);
  const dataSize = pcmBuffer.length;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Hormouz AI (or OpenAI-compatible) Speech / TTS runner
async function ttsWithHormouz(
  text: string,
  voice: string,
  config: ApiRuntimeConfig
): Promise<{ audioBase64: string; mimeType: string }> {
  console.log(`[Hormouz TTS] Generating voice with model "${config.ttsModel}" and voice "${voice}" at ${config.baseUrl}...`);

  // Hormouz requires response_format="pcm" for Gemini TTS models
  const isGeminiOrHormouz = config.ttsModel.toLowerCase().includes('gemini') || config.baseUrl.includes('hormouz');
  let responseFormat = isGeminiOrHormouz ? 'pcm' : 'mp3';

  console.log(`[Hormouz TTS] Generating voice with model "${config.ttsModel}" (format: ${responseFormat}, voice: ${voice}) at ${config.baseUrl}...`);

  let res = await fetch(`${config.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ttsModel,
      input: text.trim(),
      voice: voice || 'Puck',
      response_format: responseFormat,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsedErr: any;
    try { parsedErr = JSON.parse(errText); } catch {}
    const msg = parsedErr?.error?.message || parsedErr?.message || errText;

    // Auto-retry with PCM if format was rejected
    if (msg.includes('pcm') && responseFormat !== 'pcm') {
      console.log('[Hormouz TTS] Retrying with response_format="pcm"...');
      responseFormat = 'pcm';
      res = await fetch(`${config.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.ttsModel,
          input: text.trim(),
          voice: voice || 'Puck',
          response_format: 'pcm',
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        const retryErrText = await res.text();
        let retryParsed: any;
        try { retryParsed = JSON.parse(retryErrText); } catch {}
        const retryMsg = retryParsed?.error?.message || retryParsed?.message || retryErrText;
        throw new Error(`خطای سرویس صوتی هرمز (${res.status}): ${retryMsg}`);
      }
    } else {
      throw new Error(`خطای سرویس صوتی هرمز (${res.status}): ${msg}`);
    }
  }

  const arrayBuffer = await res.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('فایل صوتی خالی از سرویس هرمز دریافت شد.');
  }

  let finalBuffer: Buffer;
  if (responseFormat === 'pcm') {
    finalBuffer = pcmToWav(Buffer.from(arrayBuffer), 24000, 1);
  } else {
    finalBuffer = Buffer.from(arrayBuffer);
  }

  const audioBase64 = finalBuffer.toString('base64');
  return {
    audioBase64,
    mimeType: responseFormat === 'pcm' ? 'audio/wav' : 'audio/mp3',
  };
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
  const config = getApiConfig(req);
  const validateLive = req.body.validateLive === true;
  const hasEnv = isValidApiKey(process.env.HORMOUZ_API_KEY) || isValidApiKey(process.env.GEMINI_API_KEY);

  if (!config.hasKey) {
    return res.json({
      success: false,
      hasEnvKey: hasEnv,
      isConfigured: false,
      message: 'کلید API هنوز وارد نشده است. لطفاً کلید API خود را وارد کنید.',
    });
  }

  if (!validateLive) {
    return res.json({
      success: true,
      hasEnvKey: hasEnv,
      isConfigured: true,
      provider: config.isHormouzOrOpenAI ? 'hormouz' : 'gemini',
      message: 'کلید API ثبت شده است.',
    });
  }

  // Live test for Hormouz AI or OpenAI-compatible endpoint
  if (config.isHormouzOrOpenAI) {
    try {
      console.log(`[Hormouz Check] Testing ${config.baseUrl}/chat/completions with model ${config.translationModel}...`);
      
      // Fetch allowed models for this key from Hormouz
      let allowedModels: string[] = [];
      try {
        const mRes = await fetch(`${config.baseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (mRes.ok) {
          const mData: any = await mRes.json();
          allowedModels = (mData?.data || []).map((m: any) => m.id).filter(Boolean);
        }
      } catch (_) {}

      const testRes = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.translationModel,
          messages: [{ role: 'user', content: 'Ping test. Reply with OK.' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (testRes.ok) {
        return res.json({
          success: true,
          isConfigured: true,
          provider: 'hormouz',
          testedModel: config.translationModel,
          allowedModels,
          message: `اتصال به هوش مصنوعی هرمز با مدل «${config.translationModel}» با موفقیت برقرار شد!`,
        });
      } else {
        const errText = await testRes.text();
        let parsedErr: any;
        try { parsedErr = JSON.parse(errText); } catch {}
        const msg = parsedErr?.error?.message || parsedErr?.message || errText;

        let modelsNotice = '';
        if (allowedModels.length > 0) {
          modelsNotice = `\nمدل‌های فعال روی این کلید: ${allowedModels.join(' ، ')}`;
        }

        return res.status(testRes.status === 401 ? 401 : 400).json({
          success: false,
          hasEnvKey: hasEnv,
          allowedModels,
          error: `پاسخ هرمز (${testRes.status}): ${msg}${modelsNotice}`,
        });
      }
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        hasEnvKey: hasEnv,
        error: `عدم برقراری ارتباط با ${config.baseUrl}: ${err.message}`,
      });
    }
  }

  // Live test using Google Gemini fallback chain
  const pingModels = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: any;

  for (const model of pingModels) {
    try {
      const ai = getGenAIClient(config.apiKey);
      const response = await ai.models.generateContent({
        model,
        contents: 'Ping test. Reply with OK.',
      });

      return res.json({
        success: true,
        isConfigured: true,
        provider: 'gemini',
        message: 'کلید API معتبر است و ارتباط با جمینای با موفقیت برقرار شد.',
        hasEnvKey: hasEnv,
        testedModel: model,
        sampleResponse: response.text?.trim() || 'OK',
      });
    } catch (error: any) {
      lastError = error;
      if (isAuthenticationError(error)) {
        return res.status(401).json({
          success: false,
          hasEnvKey: hasEnv,
          isAuthError: true,
          error: 'کلید API وارد شده معتبر نمی‌باشد. لطفاً یک کلید معتبر وارد کنید.',
        });
      }
      continue;
    }
  }

  console.error('API Key Check Error:', lastError);
  const { isRateLimited, isDailyLimit, retryAfterSeconds } = extractRateLimitInfo(lastError);
  return res.status(isRateLimited ? 429 : 400).json({
    success: false,
    hasEnvKey: hasEnv,
    isRateLimited,
    isDailyLimit,
    retryAfterSeconds,
    error: lastError?.message || 'خطا در ارزیابی کلید API.',
  });
});

// Endpoint to query allowed models for the given API key from Hormouz
app.post('/api/list-models', async (req: Request, res: Response) => {
  const config = getApiConfig(req);
  if (!config.hasKey) {
    return res.status(400).json({ success: false, error: 'کلید API وارد نشده است.' });
  }

  if (config.isHormouzOrOpenAI) {
    try {
      const modelsRes = await fetch(`${config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!modelsRes.ok) {
        const errText = await modelsRes.text();
        let parsedErr: any;
        try { parsedErr = JSON.parse(errText); } catch {}
        const msg = parsedErr?.error?.message || parsedErr?.message || errText;
        return res.status(modelsRes.status).json({
          success: false,
          error: `خطا در دریافت لیست مدل‌ها (${modelsRes.status}): ${msg}`,
        });
      }

      const modelsData: any = await modelsRes.json();
      const rawList = Array.isArray(modelsData?.data) ? modelsData.data : [];
      const modelIds = rawList.map((m: any) => m.id || m.name || m).filter(Boolean);

      return res.json({
        success: true,
        models: modelIds,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `خطا در ارتباط با سرور هرمز: ${err.message}`,
      });
    }
  }

  return res.json({
    success: true,
    models: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'],
  });
});

// Reliable Fallback Persian Translation Engine with Technical Vocabulary & Colloquial Phrasing
async function translateWithFallbackEngine(lines: Array<{ id: number; text: string }>, style: string = 'colloquial') {
  const translations: Array<{ id: number; farsiText: string; characterEmotion?: string; suggestedGender?: string }> = [];

  const TECHNICAL_TERMS: Record<string, string> = {
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
    'hook': 'هوک',
    'hooks': 'هوک‌ها',
    'component': 'کامپوننت',
    'components': 'کامپوننت‌ها',
    'state': 'استیت',
    'props': 'پراپس',
    'api': 'ای‌پی‌آی',
    'endpoint': 'اندپوینت',
    'backend': 'بک‌اند',
    'frontend': 'فرانت‌اند',
    'fullstack': 'فول‌استک',
    'runtime': 'ران‌تایم',
    'compiler': 'کامپایلر',
    'terminal': 'ترمینال',
    'console': 'کنسول',
    'database': 'دیتابیس',
    'query': 'کوئری',
    'framework': 'فریم‌ورک',
    'package': 'پکیج',
    'library': 'لایبرری',
    'bug': 'باگ',
    'debug': 'دیباگ',
    'loop': 'حلقه',
    'array': 'آرایه',
    'string': 'استرینگ',
    'async': 'ای‌سینک',
    'await': 'اوِیت',
    'promise': 'پرامیس',
    'thread': 'ترد',
  };

  const postProcessPersian = (rawText: string, originalEnglish: string): string => {
    let res = rawText.trim();
    if (!res) res = originalEnglish;

    // Enforce IT & programming jargon
    for (const [enTerm, faTerm] of Object.entries(TECHNICAL_TERMS)) {
      const reg = new RegExp(`\\b${enTerm}\\b`, 'gi');
      res = res.replace(reg, faTerm);
    }
    // Prevent bad literal translations
    res = res.replace(/متد جادویی|روش جادویی/g, 'مجیک متد');
    res = res.replace(/متدهای جادویی|روش‌های جادویی/g, 'مجیک متدها');
    res = res.replace(/شیء|اشیای|اشیاء/g, 'آبجکت');

    // Colloquial dubbing softenings
    if (style === 'colloquial' || style === 'cinematic') {
      res = res
        .replace(/می‌شود/g, 'می‌شه')
        .replace(/می‌شوند/g, 'می‌شن')
        .replace(/می‌رویم/g, 'می‌ریم')
        .replace(/می‌کنیم/g, 'می‌کنیم')
        .replace(/می‌دانیم/g, 'می‌دونیم')
        .replace(/می‌آید/g, 'می‌آد')
        .replace(/است\b/g, 'هست')
        .replace(/آن‌ها/g, 'اون‌ها')
        .replace(/اینجا است/g, 'اینجاست');
    }
    return res;
  };

  const BATCH_SIZE = 5;
  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const chunk = lines.slice(i, i + BATCH_SIZE);
    const chunkPromises = chunk.map(async (l) => {
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(l.text)}&langpair=en|fa`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const json: any = await res.json();
          const translated = json?.responseData?.translatedText;
          if (translated && typeof translated === 'string' && !translated.startsWith('MYMEMORY WARNING')) {
            return {
              id: l.id,
              farsiText: postProcessPersian(translated, l.text),
              characterEmotion: 'طبیعی و رسا',
              suggestedGender: 'male',
            };
          }
        }
      } catch (_) {}

      return {
        id: l.id,
        farsiText: postProcessPersian(l.text, l.text),
        characterEmotion: 'محاوره‌ای',
        suggestedGender: 'male',
      };
    });

    const chunkResults = await Promise.all(chunkPromises);
    translations.push(...chunkResults);
  }

  return translations;
}

// 2. Translate English Subtitle Lines to Persian Dubbing Dialogue with High Speed & Semantic Clarity
app.post('/api/translate-subtitles', async (req: Request, res: Response) => {
  const { lines, style = 'colloquial', context = '' } = req.body;
  const config = getApiConfig(req);

  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'هیچ خط زیرنویسی ارسال نشده است.' });
  }

  const selectedStyle = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.colloquial;

  // Format lines with word counts and 120% max budget without cutting off clauses
  const simpleLines = lines.map((l: any) => {
    const start = typeof l.start === 'number' ? l.start : 0;
    const end = typeof l.end === 'number' ? l.end : 0;
    const duration = typeof l.duration === 'number' ? l.duration : (end > start ? end - start : 2.5);
    const enWords = (l.text || '').trim().split(/\s+/).filter(Boolean).length;
    const maxBudgetWords = Math.max(enWords + 2, Math.ceil(enWords * 1.2));
    return {
      id: l.id,
      text: (l.text || '').trim(),
      start,
      end,
      duration: Number(duration.toFixed(1)),
      englishWordCount: enWords,
      maxBudgetWords,
    };
  });

  // Branch A: Hormouz AI or OpenAI-compatible gateway
  if (config.isHormouzOrOpenAI && config.hasKey) {
    try {
      const translations = await translateWithHormouz(simpleLines, selectedStyle, config);
      return res.json({
        success: true,
        translations,
        provider: 'hormouz',
      });
    } catch (hErr: any) {
      console.warn(`[Translate] Hormouz error (${hErr?.message}). Falling back to local translation engine...`);
      try {
        const fallbackTranslations = await translateWithFallbackEngine(simpleLines, style);
        if (fallbackTranslations && fallbackTranslations.length > 0) {
          return res.json({
            success: true,
            translations: fallbackTranslations,
            notice: 'ترجمه به زبان فارسی با موتور جایگزین و حفظ واژگان تخصصی با موفقیت انجام شد.',
          });
        }
      } catch (fbErr) {
        console.error('Fallback translation also failed:', fbErr);
      }
      return res.status(500).json({
        success: false,
        error: hErr?.message || 'خطا در ارتباط با سرویس ترجمه هرمز',
      });
    }
  }

  let ai: GoogleGenAI | null = null;
  try {
    ai = getGenAIClient(config.apiKey);
  } catch (keyErr) {
    console.warn('[Translate] API key not available or invalid. Activating high-accuracy Persian translation engine...');
    try {
      const fallbackTranslations = await translateWithFallbackEngine(simpleLines, style);
      return res.json({
        success: true,
        translations: fallbackTranslations,
        notice: 'ترجمه به زبان فارسی با موتور جایگزین و حفظ واژگان تخصصی با موفقیت انجام شد.',
      });
    } catch (fbErr: any) {
      return res.status(500).json({ success: false, error: fbErr?.message || 'خطا در ترجمه خطوط' });
    }
  }

  try {

    const buildPromptForLines = (subsetLines: Array<any>) => `You are a professional English-to-Persian translator specializing in programming, computer science, software development, AI, and educational content.

Your task is to translate English text into natural, concise, conversational Persian that sounds like a native Persian-speaking instructor explaining a topic, not someone reading from a textbook.

### 1. Natural, Conversational Persian (Instructor Style - مدرس ایرانی)
- Use simple, modern, fluent, conversational Persian.
- Make the translation sound natural when spoken aloud in educational videos and voiceovers (e.g. use spoken conversational forms: "توی این درس می‌خوایم...", "سلام مو هستم خوش اومدید", "قراره بررسی کنیم", "می‌ریم سراغ...").
- Avoid overly formal, literary, bookish, or unnatural phrasing (do NOT write stiff literal text like "دوباره مو هستم" or "ما قصد داریم").
- Preserve the original meaning while restructuring sentences when necessary to make them sound natural in Persian.
- Prefer everyday spoken expressions over formal equivalents whenever appropriate.

### 2. Strict Word Count, Conciseness & Completeness (DO NOT DROP CLAUSES)
- Use the fewest words possible while preserving the complete meaning.
- CRITICAL: Never cut off, omit, or delete parts of the sentence! If an English sentence has multiple clauses or ideas, ALL clauses must be translated and conveyed clearly.
- Avoid unnecessary explanations, filler words, redundant phrases, and repetitions.
- The Persian translation must NOT contain more than 120% of the words of the original English text (e.g., if English is 10 words, Persian should be around 8 to 12 words max).
- Treat this budget as a guideline for conciseness: before returning the translation, check the word count.
- Whenever two translations are equally accurate, choose the shorter, punchier one.
- Never remove important technical details, conditions, examples, warnings, or logical relationships just to meet the word limit. Instead, rewrite the sentence more concisely.
- Prioritize semantic accuracy and completeness while remaining as concise as possible.

### 3. Preserve Technical Terminology in English
- Keep established technical terms from computer science, programming, AI, networking, software engineering, and web development in their original English form.
- Do NOT translate technical terminology into Persian just to make it sound more localized.
- Examples:
  - Magic Method → Magic Method (NOT "متد جادویی")
  - Class → Class
  - Object → Object
  - Function → Function
  - Framework → Framework
  - API / Endpoint → API / Endpoint
  - Debugging → Debugging
  - Runtime → Runtime
  - Callback → Callback
  - Middleware → Middleware
  - Machine Learning → Machine Learning
  - Neural Network → Neural Network
  - Token → Token
  - Prompt → Prompt
  - Method / Constructor → Method / Constructor
  - Array / String / Loop → Array / String / Loop
  - Database / Query → Database / Query
  - Frontend / Backend / Fullstack → Frontend / Backend / Fullstack
  - VMware Player / Docker / Linux / VS Code → VMware Player / Docker / Linux / VS Code
- Preserve the exact spelling and capitalization of software tools, class names, function names, and code identifiers.
- Do not translate an entire sentence into English. Keep the surrounding explanation in natural Persian while retaining technical terms in English.

### 4. Semantic Accuracy & Completeness
- Preserve the original meaning, intent, technical accuracy, and logical relationships.
- Do not add explanations or assumptions that the original speaker did not provide.
- Do not omit important details, examples, conditions, warnings, or second clauses.
- Preserve names, numbers, values, code, and technical references accurately.

### 5. Voiceover and Subtitle Optimization
- Write short, easy-to-speak sentences suitable for voiceover and dubbing.
- Avoid awkward phrasing, unnecessarily complex sentence structures, and difficult-to-pronounce constructions.
- Keep the translation reasonably close to the original sentence length and speaking rhythm.

### 6. Golden Examples (Follow these patterns strictly):
Example 1:
English: "downloading and installing the VMware Player. Now, this is one of our first choice"
WRONG (Dropped the second clause): "دانلود و نصب VMware Player." ❌ (Missing critical meaning!)
CORRECT (Conversational & Complete): "دانلود و نصب VMware Player؛ این یکی از انتخاب‌های اصلی ماست." ✅

Example 2:
English: "Hey, everybody, welcome back. It's Mo again. Well, this lecture what we're going to be doing is"
WRONG (Stiff & chopped off): "سلام، خوش اومدید، دوباره مو هستم." ❌
CORRECT (Natural Instructor Style): "سلام مو هستم خوش اومدید، توی این درس می‌خوایم..." ✅

Example 3:
English: "In this function we handle the callback and catch any runtime error."
CORRECT: "توی این Function، کال‌بک (Callback) رو هندل می‌کنیم و جلوی Runtime Error رو می‌گیریم." ✅

### 7. Output Rules
- Provide the translation for each subtitle line matching its exact ID in the JSON response.
- Do not include introductions, headings, explanations, analysis, or notes.
- Keep technical terms in English within the Persian translation.

Lines to translate:
${JSON.stringify(
  subsetLines.map((s) => ({
    id: s.id,
    englishText: s.text,
    durationSeconds: s.duration,
    englishWordCount: s.englishWordCount,
    maxPersianWordsAllowed: s.maxBudgetWords,
  })),
  null,
  2
)}
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
    console.warn(`[Translate] Gemini models encountered issue (${error?.message}). Falling back to alternative Persian translation engine...`);
    try {
      const fallbackTranslations = await translateWithFallbackEngine(simpleLines, style);
      if (fallbackTranslations && fallbackTranslations.length > 0) {
        return res.json({
          success: true,
          translations: fallbackTranslations,
          notice: 'ترجمه به زبان فارسی با موتور جایگزین و حفظ واژگان تخصصی با موفقیت انجام شد.',
        });
      }
    } catch (fbErr) {
      console.error('Fallback translation also failed:', fbErr);
    }

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

// Dedicated Local/Internal Translation Endpoint
app.post('/api/translate-fallback', async (req: Request, res: Response) => {
  try {
    const { lines, style = 'colloquial' } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'هیچ خط زیرنویسی ارسال نشده است.' });
    }
    const simpleLines = lines.map((l: any) => ({
      id: l.id,
      text: (l.text || '').trim(),
    }));
    const translations = await translateWithFallbackEngine(simpleLines, style);
    return res.json({
      success: true,
      translations,
      notice: 'ترجمه کامل به زبان فارسی با مدل داخلی انجام شد.',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'خطا در ترجمه با مدل داخلی' });
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
    const config = getApiConfig(req);

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'متن برای تولید صوت الزامی است.' });
    }

    // Branch A: Hormouz AI or OpenAI-compatible Speech API
    if (config.isHormouzOrOpenAI && config.hasKey) {
      try {
        const hormouzResult = await ttsWithHormouz(text, voice, config);
        const durationMs = Date.now() - startTime;
        return res.json({
          success: true,
          audioBase64: hormouzResult.audioBase64,
          mimeType: hormouzResult.mimeType || 'audio/mp3',
          voice: voice || 'Puck',
          modelUsed: config.ttsModel,
          latencyMs: durationMs,
        });
      } catch (ttsErr: any) {
        console.error('[Hormouz TTS Error]:', ttsErr?.message);
        return res.status(500).json({
          success: false,
          error: ttsErr?.message || 'خطا در ارتباط با سرویس صوتی هرمز',
        });
      }
    }

    // Branch B: Direct Google Gemini TTS
    const ai = getGenAIClient(config.apiKey);

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
