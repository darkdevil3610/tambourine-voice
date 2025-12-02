import {
	Container,
	Kbd,
	Space,
	Stack,
	Switch,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { History, Info, Settings } from "lucide-react";
import { DeviceSelector } from "./components/DeviceSelector";
import { HistoryPanel } from "./components/HistoryPanel";
import { HotkeyInput } from "./components/HotkeyInput";
import {
	useSettings,
	useUpdateHoldHotkey,
	useUpdateSoundEnabled,
	useUpdateToggleHotkey,
} from "./lib/queries";
import type { HotkeyConfig } from "./lib/tauri";
import "./styles.css";

function InstructionsPanel() {
	return (
		<Stack gap="md" pt="md">
			<div>
				<Text fw={500} size="lg" mb="xs">
					How to use:
				</Text>
				<Text>
					Press <Kbd>Ctrl</Kbd> + <Kbd>Alt</Kbd> + <Kbd>Space</Kbd> to toggle
					recording
				</Text>
				<Text>Or click the overlay to toggle recording</Text>
			</div>

			<div>
				<Text c="dimmed">
					The overlay appears in the bottom-right corner of your screen.
				</Text>
				<Text c="dimmed">
					Speak clearly, and your text will be typed where your cursor is.
				</Text>
			</div>
		</Stack>
	);
}

function SettingsPanel() {
	const { data: settings, isLoading } = useSettings();
	const updateSoundEnabled = useUpdateSoundEnabled();
	const updateToggleHotkey = useUpdateToggleHotkey();
	const updateHoldHotkey = useUpdateHoldHotkey();

	const handleSoundToggle = (checked: boolean) => {
		updateSoundEnabled.mutate(checked);
	};

	const handleToggleHotkeyChange = (config: HotkeyConfig) => {
		updateToggleHotkey.mutate(config);
	};

	const handleHoldHotkeyChange = (config: HotkeyConfig) => {
		updateHoldHotkey.mutate(config);
	};

	const defaultToggleHotkey: HotkeyConfig = {
		modifiers: ["ctrl", "alt"],
		key: "Space",
	};

	const defaultHoldHotkey: HotkeyConfig = {
		modifiers: ["ctrl", "alt"],
		key: "Period",
	};

	return (
		<Stack gap="lg" pt="md">
			<DeviceSelector />

			<Switch
				label="Sound feedback"
				description="Play sounds when recording starts and stops"
				checked={settings?.sound_enabled ?? true}
				onChange={(event) => handleSoundToggle(event.currentTarget.checked)}
				disabled={isLoading}
			/>

			<HotkeyInput
				label="Toggle Recording"
				description="Press once to start recording, press again to stop"
				value={settings?.toggle_hotkey ?? defaultToggleHotkey}
				onChange={handleToggleHotkeyChange}
				disabled={isLoading}
			/>

			<HotkeyInput
				label="Hold to Record"
				description="Hold to record, release to stop"
				value={settings?.hold_hotkey ?? defaultHoldHotkey}
				onChange={handleHoldHotkeyChange}
				disabled={isLoading}
			/>

			<Text size="xs" c="orange" mt="sm">
				Note: Hotkey changes require app restart to take effect.
			</Text>
		</Stack>
	);
}

export default function App() {
	return (
		<Container size="sm" p="md">
			<Title order={2} mb="md">
				Voice Dictation
			</Title>

			<Tabs defaultValue="instructions">
				<Tabs.List>
					<Tabs.Tab value="instructions" leftSection={<Info size={16} />}>
						Instructions
					</Tabs.Tab>
					<Tabs.Tab value="settings" leftSection={<Settings size={16} />}>
						Settings
					</Tabs.Tab>
					<Tabs.Tab value="history" leftSection={<History size={16} />}>
						History
					</Tabs.Tab>
				</Tabs.List>

				<Space h="md" />

				<Tabs.Panel value="instructions">
					<InstructionsPanel />
				</Tabs.Panel>

				<Tabs.Panel value="settings">
					<SettingsPanel />
				</Tabs.Panel>

				<Tabs.Panel value="history">
					<HistoryPanel />
				</Tabs.Panel>
			</Tabs>
		</Container>
	);
}
