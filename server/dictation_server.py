#!/usr/bin/env python3
"""Voice Dictation Server - WebSocket-based Pipecat Server.

A WebSocket server that receives audio from an Electron client,
processes it through STT and LLM cleanup, and returns cleaned text.

Usage:
    python dictation_server.py
    python dictation_server.py --port 8765
"""

import asyncio
from typing import Any

import typer
from loguru import logger
from pipecat.frames.frames import Frame, OutputTransportMessageFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.transports.websocket.server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

from config.settings import Settings
from processors.llm_cleanup import LLMCleanupProcessor
from processors.transcription_buffer import TranscriptionBufferProcessor
from services.llm_service import create_llm_service
from services.stt_service import create_stt_service
from utils.logger import configure_logging

# CLI app
app = typer.Typer(help="Voice dictation WebSocket server")


class TextResponseProcessor(FrameProcessor):
    """Processor that logs message frames being sent back to the client.

    This processor sits at the end of the pipeline before transport.output()
    to log the final cleaned text being sent to the Electron client.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Process frames and log OutputTransportMessageFrames.

        Args:
            frame: The frame to process
            direction: The direction of frame flow
        """
        await super().process_frame(frame, direction)

        if isinstance(frame, OutputTransportMessageFrame):
            data = frame.message.get("data", {})
            text = data.get("text", "")
            logger.info(f"Sending to client: '{text}'")

        await self.push_frame(frame, direction)


async def run_server(host: str, port: int, settings: Settings) -> None:
    """Run the WebSocket dictation server.

    Args:
        host: Host to bind to
        port: Port to listen on
        settings: Application settings
    """
    logger.info(f"Starting WebSocket server on ws://{host}:{port}")

    # Create WebSocket transport with protobuf serializer for pipecat-ai/client-js compatibility
    # No VAD - buffer flushes when client sends stop-recording message
    transport = WebsocketServerTransport(
        host=host,
        port=port,
        params=WebsocketServerParams(
            audio_in_enabled=True,
            audio_out_enabled=False,  # No audio output for dictation
            serializer=ProtobufFrameSerializer(),  # Required for @pipecat-ai/websocket-transport
        ),
    )

    # Initialize services
    stt_service = create_stt_service(settings)
    llm_service = create_llm_service(settings)

    # Initialize processors
    transcription_buffer = TranscriptionBufferProcessor()
    llm_cleanup = LLMCleanupProcessor(llm_service=llm_service)
    text_response = TextResponseProcessor()

    # Build pipeline: Audio -> STT -> Buffer -> LLM Cleanup -> Text Response -> Output
    # The buffer accumulates partial transcriptions until client sends stop-recording
    pipeline = Pipeline(
        [
            transport.input(),  # Audio from Electron client
            stt_service,  # Speech-to-text (produces partial transcriptions)
            transcription_buffer,  # Buffer until user stops speaking
            llm_cleanup,  # LLM-based text cleanup
            text_response,  # Log outgoing text
            transport.output(),  # Send text back to client
        ]
    )

    # Create pipeline task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=False,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=None,  # Disable idle timeout - client manages connection
    )

    # Set up event handlers
    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport: Any, client: Any) -> None:
        logger.info(f"Client connected: {client}")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport: Any, client: Any) -> None:
        logger.info(f"Client disconnected: {client}")

    # Run the server
    runner = PipelineRunner(handle_sigint=True)

    logger.info("=" * 60)
    logger.success("Voice Dictation Server Ready!")
    logger.info("=" * 60)
    logger.info(f"WebSocket endpoint: ws://{host}:{port}")
    logger.info("Waiting for Electron client connection...")
    logger.info("Press Ctrl+C to stop")
    logger.info("=" * 60)

    try:
        await runner.run(task)
    except asyncio.CancelledError:
        logger.info("Server stopped")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise


@app.command()
def main(
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        "-h",
        help="Host to bind to",
    ),
    port: int = typer.Option(
        8765,
        "--port",
        "-p",
        help="Port to listen on",
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose",
        "-v",
        help="Enable verbose logging",
    ),
) -> None:
    """Start the voice dictation WebSocket server.

    Examples:
        dictation-server
        dictation-server --port 9000
        dictation-server --host 0.0.0.0 --port 8765
    """
    # Configure logging
    configure_logging()

    if verbose:
        logger.info("Verbose logging enabled")

    # Load settings
    try:
        settings = Settings()
    except Exception as e:
        logger.error(f"Configuration error: {e}")
        logger.warning("Please check your .env file and ensure all required API keys are set.")
        logger.info("See .env.example for reference.")
        raise typer.Exit(1) from e

    # Run server
    try:
        asyncio.run(run_server(host, port, settings))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")


if __name__ == "__main__":
    app()
