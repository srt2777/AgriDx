"""Check protocol isolation and model reuse without downloading model weights."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "server/voice/stt_sensevoice.py"


class SenseVoiceWorkerTests(unittest.TestCase):
    def test_noisy_model_is_loaded_once_and_recovers_after_bad_request(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "funasr.py").write_text("""
import os
print("import log")
os.write(1, b"native import log\\n")
class AutoModel:
    def __init__(self, **kwargs):
        print("model loaded")
        assert kwargs["disable_update"]
    def generate(self, input):
        print("inference log")
        os.write(1, b"native inference log\\n")
        if input == "bad":
            raise ValueError("broken audio")
        return [{"text": "<|zh|><|NEUTRAL|>检查水温"}]
""")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--worker"],
                input='{"wavPath":"one"}\n{"wavPath":"bad"}\n{"wavPath":"two"}\n',
                text=True, capture_output=True, timeout=10,
                env={**os.environ, "PYTHONPATH": directory},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            output = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(output, [
                {"text": "检查水温", "language": "zh"},
                {"failed": True},
                {"text": "检查水温", "language": "zh"},
            ])
            self.assertEqual(result.stderr.count("model loaded"), 1)
            self.assertIn("native import log", result.stderr)


if __name__ == "__main__":
    unittest.main()
