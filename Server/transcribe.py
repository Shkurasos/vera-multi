"""Local speech recognition; stdout is reserved for the JSON response."""
import contextlib
import json
import os
import sys

with contextlib.redirect_stdout(sys.stderr):
    import whisper

    model = whisper.load_model(os.environ.get("WHISPER_MODEL", "base"), device="cpu")
    result = model.transcribe(sys.argv[1], fp16=False, verbose=None)

print(json.dumps({"text": result["text"]}, ensure_ascii=False))