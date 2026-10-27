import sys
import json
import os
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

def transcribe(audio_path, model_size="base"):
    try:
        if not os.path.exists(audio_path):
            print(json.dumps({"success": False, "error": f"فایل صوتی یافت نشد: {audio_path}"}))
            return

        # Read audio using soundfile (compatible with any wav format)
        data, samplerate = sf.read(audio_path)
        
        # Convert stereo to mono if needed
        if len(data.shape) > 1:
            data = data.mean(axis=1)

        # Ensure float32 format
        data = data.astype(np.float32)

        # Normalize amplitude if needed
        max_val = np.max(np.abs(data))
        if max_val > 0:
            data = data / max_val

        # device: cpu or cuda
        device = "cpu"
        compute_type = "int8"
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
                compute_type = "float16"
        except Exception:
            pass

        # Load Whisper model (base is fast and downloaded in cache)
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(
            data,
            language="en",
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        results = []
        idx = 1
        for segment in segments:
            results.append({
                "id": idx,
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip()
            })
            idx += 1

        print(json.dumps({
            "success": True,
            "segments": results,
            "language": info.language,
            "duration": round(info.duration, 2)
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "مسیر فایل ارسال نشده است."}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    transcribe(audio_path, model_size)
