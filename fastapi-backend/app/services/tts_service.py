import base64
import io
import logging
import os
import wave

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class TTSService:
    """
    Text-to-Speech via Gemini's native TTS models (reuses
    GEMINI_API_KEY/GOOGLE_API_KEY - no separate OpenAI key needed).

    Gemini TTS returns raw 16-bit PCM audio at 24kHz mono. We wrap
    that in a proper WAV header before base64-encoding it, so the
    frontend can just drop it into an <audio> element as-is.
    """

    def __init__(self):
        self.api_key = (
            os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        )
        self.model = os.getenv(
            "GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts"
        )
        self.voice = os.getenv("GEMINI_TTS_VOICE", "Kore")
        self.client = self._initialize_client()

    def _initialize_client(self):
        if not self.api_key:
            logger.warning(
                "GEMINI_API_KEY/GOOGLE_API_KEY is missing. TTSService "
                "will return NOT_CONFIGURED errors until it is set."
            )
            return None

        try:
            from google import genai

            return genai.Client(api_key=self.api_key)

        except Exception as exc:
            logger.exception(
                "Failed to initialize Gemini client for TTS: %s", exc
            )
            return None

    @property
    def is_configured(self) -> bool:
        return self.client is not None

    def _pcm_to_wav_bytes(
        self,
        pcm_bytes: bytes,
        channels: int = 1,
        rate: int = 24000,
        sample_width: int = 2,
    ) -> bytes:

        buffer = io.BytesIO()

        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(rate)
            wf.writeframes(pcm_bytes)

        return buffer.getvalue()

    def synthesize_to_base64(self, text: str) -> dict:
        """
        Convert examiner text to speech.

        Returns a dict:
          { "success": bool, "audio_base64": str, "format": str, "error": Optional[str] }
        """

        text = (text or "").strip()

        if not text:
            return {
                "success": False,
                "audio_base64": "",
                "format": "wav",
                "error": "EMPTY_TEXT",
            }

        if not self.is_configured:
            return {
                "success": False,
                "audio_base64": "",
                "format": "wav",
                "error": "TTS_NOT_CONFIGURED",
            }

        try:
            from google.genai import types

            response = self.client.models.generate_content(
                model=self.model,
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=self.voice,
                            )
                        )
                    ),
                ),
            )

            pcm_bytes = (
                response.candidates[0].content.parts[0].inline_data.data
            )

            wav_bytes = self._pcm_to_wav_bytes(pcm_bytes)
            audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")

            return {
                "success": True,
                "audio_base64": audio_base64,
                "format": "wav",
                "error": None,
            }

        except Exception as exc:
            logger.exception("Gemini TTS synthesis failed: %s", exc)
            return {
                "success": False,
                "audio_base64": "",
                "format": "wav",
                "error": "TTS_SYNTHESIS_FAILED",
            }


_tts_service = None


def get_tts_service() -> TTSService:
    global _tts_service

    if _tts_service is None:
        _tts_service = TTSService()

    return _tts_service