"""Custom frame processors for voice dictation."""

from processors.llm_cleanup import LLMResponseToRTVIConverter, TranscriptionToLLMConverter

__all__ = ["LLMResponseToRTVIConverter", "TranscriptionToLLMConverter"]
