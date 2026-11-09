"""Local CPU STT sidecar: faster-whisper (default provider for RV0.2.0).

Usage: python3 stt_faster_whisper.py <wav16k-path> [model]
Reads a 16 kHz mono WAV, prints one JSON line: {"text": "...", "language": "zh"}.
The model (default "tiny", ~75 MB) auto-downloads from Hugging Face on first
use into the HF cache. No key, no GPU. Language defaults to zh (robot speaks
Chinese); override with VOICE_STT_LANGUAGE.

The server always feeds this script a 16 kHz mono PCM WAV, so the audio is
decoded with the Python stdlib `wave` module and passed to faster-whisper as
a float32 ndarray. This deliberately avoids faster-whisper's PyAV decode
path: faster-whisper 1.2.1 calls av.open(..., metadata_errors=...) which
current PyAV (>=15, e.g. 19.0.2) no longer accepts, and older PyAV wheels
do not build on this host.
"""

import json
import os
import sys
import wave


def read_wav16k_mono(path: str):
    """Decode a 16 kHz mono WAV to a float32 numpy array (faster-whisper's
    ndarray input path, which skips its PyAV decode entirely)."""
    import numpy as np

    with wave.open(path, "rb") as wav:
        if wav.getnchannels() != 1 or wav.getframerate() != 16000:
            raise ValueError(
                f"expected 16 kHz mono WAV, got {wav.getnchannels()}ch "
                f"{wav.getframerate()} Hz"
            )
        frames = wav.readframes(wav.getnframes())
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    return samples


def main() -> int:
    wav_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "tiny"
    language = os.environ.get("VOICE_STT_LANGUAGE", "zh") or "zh"
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    audio = read_wav16k_mono(wav_path)
    segments, info = model.transcribe(audio, language=language, beam_size=5)
    text = "".join(segment.text for segment in segments).strip()
    print(json.dumps({"text": text, "language": info.language or language}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
