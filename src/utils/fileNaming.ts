/**
 * Extracts a clean base name from an input video, audio, or subtitle file name.
 * Strips extensions (.mp4, .mkv, .wav, .srt, etc.), language codes (.en, .fa),
 * and system annotations (e.g. '(زیرنویس Whisper)').
 *
 * Examples:
 * - "Inception (2010).1080p.mp4" -> "Inception (2010).1080p"
 * - "The_Dark_Knight.en.srt" -> "The_Dark_Knight"
 * - "sample_movie.mp4 (زیرنویس Whisper)" -> "sample_movie"
 * - "extracted_audio.wav" -> "extracted_audio"
 */
export function extractCleanBaseName(rawName?: string | null): string {
  if (!rawName) return '';

  let name = rawName.trim();

  // 1. Remove system labels/tags appended in parentheses or brackets
  name = name.replace(/\s*\([^\)]*?(زیرنویس|صوت|دیالوگ|Whisper|استخراج|بهینه‌سازی)[^\)]*?\)/gi, '');
  name = name.replace(/\s*\[[^\]]*?(زیرنویس|صوت|دیالوگ|Whisper|استخراج|بهینه‌سازی)[^\]]*?\]/gi, '');

  // If the name is purely a generic Persian status message without a file extension, discard it
  if (/^[\u0600-\u06FF\s]+$/.test(name) && name.length > 10 && !name.includes('.')) {
    return '';
  }

  // 2. Strip standard media and subtitle extensions
  name = name.replace(
    /\.(mp4|mkv|avi|mov|webm|flv|ts|m4v|wav|mp3|m4a|aac|ogg|flac|srt|vtt|ass|sub)$/i,
    ''
  );

  // 3. Strip language codes like .en, .eng, .fa, .per, .fa-ir before extension if present on subtitles
  name = name.replace(/\.(en|eng|fa|per|pes|fa-ir|fa_ir)$/i, '');

  return name.trim();
}

/**
 * Derives the project base output name by inspecting available source filenames.
 * Prioritizes video/audio file name, then subtitle file name.
 */
export function deriveProjectOutputName(
  videoOrAudioName?: string | null,
  subtitleName?: string | null
): string {
  const fromAudio = extractCleanBaseName(videoOrAudioName);
  if (fromAudio && fromAudio !== 'extracted_audio' && fromAudio !== 'صوت مرجع') {
    return fromAudio;
  }

  const fromSub = extractCleanBaseName(subtitleName);
  if (fromSub && fromSub !== 'english_subtitles') {
    return fromSub;
  }

  if (fromAudio) return fromAudio;
  if (fromSub) return fromSub;

  return 'persian_dub';
}
