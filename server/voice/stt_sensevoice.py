"""Local CPU STT sidecar: FunAudioLLM SenseVoice-Small (UNVERIFIED adapter).

Usage: python3 stt_sensevoice.py <wav16k-path> [ignored-model-arg]
Reads a 16 kHz mono WAV (<=30 s per upstream contract), prints one JSON line:
{"text": "...", "language": "zh"}.

Upstream facts (SenseVoice README / FunASR docs, checked 2026-11-10):
- SenseVoiceSmall is 234M params, non-autoregressive; upstream reports ~17x
  realtime on CPU, so no GPU is required in principle.
- Needs `pip install funasr` (+ torch) and a model download from ModelScope
  (iic/SenseVoiceSmall, ~470 MB fp16); no API key.
- This adapter is implemented but NOT installed or run on this host (torch +
  model would be several GB). The deploy host must install funasr, download
  the model once, and verify with a real WAV before setting
  VOICE_STT_PROVIDER=sensevoice. Do not claim SenseVoice is deployed until
  that verification exists.
"""

import json
import re
import sys

_TOKEN_RE = re.compile(r"<\|[^|]*\|>")


def main() -> int:
    wav_path = sys.argv[1]
    from funasr import AutoModel

    model = AutoModel(model="iic/SenseVoiceSmall", device="cpu")
    results = model.generate(input=wav_path)
    text = ""
    if results:
        raw = str(results[0].get("text", "") or "")
        text = _TOKEN_RE.sub("", raw).strip()
    print(json.dumps({"text": text, "language": "zh"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
