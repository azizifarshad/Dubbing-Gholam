/**
 * Comprehensive Python script & utilities for local English subtitle extraction
 * using Whisper Large-v3 (via faster-whisper) and FFmpeg embedded subtitle extraction.
 */

export const PYTHON_WHISPER_SCRIPT = `# ==============================================================================
# 🎙️ استخراج فوق دقیق زیرنویس انگلیسی با Whisper Large-v3 محلی (Local AI)
# مخصوص استودیوی دوبله فیلم و ویدیوهای آموزشی
# ==============================================================================
# این اسکریپت با سرعت بالا و بالاترین دقت مدل Whisper Large-v3 را روی سیستم شما
# (با کارت گرافیک NVIDIA یا پردازنده CPU) اجرا می‌کند و فایل SRT زمان‌بندی‌شده
# کاملاً هماهنگ برای دوبله تولید می‌نماید.
#
# 📦 پیش‌نیازها (فقط یک‌بار در ترمینال یا CMD اجرا کنید):
# pip install faster-whisper
# (برای شتاب‌دهنده کارت گرافیک انویدیا):
# pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
# ==============================================================================

import os
import sys
import time
from pathlib import Path

def format_timestamp(seconds: float) -> str:
    """تبدیل زمان به ثانیه به فرمت استاندارد زیرنویس SRT (00:00:00,000)"""
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    secs = int(seconds) % 60
    mins = (int(seconds) // 60) % 60
    hours = int(seconds) // 3600
    return f"{hours:02d}:{mins:02d}:{secs:02d},{millis:03d}"

def extract_srt_whisper(
    video_or_audio_path: str,
    output_srt_path: str = None,
    model_size: str = "large-v3",
    language: str = "en"
):
    input_path = Path(video_or_audio_path.strip().strip('"').strip("'"))
    
    if not input_path.exists():
        print(f"❌ فایل ورودی پیدا نشد: {input_path}")
        return None

    if output_srt_path is None:
        output_srt_path = input_path.with_suffix(".srt")
    else:
        output_srt_path = Path(output_srt_path.strip().strip('"').strip("'"))

    print("=" * 65)
    print("🎬 شروع فرآیند استخراج زیرنویس انگلیسی برای دوبله...")
    print(f"📁 فایل ورودی: {input_path.name}")
    print(f"🧠 مدل انتخابی: Whisper {model_size}")
    print("=" * 65)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("\n❌ کتابخانه faster-whisper نصب نیست!")
        print("💡 لطفاً دستور زیر را در CMD یا ترمینال اجرا کنید:")
        print("   pip install faster-whisper\n")
        return None

    # بررسی شتاب‌دهنده سخت‌افزاری (کارت گرافیک یا پردازنده)
    device = "cpu"
    compute_type = "int8"
    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
            gpu_name = torch.cuda.get_device_name(0)
            print(f"⚡ شتاب‌دهنده فعال: کارت گرافیک {gpu_name} (CUDA - float16)")
        else:
            print("💻 شتاب‌دهنده: پردازنده اصلی سیستم (CPU - int8 بهینه شده)")
    except Exception:
        print("💻 شتاب‌دهنده: پردازنده اصلی سیستم (CPU - int8 بهینه شده)")

    print(f"\n⏳ در حال بارگذاری مدل {model_size} (بار اول ممکن است چند دقیقه طول بکشد)...")
    start_time = time.time()
    
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as e:
        print(f"⚠️ هشدار در بارگذاری روی {device}: {e}")
        print("🔄 تلاش مجدد با حالت پردازنده CPU...")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print("🎧 در حال شنیدن و ترنسکرایب دیالوگ‌ها با زمان‌بندی دقیق میلی‌ثانیه‌ای...")
    
    # فیلتر هوشمند VAD برای حذف سکوت‌ها و جلوگیری از تکرار در زمان موسیقی پس‌زمینه
    segments, info = model.transcribe(
        str(input_path),
        language=language,
        task="transcribe",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400)
    )

    print(f"🗣️ زبان شناسایی شده: {info.language.upper()} (دقت: {info.language_probability * 100:.1f}%)")
    print(f"⏱️ طول فایل: {info.duration:.1f} ثانیه\n")

    srt_lines = []
    segment_count = 0

    with open(output_srt_path, "w", encoding="utf-8") as srt_file:
        for idx, seg in enumerate(segments, start=1):
            start_fmt = format_timestamp(seg.start)
            end_fmt = format_timestamp(seg.end)
            text = seg.text.strip()
            
            # ثبت در فایل استاندارد SRT
            srt_block = f"{idx}\\n{start_fmt} --> {end_fmt}\\n{text}\\n\\n"
            srt_file.write(srt_block)
            srt_lines.append(srt_block)
            segment_count += 1
            
            # نمایش زنده در کنسول
            print(f"  [{start_fmt} --> {end_fmt}] {text}")

    elapsed = time.time() - start_time
    print("\\n" + "=" * 65)
    print(f"🎉 استخراج با موفقیت تمام شد! تعداد دیالوگ‌ها: {segment_count}")
    print(f"⏱️ زمان پردازش: {elapsed:.1f} ثانیه")
    print(f"📄 فایل خروجی SRT:")
    print(f"👉 {output_srt_path.resolve()}")
    print("=" * 65)
    print("✅ اکنون می‌توانید این فایل .srt را در وب‌اپلیکیشن بارگذاری کنید.")
    return output_srt_path

# ==============================================================================
# بخش تعاملی اجرای اسکریپت
# ==============================================================================
if __name__ == "__main__":
    print("****************************************************************")
    print("🎙️ ابزار استخراج زیرنویس انگلیسی Whisper Large-v3 محلی برای دوبله")
    print("****************************************************************\\n")
    
    if len(sys.argv) > 1:
        video_input = sys.argv[1]
    else:
        video_input = input("📍 آدرس فایل ویدیو یا صوت را وارد کنید (می‌توانید فایل را داخل این پنجره بکشید): ").strip()
    
    if video_input:
        extract_srt_whisper(video_input)
    else:
        print("❌ آدرسی وارد نشد.")
    
    input("\\nبرای خروج کلید Enter را فشار دهید...")
`;

/**
 * Downloads the Python Whisper extraction script to the user's PC as a .py file
 */
export function downloadWhisperPythonScript() {
  const blob = new Blob([PYTHON_WHISPER_SCRIPT], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'extract_srt_whisper_large_v3.py';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
