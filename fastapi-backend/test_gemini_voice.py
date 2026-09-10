"""
Standalone test for Gemini STT + TTS — run this BEFORE testing
through the browser/WebSocket, to isolate whether Gemini itself
is working correctly.

Usage:
    cd fastapi-backend
    python test_gemini_voice.py

Requires GEMINI_API_KEY (or GOOGLE_API_KEY) set in your .env,
and a sample .wav/.mp3 file to test STT against.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.stt_service import get_stt_service
from app.services.tts_service import get_tts_service


def test_tts():
    print("\n=== Testing TTS (text -> voice) ===")
    tts = get_tts_service()

    if not tts.is_configured:
        print("FAILED: TTS not configured. Check GEMINI_API_KEY in .env")
        return None

    result = tts.synthesize_to_base64(
        "Hello, this is a test of the viva examiner voice."
    )

    if not result["success"]:
        print(f"FAILED: {result['error']}")
        return None

    print(f"SUCCESS: got {len(result['audio_base64'])} base64 chars, "
          f"format={result['format']}")

    # Save it so you can actually listen to it
    import base64
    out_path = "test_output.wav"
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(result["audio_base64"]))

    print(f"Saved to {out_path} — play this file to confirm it's real speech.")
    return out_path


def test_stt(audio_file_path=None):
    print("\n=== Testing STT (voice -> text) ===")
    stt = get_stt_service()

    if not stt.is_configured:
        print("FAILED: STT not configured. Check GEMINI_API_KEY in .env")
        return

    if not audio_file_path or not os.path.exists(audio_file_path):
        print("SKIPPED: no audio file provided. Pass a path to a .wav/.mp3 "
              "file as the first argument, e.g.:")
        print("  python test_gemini_voice.py test_output.wav")
        return

    import base64
    with open(audio_file_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    result = stt.transcribe_base64_audio(audio_b64, filename=audio_file_path)

    if not result["success"]:
        print(f"FAILED: {result['error']}")
        return

    print(f"SUCCESS: transcript = \"{result['text']}\"")


if __name__ == "__main__":
    tts_output = test_tts()

    # If no audio file given on the command line, test STT using
    # the TTS output we just generated (round-trip test).
    audio_arg = sys.argv[1] if len(sys.argv) > 1 else tts_output

    test_stt(audio_arg)