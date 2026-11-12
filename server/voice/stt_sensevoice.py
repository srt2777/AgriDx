"""SenseVoice sidecar with a reusable model and a clean JSON protocol.

Usage: stt_sensevoice.py <wav-path|--worker> [model-id-or-local-directory]
Worker mode accepts one {"wavPath": "..."} JSON object per input line.
Model timing and recognition accuracy require validation on the deployment host.
"""

import json
import os
import re
import sys

_TOKEN_RE = re.compile(r"<\|[^|]*\|>")


def transcribe(model, wav_path):
    results = model.generate(input=wav_path)
    raw = str(results[0].get("text", "") or "") if results else ""
    return {"text": _TOKEN_RE.sub("", raw).strip(), "language": "zh"}


def main():
    target = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "iic/SenseVoiceSmall"
    # Redirect native and Python library logs before importing FunASR. Only the
    # dedicated descriptor can write protocol results to the parent process.
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1) as protocol:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        from funasr import AutoModel

        model = AutoModel(model=model_name, device="cpu", disable_update=True,
                          disable_pbar=True)
        if target != "--worker":
            print(json.dumps(transcribe(model, target), ensure_ascii=False), file=protocol)
            return 0
        for line in sys.stdin:
            try:
                request = json.loads(line)
                result = transcribe(model, request["wavPath"])
            except Exception as error:
                print(f"STT request failed ({type(error).__name__})", file=sys.stderr)
                result = {"failed": True}
            print(json.dumps(result, ensure_ascii=False), file=protocol)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
