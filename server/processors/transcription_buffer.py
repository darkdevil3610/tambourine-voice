"""Transcription buffer processor for dictation.

Buffers transcription text until the user explicitly stops recording,
then emits a single consolidated transcription for LLM cleanup.
"""

from datetime import UTC, datetime
from typing import Any

from pipecat.frames.frames import Frame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIClientMessageFrame
from pipecat.transcriptions.language import Language

from utils.logger import logger


class TranscriptionBufferProcessor(FrameProcessor):
    """Buffers transcriptions until user stops recording.

    This processor accumulates transcription text from partial STT results
    and emits a single consolidated TranscriptionFrame when the client sends
    a 'stop-recording' message. This allows the LLM cleanup to process
    complete utterances instead of fragments.
    """

    def __init__(self, **kwargs: Any) -> None:
        """Initialize the transcription buffer processor."""
        super().__init__(**kwargs)
        self._buffer: str = ""
        self._last_user_id: str = "user"
        self._last_language: Language | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Process frames, buffering transcriptions until stop-recording message.

        Args:
            frame: The frame to process
            direction: The direction of frame flow
        """
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            # Accumulate transcription text and save metadata
            text = frame.text
            if text:
                self._buffer += text
                self._last_user_id = frame.user_id
                self._last_language = frame.language
                logger.debug(f"Buffered transcription: '{text}' (total: '{self._buffer}')")
            # Don't push TranscriptionFrame - we'll emit consolidated version later
            return

        if isinstance(frame, RTVIClientMessageFrame):
            if frame.type == "start-recording":
                # New recording session - reset buffer
                logger.info("Start-recording received, resetting buffer")
                self._buffer = ""
                self._last_user_id = "user"
                self._last_language = None
                return

            if frame.type == "stop-recording":
                # Client explicitly stopped recording - flush the buffer
                if self._buffer.strip():
                    logger.info(
                        f"Stop-recording received, flushing buffer: '{self._buffer.strip()}'"
                    )
                    timestamp = datetime.now(UTC).isoformat()
                    consolidated_frame = TranscriptionFrame(
                        text=self._buffer.strip(),
                        user_id=self._last_user_id,
                        timestamp=timestamp,
                        language=self._last_language,
                    )
                    await self.push_frame(consolidated_frame, direction)
                    self._buffer = ""
                else:
                    logger.info("Stop-recording received but buffer is empty")
                # Don't pass through the client message frame
                return

        # Pass through all other frames unchanged
        await self.push_frame(frame, direction)
