import React, { useRef, useState } from 'react';
import {
  FileText,
  Music,
  Key,
  Upload,
  CheckCircle2,
  Play,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Wand2,
  Loader2,
  Video,
  Film,
  Download,
  Code2,
  Copy,
  Check,
  Cpu,
  Terminal,
  Subtitles,
  Bot,
  X,
  FileCheck2,
  Clock,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';
import { SubtitleItem } from '../types/dubbing';
import { parseSrt, secondsToSrtTime, formatPlayerTime } from '../utils/srtParser';
import { decodeAudioFile } from '../utils/audioMixer';
import {
  convertVideoToWav,
  triggerFileDownload
} from '../utils/videoToWav';
import {
  detectSpeechSegmentsFromAudioBuffer,
  createLightweightWavBlob,
  optimizeAndAlignSubtitlesWithAudio,
  AudioSpeechSegment
} from '../utils/audioVAD';
import { extractCleanBaseName } from '../utils/fileNaming';

interface FileUploaderSectionProps {
  apiKey: string;
  hasEnvKey: boolean;
  onOpenApiKeyModal: () => void;
  subtitles: SubtitleItem[];
  onSubtitlesLoaded: (items: SubtitleItem[], fileName: string) => void;
  originalAudioBuffer: AudioBuffer | null;
  originalAudioName: string;
  originalAudioDuration: number;
  onAudioLoaded: (buffer: AudioBuffer, fileName: string, url: string) => void;
  onProceedToTranslation?: () => void;
  isProcessingAudio: boolean;
}

export const FileUploaderSection: React.FC<FileUploaderSectionProps> = ({
  apiKey,
  hasEnvKey,
  onOpenApiKeyModal,
  subtitles,
  onSubtitlesLoaded,
  originalAudioBuffer,
  originalAudioName,
  originalAudioDuration,
  onAudioLoaded,
  onProceedToTranslation,
  isProcessingAudio,
}) => {
  // Input references
  const srtInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoSubInputRef = useRef<HTMLInputElement>(null);
  const videoAiSttInputRef = useRef<HTMLInputElement>(null);

  // Card 2 Subtitle Tabs: 'srt_file' | 'video_extract' | 'whisper_ai'
  const [subSourceTab, setSubSourceTab] = useState<'srt_file' | 'video_extract' | 'whisper_ai'>('srt_file');
  
  // In-App AI Video to SRT states
  const [isAiTranscribingVideo, setIsAiTranscribingVideo] = useState(false);
  const [aiTranscribeProgress, setAiTranscribeProgress] = useState<string>('');
  const [aiTranscribeNotice, setAiTranscribeNotice] = useState<string | null>(null);
  const [generatedSrtText, setGeneratedSrtText] = useState<string | null>(null);
  const [lastUploadedVideoFile, setLastUploadedVideoFile] = useState<File | null>(null);

  // Embedded Subtitle Extraction state
  const [isExtractingVideoSub, setIsExtractingVideoSub] = useState(false);
  const [videoSubNotice, setVideoSubNotice] = useState<string | null>(null);

  // Card 3 Audio Tabs: 'video_to_wav' | 'direct_audio'
  const [audioSourceTab, setAudioSourceTab] = useState<'video_to_wav' | 'direct_audio'>('video_to_wav');
  
  // Video to WAV conversion state
  const [isConvertingVideo, setIsConvertingVideo] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<string>('');
  const [conversionPercent, setConversionPercent] = useState<number>(0);
  const [convertedWavBlob, setConvertedWavBlob] = useState<Blob | null>(null);
  const [convertedWavFileName, setConvertedWavFileName] = useState<string>('');
  const [convertedMethod, setConvertedMethod] = useState<'browser-native' | 'ffmpeg-server'>('browser-native');

  // Waveform alignment state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeNotice, setTranscribeNotice] = useState<string | null>(null);

  // 1. In-App AI Video to Subtitle Extraction (Automated Whisper/Gemini STT without any Python)
  const handleAiTranscribeVideo = async (file: File) => {
    if (!file) return;

    setLastUploadedVideoFile(file);
    setIsAiTranscribingVideo(true);
    setAiTranscribeProgress('در حال استخراج صدای باکیفیت از ویدیو با موتور FFmpeg...');
    setAiTranscribeNotice(null);

    try {
      // Step update
      setTimeout(() => {
        setAiTranscribeProgress('هوش مصنوعی در حال گوش دادن به گفتار انگلیسی و تنظیم ثانیه‌ای زیرنویس‌ها...');
      }, 2500);

      const response = await fetch('/api/transcribe-video-to-srt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-gemini-api-key': apiKey || '',
        },
        body: file,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'خطا در استخراج زیرنویس از ویدیو توسط هوش مصنوعی');
      }

      const rawSubs = data.subtitles || [];
      if (rawSubs.length === 0) {
        throw new Error('هیچ گفتار انگلیسی واضحی در فایل ویدیو تشخیص داده نشد.');
      }

      const formattedItems: SubtitleItem[] = rawSubs.map((item: any, idx: number) => ({
        id: idx + 1,
        start: item.startSeconds,
        end: item.endSeconds,
        startTimeStr: item.startTime,
        endTimeStr: item.endTime,
        originalText: item.text,
        farsiText: '',
        voice: 'Iapetus',
        status: 'idle',
      }));

      onSubtitlesLoaded(formattedItems, `${file.name} (زیرنویس Whisper)`);
      setGeneratedSrtText(data.srtText || '');
      setAiTranscribeNotice(`✅ ${formattedItems.length} دیالوگ انگلیسی با زمان‌بندی دقیق توسط Whisper استخراج و بارگذاری شد.`);
    } catch (err: any) {
      alert('خطا در تبدیل خودکار ویدیو به زیرنویس با Whisper: ' + (err.message || 'مشکلی رخ داد'));
    } finally {
      setIsAiTranscribingVideo(false);
      if (videoAiSttInputRef.current) videoAiSttInputRef.current.value = '';
    }
  };

  // One-click Whisper extraction directly from the audio loaded/converted in Section 3
  const handleAiTranscribeFromExistingAudio = async () => {
    if (!originalAudioBuffer && !convertedWavBlob) {
      alert('ابتدا فایل صوتی یا ویدیویی را در بخش ۳ بارگذاری نمایید.');
      return;
    }

    setIsAiTranscribingVideo(true);
    setAiTranscribeProgress('در حال آماده‌سازی صوت برای ارسال به موتور هوش مصنوعی Whisper...');
    setAiTranscribeNotice(null);

    try {
      let blobToSend: Blob;
      if (convertedWavBlob) {
        blobToSend = convertedWavBlob;
      } else if (originalAudioBuffer) {
        setAiTranscribeProgress('در حال استخراج صوت جهت پردازش سریع با Whisper...');
        blobToSend = await createLightweightWavBlob(originalAudioBuffer);
      } else {
        throw new Error('فایل صوتی یافت نشد.');
      }

      setAiTranscribeProgress('هوش مصنوعی Whisper در حال گوش دادن به گفتار انگلیسی و تولید زیرنویس زمان‌بندی‌شده...');
      const response = await fetch('/api/transcribe-video-to-srt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-gemini-api-key': apiKey || '',
        },
        body: blobToSend,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'خطا در استخراج زیرنویس با Whisper');
      }

      const rawSubs = data.subtitles || [];
      if (rawSubs.length === 0) {
        throw new Error('هیچ گفتار انگلیسی واضحی در صوت تشخیص داده نشد.');
      }

      const formattedItems: SubtitleItem[] = rawSubs.map((item: any, idx: number) => ({
        id: idx + 1,
        start: item.startSeconds,
        end: item.endSeconds,
        startTimeStr: item.startTime,
        endTimeStr: item.endTime,
        originalText: item.text,
        farsiText: '',
        voice: 'Iapetus',
        status: 'idle',
      }));

      onSubtitlesLoaded(formattedItems, `${originalAudioName || 'صوت مرجع'} (زیرنویس Whisper)`);
      setGeneratedSrtText(data.srtText || '');
      setAiTranscribeNotice(`✅ ${formattedItems.length} دیالوگ انگلیسی با Whisper از روی صوت بخش ۳ استخراج و بارگذاری شد.`);
    } catch (err: any) {
      alert('خطا در استخراج زیرنویس با Whisper: ' + (err.message || 'مشکلی رخ داد'));
    } finally {
      setIsAiTranscribingVideo(false);
    }
  };

  // Download the generated SRT file
  const handleDownloadGeneratedSrt = () => {
    let srtData = generatedSrtText;
    if (!srtData && subtitles.length > 0) {
      srtData = subtitles.map(s => `${s.id}\n${s.startTimeStr} --> ${s.endTimeStr}\n${s.originalText}`).join('\n\n');
    }
    if (!srtData) return;
    const base = lastUploadedVideoFile
      ? extractCleanBaseName(lastUploadedVideoFile.name)
      : extractCleanBaseName(originalAudioName);
    const fileName = `${base || 'english_subtitles'}.srt`;
    triggerFileDownload(new Blob([srtData], { type: 'text/plain;charset=utf-8' }), fileName);
  };

  // 2. Direct SRT File Upload
  const handleSrtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseSrt(text);
      if (parsed.length === 0) {
        alert('فایل زیرنویس خوانده شد اما هیچ خط دیالوگی یافت نشد. لطفاً از فایل معتبر .srt استفاده نمایید.');
        return;
      }
      onSubtitlesLoaded(parsed, file.name);
      setGeneratedSrtText(text);
      setAiTranscribeNotice(null);
    } catch (err: any) {
      alert('خطا در خواندن فایل زیرنویس: ' + err.message);
    }
  };

  // 3. Embedded Subtitle Extraction from Video via FFmpeg
  const handleExtractSubtitlesFromVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtractingVideoSub(true);
    setVideoSubNotice(null);

    try {
      const response = await fetch('/api/extract-video-subtitles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.reason === 'no_embedded_subs') {
          setVideoSubNotice(
            'این ویدیو ترک زیرنویس نهفته در فایل خود ندارد. می‌توانید فایل .srt را بارگذاری کنید یا در بخش پایین از قابلیت «استخراج خودکار دیالوگ‌ها و زمان‌بندی دقیق از روی صوت» استفاده نمایید.'
          );
        } else {
          alert(data.error || data.message || 'خطا در استخراج ترک زیرنویس از ویدیو');
        }
        return;
      }

      const srtText = data.srtText;
      const parsed = parseSrt(srtText);
      if (parsed.length === 0) {
        alert('ترک زیرنویس استخراج شد اما محتوای آن خالی بود.');
        return;
      }

      onSubtitlesLoaded(parsed, `${file.name} (زیرنویس ویدیویی)`);
      setGeneratedSrtText(srtText);
      setVideoSubNotice(`زیرنویس انگلیسی با موفقیت از ویدیو استخراج شد (${parsed.length} خط دیالوگ).`);
    } catch (err: any) {
      alert('خطا در ارتباط با سرور جهت استخراج زیرنویس: ' + (err.message || 'مشکل در خواندن ویدیو'));
    } finally {
      setIsExtractingVideoSub(false);
      if (videoSubInputRef.current) videoSubInputRef.current.value = '';
    }
  };

  // 4. Handle Direct Audio Upload (.mp3, .wav, .m4a)
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const blobUrl = URL.createObjectURL(file);
      const audioBuffer = await decodeAudioFile(file);
      setConvertedWavBlob(null);
      setConvertedWavFileName('');
      onAudioLoaded(audioBuffer, file.name, blobUrl);
    } catch (err: any) {
      alert('خطا در دیکود فایل صوتی: ' + (err.message || 'فرمت فایل صوتی پشتیبانی نشد'));
    }
  };

  // 5. Handle Video Upload and Conversion to WAV via FFmpeg
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLastUploadedVideoFile(file);
    setIsConvertingVideo(true);
    setConversionProgress('در حال استخراج صوت از ویدیو به فرمت استاندارد WAV...');
    setConversionPercent(15);

    try {
      const result = await convertVideoToWav(file, (msg, pct) => {
        setConversionProgress(msg);
        if (pct !== undefined) setConversionPercent(pct);
      });

      setConvertedWavBlob(result.wavBlob);
      setConvertedWavFileName(result.wavFileName);
      setConvertedMethod(result.method);

      const blobUrl = URL.createObjectURL(result.wavBlob);
      onAudioLoaded(result.audioBuffer, result.wavFileName, blobUrl);
    } catch (err: any) {
      alert('خطا در تبدیل ویدیو به WAV: ' + (err.message || 'مشکلی در پردازش ویدیو رخ داد'));
    } finally {
      setIsConvertingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  // Download converted WAV file
  const handleDownloadWav = () => {
    if (!convertedWavBlob) return;
    triggerFileDownload(convertedWavBlob, convertedWavFileName || 'extracted_audio.wav');
  };

  // Transcribe & Waveform VAD Speech Alignment & Collision Prevention
  const handleTranscribeAudio = async (overrideBuffer?: AudioBuffer, overrideName?: string) => {
    const targetBuffer = overrideBuffer || originalAudioBuffer;
    const targetName = overrideName || originalAudioName;

    if (!targetBuffer) {
      alert('ابتدا فایل صوتی یا ویدیوی انگلیسی را در بخش ۳ بارگذاری کنید یا دکمه انتخاب صوت را بزنید.');
      return;
    }

    setIsTranscribing(true);
    setTranscribeNotice('در حال تحلیل شکل‌موج صوتی (VAD)، بررسی نقاط شروع/پایان دیالوگ‌ها و برطرف کردن تداخل زمانی...');

    try {
      // 1. If subtitles already exist: optimize and snap directly to the WAV audio without re-uploading!
      if (subtitles.length > 0) {
        const result = optimizeAndAlignSubtitlesWithAudio(subtitles, targetBuffer, { minGapSec: 0.25 });
        onSubtitlesLoaded(result.optimizedSubtitles, 'دیالوگ‌های بهینه‌سازی‌شده (بدون تداخل صوتی)');
        setTranscribeNotice(
          `✅ زمان‌بندی ${result.optimizedSubtitles.length} دیالوگ با بررسی صوت WAV بهینه‌سازی شد. (${result.collisionResolvedCount} مورد تداخل و همپوشانی زمانی احتمالی برای خروجی روان دوبله برطرف گردید).`
        );
        return;
      }

      // 2. If no subtitles yet: detect speech segments from audio buffer
      const detectedSegments = detectSpeechSegmentsFromAudioBuffer(targetBuffer);
      let transcriptionSegments: Array<{ id: number; start: number; end: number; text: string }> = [];

      try {
        const lightWavBlob = await createLightweightWavBlob(targetBuffer);
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const res = reader.result as string;
            const base64 = res.replace(/^data:[^;]+;base64,/, '');
            resolve(base64);
          };
          reader.onerror = reject;
        });

        const audioBase64 = await base64Promise;

        const res = await fetch('/api/transcribe-audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-api-key': apiKey,
          },
          body: JSON.stringify({
            audioBase64,
            mimeType: 'audio/wav',
            totalDuration: targetBuffer.duration,
            apiKey,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.segments) && data.segments.length > 0) {
          transcriptionSegments = data.segments;
        }
      } catch (geminiErr) {
        console.warn('Gemini transcription API call had issues, using high-precision waveform detection fallback', geminiErr);
      }

      let finalSubtitles: SubtitleItem[] = [];

      if (transcriptionSegments.length > 0) {
        finalSubtitles = transcriptionSegments.map((seg, idx) => ({
          id: idx + 1,
          start: seg.start,
          end: seg.end,
          startTimeStr: secondsToSrtTime(seg.start),
          endTimeStr: secondsToSrtTime(seg.end),
          originalText: seg.text || `Spoken sentence ${idx + 1}`,
          farsiText: '',
          voice: 'Iapetus',
          status: 'idle',
        }));
      } else {
        finalSubtitles = detectedSegments.map((seg: AudioSpeechSegment, idx: number) => ({
          id: idx + 1,
          start: seg.start,
          end: seg.end,
          startTimeStr: secondsToSrtTime(seg.start),
          endTimeStr: secondsToSrtTime(seg.end),
          originalText: `دیالوگ صوتی خط ${idx + 1}`,
          farsiText: '',
          voice: 'Iapetus',
          status: 'idle',
        }));
      }

      // Enforce collision spacing
      const optimized = optimizeAndAlignSubtitlesWithAudio(finalSubtitles, targetBuffer, { minGapSec: 0.25 });
      onSubtitlesLoaded(optimized.optimizedSubtitles, `دیالوگ‌های استخراج‌شده از صوت (${targetName || 'صوت مرجع'})`);
      setTranscribeNotice(`✅ زمان‌بندی دقیق ${optimized.optimizedSubtitles.length} دیالوگ انگلیسی بدون تداخل از صوت استخراج شد.`);
    } catch (err: any) {
      alert('خطا در تحلیل صوت: ' + (err.message || 'مشکلی رخ داد'));
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
      {/* Hidden file inputs */}
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,.str,.txt,.vtt"
        onChange={handleSrtUpload}
        className="hidden"
      />
      <input
        ref={videoAiSttInputRef}
        type="file"
        accept=".mp4,.mkv,.mov,.webm,.avi,.flv,.ts,.m4v"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleAiTranscribeVideo(f);
        }}
        className="hidden"
      />
      <input
        ref={videoSubInputRef}
        type="file"
        accept=".mp4,.mkv,.mov,.webm,.avi,.flv,.ts,.m4v"
        onChange={handleExtractSubtitlesFromVideo}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.aac,.ogg"
        onChange={handleAudioUpload}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept=".mp4,.mkv,.mov,.webm,.avi,.flv,.ts,.m4v"
        onChange={handleVideoUpload}
        className="hidden"
      />

      {/* Top Header & Fast Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>مرحله ۱: بارگذاری داده‌های آموزشی و استخراج زیرنویس</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
              گام اول
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            ویدیو یا زیرنویس انگلیسی دوره آموزشی خود را بدهید؛ هوش مصنوعی آن را به‌صورت خودکار شنیده، زمان‌بندی کرده و آماده دوبله می‌کند.
          </p>
        </div>

      </div>

      {/* 3 Input Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 1. API Key Card */}
        <div
          onClick={onOpenApiKeyModal}
          className={`cursor-pointer rounded-2xl p-5 border transition-all relative overflow-hidden group ${
            apiKey || hasEnvKey
              ? 'bg-slate-950/60 border-emerald-500/40 hover:border-emerald-500/60'
              : 'bg-slate-950/60 border-amber-500/40 hover:border-amber-500/70 shadow-lg shadow-amber-500/5'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
              <Key className="w-5 h-5" />
            </div>
            {apiKey || hasEnvKey ? (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                تنظیم شده
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                نیازمند کلید
              </span>
            )}
          </div>

          <h3 className="font-semibold text-slate-100 text-sm mb-1">۱. کلید هوش مصنوعی (API Key)</h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-3">
            {apiKey
              ? 'کلید اختصاصی شما وارد شده و آماده ترجمه و گویندگی است.'
              : hasEnvKey
              ? 'کلید پیش‌فرض فعال است. برای وارد کردن کلید خود کلیک کنید.'
              : 'کلید Google Gemini API خود را وارد کنید.'}
          </p>

          <div className="text-[11px] text-amber-400/90 font-medium group-hover:underline flex items-center gap-1">
            <span>مدیریت و تغییر کلید &larr;</span>
          </div>
        </div>

        {/* 2. Subtitle Card (.srt file & embedded track extraction) */}
        <div
          className={`rounded-2xl p-5 border transition-all relative overflow-hidden ${
            subtitles.length > 0
              ? 'bg-slate-950/70 border-emerald-500/40'
              : 'bg-slate-950/70 border-blue-500/30 hover:border-blue-500/50'
          }`}
        >
          {/* Subtitle Source Tabs */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Subtitles className="w-5 h-5" />
              </div>
              <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-[11px]">
                <button
                  type="button"
                  onClick={() => setSubSourceTab('srt_file')}
                  className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                    subSourceTab === 'srt_file'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  فایل SRT
                </button>
                <button
                  type="button"
                  onClick={() => setSubSourceTab('video_extract')}
                  className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                    subSourceTab === 'video_extract'
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ترک نهفته
                </button>
                <button
                  type="button"
                  onClick={() => setSubSourceTab('whisper_ai')}
                  className={`px-2 py-1 rounded-md transition font-medium cursor-pointer flex items-center gap-1 ${
                    subSourceTab === 'whisper_ai'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-cyan-300" />
                  <span>استخراج Whisper</span>
                </button>
              </div>
            </div>

            {subtitles.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {subtitles.length} خط
              </span>
            )}
          </div>

          <h3 className="font-semibold text-slate-100 text-sm mb-1">
            ۲. فایل زیرنویس انگلیسی (.srt)
          </h3>

          {/* Subtitle Tab 1: Direct SRT Upload */}
          {subSourceTab === 'srt_file' && (
            <div>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {subtitles.length > 0
                  ? `${subtitles.length} دیالوگ با زمان‌بندی دقیق در استودیو بارگذاری شده است.`
                  : 'اگر از قبل فایل زیرنویس انگلیسی (.srt یا .vtt) دارید، آن را مستقیماً آپلود نمایید.'}
              </p>

              <button
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-blue-600/20"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{subtitles.length > 0 ? 'تعویض فایل زیرنویس' : 'آپلود فایل .srt'}</span>
              </button>
            </div>
          )}

          {/* Subtitle Tab 2: Extract embedded subtitles from video */}
          {subSourceTab === 'video_extract' && (
            <div>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {isExtractingVideoSub
                  ? 'در حال اسکن ویدیو و استخراج ترک زیرنویس با FFmpeg...'
                  : 'فایل ویدیو (MKV, MP4) را انتخاب کنید تا ترک‌های زیرنویس ذخیره‌شده درون فایل استخراج شود.'}
              </p>

              {videoSubNotice && (
                <div className="mb-3 p-2 rounded-xl bg-slate-900 border border-amber-500/30 text-[11px] text-amber-300 leading-relaxed">
                  {videoSubNotice}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isExtractingVideoSub}
                  onClick={() => videoSubInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50"
                >
                  {isExtractingVideoSub ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>در حال استخراج...</span>
                    </>
                  ) : (
                    <>
                      <Film className="w-3.5 h-3.5" />
                      <span>انتخاب ویدیو و استخراج SRT</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Subtitle Tab 3: Automatic extraction with Whisper */}
          {subSourceTab === 'whisper_ai' && (
            <div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                {isAiTranscribingVideo
                  ? aiTranscribeProgress || 'مدل Whisper در حال گوش دادن به صوت و استخراج زمان‌بندی دقیق صدم‌ثانیه‌ای دیالوگ‌ها...'
                  : 'مدل Whisper صدای انگلیسی را مستقیماً شنیده و بدون نیاز به اسکریپت، زیرنویس SRT را استخراج می‌کند.'}
              </p>

              {aiTranscribeNotice && (
                <div className="mb-3 p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center justify-between">
                  <span>{aiTranscribeNotice}</span>
                  <button type="button" onClick={() => setAiTranscribeNotice(null)} className="text-slate-400 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Progress indicator */}
              {isAiTranscribingVideo && (
                <div className="mb-3 p-2.5 rounded-xl bg-slate-900 border border-blue-500/30 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-blue-300">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                    <span>{aiTranscribeProgress || 'در حال پردازش گفتار انگلیسی با Whisper...'}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-pulse rounded-full w-3/4" />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {/* One-click Whisper from Section 3 audio */}
                {originalAudioBuffer && (
                  <button
                    type="button"
                    disabled={isAiTranscribingVideo}
                    onClick={handleAiTranscribeFromExistingAudio}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-blue-600/20 disabled:opacity-50"
                    title="استخراج زیرنویس از فایل صوتی آماده در بخش ۳"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                    <span>استخراج Whisper از صوت بخش ۳</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={isAiTranscribingVideo}
                  onClick={() => videoAiSttInputRef.current?.click()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
                    originalAudioBuffer
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-600/20'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5 text-blue-300" />
                  <span>{originalAudioBuffer ? 'انتخاب فایل دیگر' : 'انتخاب ویدیو یا صوت برای استخراج با Whisper'}</span>
                </button>

                {(generatedSrtText || subtitles.length > 0) && (
                  <button
                    type="button"
                    onClick={handleDownloadGeneratedSrt}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer border border-slate-700"
                    title="دانلود فایل زیرنویس SRT استخراج‌شده"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>دانلود SRT</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Video to WAV / Audio File Card */}
        <div
          className={`rounded-2xl p-5 border transition-all relative overflow-hidden ${
            originalAudioBuffer
              ? 'bg-slate-950/70 border-emerald-500/40'
              : 'bg-slate-950/70 border-purple-500/30 hover:border-purple-500/50'
          }`}
        >
          {/* Card Top: Mode Switcher */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                {audioSourceTab === 'video_to_wav' ? <Film className="w-5 h-5" /> : <Music className="w-5 h-5" />}
              </div>
              <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-[11px]">
                <button
                  type="button"
                  onClick={() => setAudioSourceTab('video_to_wav')}
                  className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                    audioSourceTab === 'video_to_wav'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ویدیو به WAV
                </button>
                <button
                  type="button"
                  onClick={() => setAudioSourceTab('direct_audio')}
                  className={`px-2 py-1 rounded-md transition font-medium cursor-pointer ${
                    audioSourceTab === 'direct_audio'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  صوت مستقیم
                </button>
              </div>
            </div>

            {originalAudioBuffer && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {formatPlayerTime(originalAudioDuration)}
              </span>
            )}
          </div>

          <h3 className="font-semibold text-slate-100 text-sm mb-1">
            ۳. {audioSourceTab === 'video_to_wav'
              ? 'تبدیل مستقیم ویدیو به صوت WAV'
              : 'فایل صوتی مرجع انگلیسی'}
          </h3>

          {/* Mode 1: Video to WAV Conversion */}
          {audioSourceTab === 'video_to_wav' && (
            <div>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {isConvertingVideo
                  ? conversionProgress
                  : originalAudioBuffer
                  ? `صوت استخراج شد: ${originalAudioName || 'فایل استخراج شده'}`
                  : 'ویدیوی انگلیسی (MP4, MKV, MOV) را انتخاب کنید تا با FFmpeg به WAV استاندارد دوبله تبدیل شود.'}
              </p>

              {/* Conversion progress bar */}
              {isConvertingVideo && (
                <div className="mb-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-purple-300">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{conversionProgress}</span>
                    </span>
                    <span className="font-mono">{conversionPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(conversionPercent, 10)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isConvertingVideo}
                  onClick={() => videoInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  {isConvertingVideo ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>در حال تبدیل...</span>
                    </>
                  ) : (
                    <>
                      <Film className="w-3.5 h-3.5" />
                      <span>{originalAudioBuffer ? 'تبدیل ویدیوی دیگر' : 'انتخاب ویدیو و تبدیل'}</span>
                    </>
                  )}
                </button>

                {convertedWavBlob && (
                  <button
                    type="button"
                    onClick={handleDownloadWav}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer border border-slate-700"
                    title="دانلود فایل صوتی WAV استخراج شده"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>دانلود فایل WAV</span>
                  </button>
                )}

                {originalAudioBuffer && (
                  <button
                    type="button"
                    disabled={isTranscribing}
                    onClick={() => handleTranscribeAudio()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-purple-600/20 disabled:opacity-50"
                    title="استخراج خودکار دیالوگ‌ها و زمان‌بندی دقیق از روی همین صوت"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                    <span>استخراج زمان‌بندی دیالوگ‌ها</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mode 2: Direct Audio Upload */}
          {audioSourceTab === 'direct_audio' && (
            <div>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {originalAudioBuffer
                  ? `صوت بارگذاری شده: ${originalAudioName || 'فایل صوتی'} (${formatPlayerTime(originalAudioDuration)})`
                  : 'فایل صوتی انگلیسی اصلی (.mp3, .wav, .m4a) را انتخاب نمایید.'}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => audioInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-purple-600/20"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{originalAudioBuffer ? 'تعویض فایل صوتی' : 'آپلود فایل صوتی'}</span>
                </button>

                {originalAudioBuffer && (
                  <button
                    type="button"
                    disabled={isTranscribing}
                    onClick={() => handleTranscribeAudio()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold transition cursor-pointer shadow-md shadow-purple-600/20 disabled:opacity-50"
                    title="استخراج خودکار دیالوگ‌ها و زمان‌بندی دقیق از روی همین صوت"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                    <span>استخراج زمان‌بندی دیالوگ‌ها</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* بخش اختصاصی: استخراج خودکار دیالوگ‌ها و زمان‌بندی دقیق از روی صوت انگلیسی (هماهنگ‌سازی و رفع تداخل بر اساس صوت WAV) */}
      <div className="mt-6 p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-indigo-950/40 border border-purple-500/40 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2.5 max-w-3xl">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="p-2 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                <Sparkles className="w-5 h-5" />
              </span>
              <h3 className="text-base sm:text-lg font-bold text-white">
                استخراج خودکار دیالوگ‌ها و زمان‌بندی دقیق از روی صوت انگلیسی
              </h3>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">
                بررسی با صوت WAV و رفع تداخل
              </span>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed">
              این بخش بدون نیاز به آپلود مجدد فایل، مستقیماً از فایل صوتی WAV (بخش ۳) و فایل زیرنویس SRT (بخش ۲) استفاده می‌کند. الگوریتم با بررسی دقیق شکل‌موج صوتی (VAD)، زمان شروع و پایان هر دیالوگ را هماهنگ کرده و با تنظیم فواصل استاندارد، از تداخل و همپوشانی صداها هنگام دوبله جلوگیری می‌کند.
            </p>

            {/* Status indicators of inputs from Section 2 & Section 3 */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                originalAudioBuffer
                  ? 'bg-purple-950/60 border-purple-500/40 text-purple-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400'
              }`}>
                <Music className="w-4 h-4 text-purple-400 shrink-0" />
                <span>
                  صوت مرجع (بخش ۳):{' '}
                  <strong className={originalAudioBuffer ? 'text-white' : 'text-slate-400'}>
                    {originalAudioBuffer ? `${originalAudioName || 'صوت مرجع'} (${formatPlayerTime(originalAudioDuration)})` : 'هنوز بارگذاری نشده'}
                  </strong>
                </span>
                {originalAudioBuffer && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              </div>

              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                subtitles.length > 0
                  ? 'bg-blue-950/60 border-blue-500/40 text-blue-300'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400'
              }`}>
                <Subtitles className="w-4 h-4 text-blue-400 shrink-0" />
                <span>
                  زیرنویس (بخش ۲):{' '}
                  <strong className={subtitles.length > 0 ? 'text-white' : 'text-slate-400'}>
                    {subtitles.length > 0 ? `${subtitles.length} خط دیالوگ آماده بررسی` : 'استخراج مستقیم از صوت'}
                  </strong>
                </span>
                {subtitles.length > 0 && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap shrink-0">
            {originalAudioBuffer ? (
              <button
                type="button"
                disabled={isTranscribing}
                onClick={() => handleTranscribeAudio()}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-bold transition shadow-lg shadow-purple-600/30 cursor-pointer disabled:opacity-50"
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-purple-200" />
                    <span>در حال بررسی دیالوگ‌ها و رفع تداخل...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 text-purple-200" />
                    <span>بررسی دیالوگ‌ها و بهینه‌سازی زمان‌بندی با صوت WAV</span>
                  </>
                )}
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>برای شروع بهینه‌سازی، ابتدا فایل ویدیو یا صوت را در بخش ۳ بالا انتخاب کنید.</span>
              </div>
            )}
          </div>
        </div>

        {/* Transcribe Notice */}
        {transcribeNotice && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between text-xs text-emerald-300 animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{transcribeNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setTranscribeNotice(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Manual Step Navigation Button */}
      <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 to-slate-950/90 border border-slate-800 shadow-xl">
        <div className="text-right">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <span>آماده رفتن به مرحله بعدی هستید؟</span>
            {subtitles.length > 0 && originalAudioBuffer && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                همه فایل‌ها آماده‌اند
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            هر زمان که فایل‌های زیرنویس و صوت مورد نظر خود را بارگذاری کردید، روی دکمه روبه‌رو کلیک کنید تا به بخش ترجمه بروید.
          </p>
        </div>

        {onProceedToTranslation && (
          <button
            type="button"
            onClick={onProceedToTranslation}
            className="flex items-center gap-2.5 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-bold transition shadow-lg shadow-amber-500/20 cursor-pointer shrink-0"
          >
            <span>رفتن به مرحله ۲: ترجمه و تنظیم متن</span>
            <ArrowLeft className="w-4 h-4 text-slate-950" />
          </button>
        )}
      </div>
    </div>
  );
};

