import base64
import io
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Gemini's documented audio inputs are WAV / MP3 / AIFF / AAC / OGG / FLAC.
# The browser's MediaRecorder normally hands us audio/webm (opus), which
# isn't on that list, so we transcode to WAV first with pydub (needs the
# ffmpeg binary on PATH - see requirements.txt note).
SUPPORTED_INLINE_MIME_TYPES = {
    "audio/wav": "wav",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/aiff": "aiff",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
}


class STTService:
    """
    Speech-to-Text via Gemini's native audio understanding
    (no separate Whisper/OpenAI key needed - reuses GEMINI_API_KEY,
    same as the rest of the app's LLM calls).
    """

    def __init__(self):
        self.api_key = (
            os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        )
        self.model = os.getenv("GEMINI_STT_MODEL", "gemini-2.5-flash")
        self.client = self._initialize_client()

    def _initialize_client(self):
        if not self.api_key:
            logger.warning(
                "GEMINI_API_KEY/GOOGLE_API_KEY is missing. STTService "
                "will return NOT_CONFIGURED errors until it is set."
            )
            return None

        try:
            from google import genai

            return genai.Client(api_key=self.api_key)

        except Exception as exc:
            logger.exception(
                "Failed to initialize Gemini client for STT: %s", exc
            )
            return None

    @property
    def is_configured(self) -> bool:
        return self.client is not None

    def _to_wav_bytes(self, audio_bytes: bytes) -> bytes:
        """
        Best-effort transcode of whatever the browser sent (webm/opus,
        ogg/opus, etc.) into WAV, which Gemini officially supports.
        Falls back to the raw bytes if pydub/ffmpeg aren't available -
        Gemini may still accept it, just outside documented support.
        """

        try:
            from pydub import AudioSegment

            segment = AudioSegment.from_file(io.BytesIO(audio_bytes))
            out = io.BytesIO()
            segment.export(out, format="wav")
            return out.getvalue()

        except Exception as exc:
            logger.warning(
                "Audio transcode to WAV failed (%s); sending original "
                "bytes as-is.",
                exc,
            )
            return audio_bytes

    def transcribe_base64_audio(
        self,
        audio_base64: str,
        filename: str = "answer.webm",
    ) -> dict:
        """
        Decode base64 audio (as sent from the browser MediaRecorder),
        transcode to WAV, and transcribe it via Gemini.

        Returns a dict:
          { "success": bool, "text": str, "error": Optional[str] }
        """

        if not self.is_configured:
            return {
                "success": False,
                "text": "",
                "error": "STT_NOT_CONFIGURED",
            }

        if "," in audio_base64 and audio_base64.strip().startswith("data:"):
            audio_base64 = audio_base64.split(",", 1)[1]

        try:
            audio_bytes = base64.b64decode(audio_base64)
        except Exception as exc:
            logger.warning("Failed to decode base64 audio: %s", exc)
            return {
                "success": False,
                "text": "",
                "error": "INVALID_AUDIO_ENCODING",
            }

        if not audio_bytes or len(audio_bytes) < 100:
            return {
                "success": False,
                "text": "",
                "error": "EMPTY_AUDIO",
            }

        wav_bytes = self._to_wav_bytes(audio_bytes)

        try:
            from google.genai import types

            response = self.client.models.generate_content(
                model=self.model,
                contents=[
                    (
                        "Transcribe this audio exactly as spoken, word "
                        "for word. Return ONLY the transcript text, "
                        "with no preamble, labels, or commentary. If "
                        "the audio is silent or unintelligible, return "
                        "an empty string."
                    ),
                    types.Part.from_bytes(
                        data=wav_bytes,
                        mime_type="audio/wav",
                    ),
                ],
            )

            text = (getattr(response, "text", "") or "").strip()

            if not text:
                return {
                    "success": False,
                    "text": "",
                    "error": "UNCLEAR_AUDIO",
                }

            return {
                "success": True,
                "text": text,
                "error": None,
            }

        except Exception as exc:
            logger.exception("Gemini STT transcription failed: %s", exc)
            return {
                "success": False,
                "text": "",
                "error": "TRANSCRIPTION_FAILED",
            }


_stt_service = None


def get_stt_service() -> STTService:
    global _stt_service

    if _stt_service is None:
        _stt_service = STTService()

    return _stt_service