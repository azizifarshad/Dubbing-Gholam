import { SubtitleItem } from '../types/dubbing';

/**
 * Parses time string like "00:01:23,450" or "00:01:23.450" into seconds (e.g. 83.45)
 */
export function timeStringToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const normalized = timeStr.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(normalized) || 0;
}

/**
 * Converts seconds into SRT timestamp string "HH:MM:SS,mmm"
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 1000);

  const pad = (n: number, width: number = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

/**
 * Formats seconds into MM:SS.m for compact audio timeline player
 */
export function formatPlayerTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parses an SRT file string into an array of SubtitleItems
 */
export function parseSrt(srtContent: string): SubtitleItem[] {
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\s*\n/);
  const items: SubtitleItem[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let lineIdx = 0;

    // Check if first line is number id
    let id = i + 1;
    if (/^\d+$/.test(lines[0].trim())) {
      id = parseInt(lines[0].trim(), 10);
      lineIdx = 1;
    }

    if (lineIdx >= lines.length) continue;

    // Time line: "00:00:20,000 --> 00:00:24,400"
    const timeLine = lines[lineIdx];
    const timeMatch = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/);

    if (!timeMatch) {
      continue;
    }

    const startTimeStr = timeMatch[1].replace('.', ',');
    const endTimeStr = timeMatch[2].replace('.', ',');
    const start = timeStringToSeconds(startTimeStr);
    const end = timeStringToSeconds(endTimeStr);

    // Dialogue text
    const textLines = lines.slice(lineIdx + 1);
    const originalText = textLines.join(' ').replace(/<[^>]*>/g, '').trim();

    if (!originalText) continue;

    items.push({
      id,
      start,
      end,
      startTimeStr,
      endTimeStr,
      originalText,
      farsiText: '',
      voice: 'Puck',
      status: 'idle',
    });
  }

  return items;
}

/**
 * Builds an SRT file string from SubtitleItems with translated Persian text
 */
export function exportToSrt(items: SubtitleItem[]): string {
  return items
    .map((item, index) => {
      const id = index + 1;
      const text = item.farsiText.trim() || item.originalText.trim();
      return `${id}\n${secondsToSrtTime(item.start)} --> ${secondsToSrtTime(item.end)}\n${text}\n`;
    })
    .join('\n');
}

/**
 * Sample movie subtitle dialogue for instant demo
 */
export const SAMPLE_SRT_CONTENT = `1
00:00:01,200 --> 00:00:04,100
Hey John, are you sure this is the right place?

2
00:00:04,800 --> 00:00:08,200
Trust me, Sarah. The signal is coming directly from inside this room.

3
00:00:09,000 --> 00:00:12,500
We don't have much time before the security guards arrive. Let's hurry!

4
00:00:13,200 --> 00:00:16,800
Look at that console! It seems like the entire system has been unlocked.

5
00:00:17,500 --> 00:00:21,000
Amazing work! Download the secret files now and let's get out of here.
`;
