import { audioBufferToWav, getAudioContext } from './audioMixer';

export interface VideoConversionResult {
  audioBuffer: AudioBuffer;
  wavBlob: Blob;
  wavFileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  method: 'browser-native' | 'ffmpeg-server';
}

/**
 * Standard Python script for local offline FFmpeg conversion on Windows/Linux/Mac
 * (Matches the exact command provided by user)
 */
export const PYTHON_FFMPEG_SCRIPT = `# ========================================================
# استودیو دوبله فیلم هوشمند - اسکریپت پایتون استخراج صوت از ویدیو به WAV
# مشخصات خروجی: PCM 16-bit | 44100Hz Sample Rate | Stereo 2 Channels
# ========================================================
import subprocess
import shutil
from pathlib import Path
import sys

def find_ffmpeg():
    """یافتن خودکار مسیر FFmpeg در سیستم یا استفاده از مسیر محلی Winget"""
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg
    
    # مسیرهای متداول در ویندوز
    possible_paths = [
        r"C:\\Users\\Erfan\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build-shared\\bin\\ffmpeg.exe",
        r"C:\\ffmpeg\\bin\\ffmpeg.exe",
        r"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    ]
    for p in possible_paths:
        if Path(p).exists():
            return p
    return "ffmpeg"

FFMPEG = find_ffmpeg()

def video_to_wav(video_path, output_path=None):
    video_path = Path(video_path)

    # بررسی وجود ویدیو
    if not video_path.exists():
        print(f"❌ فایل ویدیو پیدا نشد: {video_path}")
        return None

    # اگر مسیر خروجی مشخص نشده باشد، فایل WAV کنار ویدیو ساخته میشود
    if output_path is None:
        output_path = video_path.with_suffix(".wav")
    else:
        output_path = Path(output_path)

    command = [
        FFMPEG,
        "-i", str(video_path),
        "-vn",                   # حذف تصویر
        "-acodec", "pcm_s16le",  # فرمت خطی 16 بیتی WAV
        "-ar", "44100",          # Sample Rate: 44.1 kHz
        "-ac", "2",              # Stereo (2 Channels)
        "-y",                    # جایگزینی خودکار در صورت وجود فایل قبلی
        str(output_path)
    ]

    try:
        print("\\n⏳ در حال تبدیل ویدیو به WAV استاندارد...")
        print(f"🎬 ورودی: {video_path}")
        subprocess.run(command, check=True)
        print("\\n✅ تبدیل با موفقیت انجام شد!")
        print(f"🎵 فایل صوتی خروجی: {output_path}")
        return output_path
    except subprocess.CalledProcessError as e:
        print(f"\\n❌ هنگام تبدیل FFmpeg خطایی رخ داد: {e}")
        return None
    except FileNotFoundError:
        print("\\n❌ برنامه FFmpeg در مسیر یافت نشد. لطفاً FFmpeg را نصب یا مسیر آن را تنظیم کنید.")
        return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        video_input = sys.argv[1]
    else:
        video_input = input("آدرس فایل ویدیویی را وارد کنید: ").strip().strip('"').strip("'")
    
    if video_input:
        video_to_wav(video_input)
`;

/**
 * Downloads a Blob as a file with the given filename
 */
export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Converts any video file (.mp4, .mkv, .mov, .webm, .avi, etc.) into a 
 * 44.1kHz Stereo 16-bit PCM WAV file.
 * Tries fast client-side extraction first, with automatic fallback to server FFmpeg.
 */
export async function convertVideoToWav(
  file: File,
  onProgress?: (message: string, percent?: number) => void,
  options?: { forceServer?: boolean }
): Promise<VideoConversionResult> {
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const wavFileName = `${baseName}.wav`;

  // If forceServer is false, try fast in-browser decoding first
  if (!options?.forceServer) {
    try {
      onProgress?.('در حال خواندن فایل ویدیو در مرورگر...', 20);
      const arrayBuffer = await file.arrayBuffer();

      onProgress?.('در حال استخراج جریان صوتی ویدیو (Web Audio API)...', 45);
      const ctx = getAudioContext();
      
      // Decodes audio directly from container (MP4, WebM, etc.)
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

      onProgress?.('در حال بازنمونه‌برداری به نرخ ۴۴.۱ کیلوهرتز و استریو ۲ کاناله...', 70);
      
      // Standardize to 44100Hz and 2 channels (matching -ar 44100 -ac 2)
      const targetSampleRate = 44100;
      const targetChannels = 2;
      const targetLength = Math.ceil(decodedBuffer.duration * targetSampleRate);

      const offlineCtx = new OfflineAudioContext(targetChannels, targetLength, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const resampledBuffer = await offlineCtx.startRendering();

      onProgress?.('در حال ساخت فایل WAV استاندارد (PCM 16-bit)...', 90);
      const wavBlob = audioBufferToWav(resampledBuffer);

      onProgress?.('تبدیل با موفقیت انجام شد!', 100);

      return {
        audioBuffer: resampledBuffer,
        wavBlob,
        wavFileName,
        duration: resampledBuffer.duration,
        sampleRate: targetSampleRate,
        channels: targetChannels,
        method: 'browser-native',
      };
    } catch (browserErr) {
      console.warn('In-browser audio decoding failed or codec unsupported, falling back to server FFmpeg...', browserErr);
      onProgress?.('استفاده از موتور سرور FFmpeg برای تبدیل فرمت‌های پیچیده ویدیو...', 40);
    }
  }

  // Fallback to Server FFmpeg endpoint
  onProgress?.('در حال ارسال ویدیو به موتور FFmpeg سرور...', 50);
  const ext = file.name.split('.').pop() || 'mp4';

  const response = await fetch(`/api/convert-video-to-wav?ext=${encodeURIComponent(ext)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `خطا در پردازش سرور FFmpeg (کد ${response.status})`);
  }

  onProgress?.('دریافت صوت WAV تبدیل شده از FFmpeg...', 80);
  const wavBlob = await response.blob();
  const arrayBuf = await wavBlob.arrayBuffer();
  const ctx = getAudioContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuf);

  onProgress?.('تبدیل ویدیو به WAV با FFmpeg کامل شد!', 100);

  return {
    audioBuffer,
    wavBlob,
    wavFileName,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
    method: 'ffmpeg-server',
  };
}
