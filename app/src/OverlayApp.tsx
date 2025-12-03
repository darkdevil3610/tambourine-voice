import { Loader } from "@mantine/core";
import { useTimeout } from "@mantine/hooks";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import {
	PipecatClientProvider,
	usePipecatClient,
} from "@pipecat-ai/client-react";
import { ThemeProvider, UserAudioComponent } from "@pipecat-ai/voice-ui-kit";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import {
	useAddHistoryEntry,
	useServerUrl,
	useSettings,
	useTypeText,
} from "./lib/queries";
import { tauriAPI } from "./lib/tauri";
import { useRecordingStore } from "./stores/recordingStore";
import "./app.css";

function isTranscriptMessage(
	msg: unknown,
): msg is { type: "transcript"; text: string } {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"type" in msg &&
		"text" in msg &&
		(msg as { type: unknown }).type === "transcript" &&
		typeof (msg as { text: unknown }).text === "string"
	);
}

function RecordingControl() {
	const client = usePipecatClient();
	const { isRecording, setRecording, setWaitingForResponse } =
		useRecordingStore();
	const clientRef = useRef(client);
	const containerRef = useRef<HTMLDivElement>(null);
	const isConnectedRef = useRef(false);
	const isConnectingRef = useRef(false);

	// ResizeObserver to auto-resize window to fit content
	useEffect(() => {
		if (!containerRef.current) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			// Resize window to exactly match content
			tauriAPI.resizeOverlay(Math.ceil(width), Math.ceil(height));
		});

		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, []);

	// Keep client ref in sync (still needed since client comes from provider)
	useEffect(() => {
		clientRef.current = client;
	}, [client]);

	// TanStack Query hooks
	const { data: serverUrl } = useServerUrl();
	const typeTextMutation = useTypeText();
	const addHistoryEntry = useAddHistoryEntry();

	// Connect to server on startup when serverUrl is available
	useEffect(() => {
		const currentClient = clientRef.current;
		if (!currentClient || !serverUrl) return;
		if (isConnectedRef.current || isConnectingRef.current) return;

		const connectToServer = async () => {
			console.log("Connecting to server on startup:", serverUrl);
			isConnectingRef.current = true;
			try {
				await currentClient.connect({ wsUrl: serverUrl });
				// handleConnected will set isConnectedRef and mute mic
				console.log("Initial connection established");
			} catch (error) {
				console.error("Failed to connect on startup:", error);
				isConnectingRef.current = false;
			}
		};

		connectToServer();
	}, [serverUrl]);

	// Timeout to reset state if no response in 10 seconds
	const { start: startResponseTimeout, clear: clearResponseTimeout } =
		useTimeout(() => {
			const currentState = useRecordingStore.getState();
			if (currentState.isWaitingForResponse) {
				console.log("Response timeout - resetting state");
				setWaitingForResponse(false);
			}
		}, 10000);

	const startRecording = useCallback(() => {
		const currentClient = clientRef.current;

		if (!isConnectedRef.current || !currentClient) {
			console.log("Cannot start recording - not connected");
			return;
		}

		setRecording(true);
		// Signal server to reset buffer for new recording session
		try {
			currentClient.sendClientMessage("start-recording", {});
		} catch (error) {
			console.error("Failed to send start-recording message:", error);
		}
		// Unmute mic to start streaming audio
		currentClient.enableMic(true);
		console.log("Recording started, mic enabled");
	}, [setRecording]);

	const stopRecording = useCallback(() => {
		const currentClient = clientRef.current;
		const state = useRecordingStore.getState();
		if (!state.isRecording || !currentClient) return;

		setRecording(false);
		setWaitingForResponse(true);

		// Mute mic to stop streaming audio
		currentClient.enableMic(false);

		// Tell server to flush the transcription buffer and process
		try {
			currentClient.sendClientMessage("stop-recording", {});
		} catch (error) {
			console.error("Failed to send stop-recording message:", error);
		}

		// Start timeout to reset state if no response in 10 seconds
		startResponseTimeout();
		console.log("Recording stopped, mic disabled, waiting for response");
	}, [setRecording, setWaitingForResponse, startResponseTimeout]);

	// Effect events for stable handlers - always have access to latest values
	const onStartRecordingEvent = useEffectEvent(() => {
		console.log("recording-start event received");
		startRecording();
	});

	const onStopRecordingEvent = useEffectEvent(() => {
		console.log("recording-stop event received");
		stopRecording();
	});

	// Hotkey events from Rust backend - register ONCE
	useEffect(() => {
		let unlistenStart: (() => void) | undefined;
		let unlistenStop: (() => void) | undefined;

		const setup = async () => {
			console.log("Setting up event listeners...");
			unlistenStart = await tauriAPI.onStartRecording(onStartRecordingEvent);
			unlistenStop = await tauriAPI.onStopRecording(onStopRecordingEvent);
			console.log("Event listeners set up successfully");
		};

		setup();

		return () => {
			unlistenStart?.();
			unlistenStop?.();
		};
	}, []);

	// Click handler (toggle mode)
	const handleClick = useCallback(() => {
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
	}, [isRecording, startRecording, stopRecording]);

	// Track connection state via RTVI events and handle reconnection
	useEffect(() => {
		if (!client) return;

		const handleConnected = () => {
			console.log("RTVIEvent.Connected - WebSocket session established");
			isConnectedRef.current = true;
			isConnectingRef.current = false;
		};

		const handleDisconnected = () => {
			console.log("RTVIEvent.Disconnected - connection lost");
			isConnectedRef.current = false;
			isConnectingRef.current = false;

			// Reset any active recording state
			const state = useRecordingStore.getState();
			if (state.isRecording) {
				setRecording(false);
			}
			if (state.isWaitingForResponse) {
				setWaitingForResponse(false);
			}

			// Attempt reconnection after delay
			setTimeout(async () => {
				if (serverUrl && !isConnectedRef.current && !isConnectingRef.current) {
					console.log("Attempting reconnection...");
					isConnectingRef.current = true;
					try {
						await client.connect({ wsUrl: serverUrl });
					} catch (error) {
						console.error("Reconnection failed:", error);
						isConnectingRef.current = false;
					}
				}
			}, 2000);
		};

		client.on(RTVIEvent.Connected, handleConnected);
		client.on(RTVIEvent.Disconnected, handleDisconnected);

		return () => {
			client.off(RTVIEvent.Connected, handleConnected);
			client.off(RTVIEvent.Disconnected, handleDisconnected);
		};
	}, [client, serverUrl, setRecording, setWaitingForResponse]);

	// Handle transcript and type text
	useEffect(() => {
		if (!client) return;

		const handleResponseReceived = async (text: string) => {
			// Clear the timeout since we got a response
			clearResponseTimeout();

			await typeTextMutation.mutateAsync(text);

			// Save to history
			addHistoryEntry.mutate(text);

			// Reset waiting state - stay connected for next recording
			setWaitingForResponse(false);
			console.log("Response received and processed, ready for next recording");
		};

		const handleBotTranscript = async (data: { text?: string }) => {
			if (data.text) {
				await handleResponseReceived(data.text);
			}
		};

		const handleServerMessage = async (message: unknown) => {
			if (isTranscriptMessage(message)) {
				await handleResponseReceived(message.text);
			}
		};

		client.on(RTVIEvent.BotTranscript, handleBotTranscript);
		client.on(RTVIEvent.ServerMessage, handleServerMessage);

		return () => {
			client.off(RTVIEvent.BotTranscript, handleBotTranscript);
			client.off(RTVIEvent.ServerMessage, handleServerMessage);
		};
	}, [
		client,
		setWaitingForResponse,
		typeTextMutation,
		addHistoryEntry,
		clearResponseTimeout,
	]);

	return (
		<div
			ref={containerRef}
			data-tauri-drag-region
			style={{
				width: "fit-content",
				height: "fit-content",
				backgroundColor: "rgba(0, 0, 0, 0.9)",
				borderRadius: 12,
				padding: 4,
				cursor: "grab",
			}}
		>
			<UserAudioComponent
				onClick={handleClick}
				isMicEnabled={isRecording}
				noDevicePicker={true}
				noVisualizer={!isRecording}
				visualizerProps={{
					barColor: "#ffffff",
					backgroundColor: "#000000",
				}}
				classNames={{
					button: "bg-black text-white hover:bg-gray-900",
				}}
			/>
		</div>
	);
}

export default function OverlayApp() {
	console.log("=== OverlayApp RENDERING ===");
	const [client, setClient] = useState<PipecatClient | null>(null);
	const [devicesReady, setDevicesReady] = useState(false);
	const { data: settings } = useSettings();

	useEffect(() => {
		const transport = new WebSocketTransport();
		const pipecatClient = new PipecatClient({
			transport,
			enableMic: false, // Start muted, enable when recording
			enableCam: false,
		});
		setClient(pipecatClient);

		// Initialize devices to request permissions and enumerate mics
		pipecatClient
			.initDevices()
			.then(() => {
				console.log("Devices initialized");
				setDevicesReady(true);
			})
			.catch((error: unknown) => {
				console.error("Failed to initialize devices:", error);
				// Still set ready so UI shows, user can try again
				setDevicesReady(true);
			});

		return () => {
			pipecatClient.disconnect().catch(() => {
				// Ignore errors on cleanup - component is unmounting
			});
		};
	}, []);

	// Apply selected microphone when settings or client changes
	useEffect(() => {
		if (client && devicesReady && settings?.selected_mic_id) {
			console.log("Applying selected mic:", settings.selected_mic_id);
			client.updateMic(settings.selected_mic_id);
		}
	}, [client, devicesReady, settings?.selected_mic_id]);

	// Show loading state while initializing
	if (!client || !devicesReady) {
		return (
			<div
				className="flex items-center justify-center"
				style={{
					width: 48,
					height: 48,
					backgroundColor: "rgba(0, 0, 0, 0.9)",
					borderRadius: 12,
				}}
			>
				<Loader size="sm" color="white" />
			</div>
		);
	}

	return (
		<ThemeProvider>
			<PipecatClientProvider client={client}>
				<RecordingControl />
			</PipecatClientProvider>
		</ThemeProvider>
	);
}
