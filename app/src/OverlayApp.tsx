import { useTimeout } from "@mantine/hooks";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import {
	PipecatClientProvider,
	usePipecatClient,
} from "@pipecat-ai/client-react";
import { ThemeProvider, UserAudioComponent } from "@pipecat-ai/voice-ui-kit";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { useCallback, useEffect, useRef, useState } from "react";
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

	// Keep client ref in sync (still needed since client comes from provider)
	useEffect(() => {
		clientRef.current = client;
	}, [client]);

	// TanStack Query hooks
	const { data: serverUrl } = useServerUrl();
	const typeTextMutation = useTypeText();
	const addHistoryEntry = useAddHistoryEntry();

	// Timeout to disconnect if no response in 10 seconds
	const { start: startResponseTimeout, clear: clearResponseTimeout } =
		useTimeout(() => {
			const currentState = useRecordingStore.getState();
			if (currentState.isWaitingForResponse) {
				console.log("Response timeout - disconnecting");
				setWaitingForResponse(false);
				clientRef.current?.disconnect().catch((error: unknown) => {
					console.error("Failed to disconnect on timeout:", error);
				});
			}
		}, 10000);

	const startRecording = useCallback(async () => {
		const currentClient = clientRef.current;
		const state = useRecordingStore.getState();
		if (state.isRecording || !currentClient || !serverUrl) return;

		setRecording(true);
		try {
			await currentClient.connect({ wsUrl: serverUrl });
		} catch (error) {
			console.error("Failed to connect:", error);
			setRecording(false);
		}
	}, [serverUrl, setRecording]);

	const stopRecording = useCallback(() => {
		const currentClient = clientRef.current;
		const state = useRecordingStore.getState();
		if (!state.isRecording || !currentClient) return;

		setRecording(false);
		setWaitingForResponse(true);

		// Tell server to flush the transcription buffer
		try {
			currentClient.sendClientMessage("stop-recording", {});
		} catch (error) {
			console.error("Failed to send stop-recording message:", error);
		}

		// Start timeout to disconnect if no response in 10 seconds
		startResponseTimeout();
	}, [setRecording, setWaitingForResponse, startResponseTimeout]);

	// Hotkey events from Rust backend - register ONCE
	useEffect(() => {
		let unlistenStart: (() => void) | undefined;
		let unlistenStop: (() => void) | undefined;

		const setup = async () => {
			unlistenStart = await tauriAPI.onStartRecording(() => {
				startRecording();
			});

			unlistenStop = await tauriAPI.onStopRecording(() => {
				stopRecording();
			});
		};

		setup();

		return () => {
			unlistenStart?.();
			unlistenStop?.();
		};
	}, [startRecording, stopRecording]);

	// Click handler (toggle mode)
	const handleClick = useCallback(() => {
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
	}, [isRecording, startRecording, stopRecording]);

	// Handle transcript and type text, then disconnect
	useEffect(() => {
		if (!client) return;

		const handleResponseReceived = async (text: string) => {
			// Clear the timeout since we got a response
			clearResponseTimeout();

			await typeTextMutation.mutateAsync(text);

			// Save to history
			addHistoryEntry.mutate(text);

			tauriAPI.setOverlayState("idle");

			// Disconnect after receiving response
			setWaitingForResponse(false);
			const currentClient = clientRef.current;
			if (currentClient) {
				try {
					await currentClient.disconnect();
				} catch (error) {
					console.error("Failed to disconnect after response:", error);
				}
			}
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
	);
}

export default function OverlayApp() {
	const [client, setClient] = useState<PipecatClient | null>(null);
	const [devicesReady, setDevicesReady] = useState(false);
	const { data: settings } = useSettings();

	useEffect(() => {
		const transport = new WebSocketTransport();
		const pipecatClient = new PipecatClient({
			transport,
			enableMic: true,
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
			pipecatClient.disconnect();
		};
	}, []);

	// Apply selected microphone when settings or client changes
	useEffect(() => {
		if (client && devicesReady && settings?.selected_mic_id) {
			console.log("Applying selected mic:", settings.selected_mic_id);
			client.updateMic(settings.selected_mic_id);
		}
	}, [client, devicesReady, settings?.selected_mic_id]);

	if (!client || !devicesReady) return null;

	return (
		<ThemeProvider>
			<PipecatClientProvider client={client}>
				<RecordingControl />
			</PipecatClientProvider>
		</ThemeProvider>
	);
}
