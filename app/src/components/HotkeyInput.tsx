import { Badge, Group, Paper, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useCallback } from "react";
import type { HotkeyConfig } from "../lib/tauri";

interface HotkeyInputProps {
	label: string;
	description?: string;
	value: HotkeyConfig;
	onChange: (config: HotkeyConfig) => void;
	disabled?: boolean;
}

function parseKeyEvent(event: KeyboardEvent): HotkeyConfig | null {
	const modifiers: string[] = [];

	if (event.ctrlKey) modifiers.push("ctrl");
	if (event.altKey) modifiers.push("alt");
	if (event.shiftKey) modifiers.push("shift");
	if (event.metaKey) modifiers.push("meta");

	// Get the key name
	const key = event.code
		.replace("Key", "")
		.replace("Digit", "")
		.replace("Numpad", "Numpad");

	// Don't capture modifier-only keypresses
	if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
		return null;
	}

	// Require at least one modifier
	if (modifiers.length === 0) {
		return null;
	}

	return { modifiers, key };
}

export function HotkeyInput({
	label,
	description,
	value,
	onChange,
	disabled,
}: HotkeyInputProps) {
	const [isCapturing, { open: startCapture, close: stopCapture }] =
		useDisclosure(false);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (!isCapturing) return;

			event.preventDefault();
			event.stopPropagation();

			const config = parseKeyEvent(event.nativeEvent);
			if (config) {
				onChange(config);
				stopCapture();
			}
		},
		[isCapturing, onChange, stopCapture],
	);

	const handleBlur = useCallback(() => {
		stopCapture();
	}, [stopCapture]);

	const handleClick = useCallback(() => {
		if (!disabled) {
			startCapture();
		}
	}, [disabled, startCapture]);

	return (
		<div>
			<Text size="sm" fw={500} mb={4}>
				{label}
			</Text>
			{description && (
				<Text size="xs" c="dimmed" mb={8}>
					{description}
				</Text>
			)}
			<UnstyledButton
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
				disabled={disabled}
				style={{ width: "100%" }}
			>
				<Paper
					p="sm"
					withBorder
					style={{
						cursor: disabled ? "not-allowed" : "pointer",
						opacity: disabled ? 0.5 : 1,
						backgroundColor: isCapturing
							? "var(--mantine-color-blue-light)"
							: undefined,
					}}
				>
					<Group justify="space-between">
						<Group gap="xs">
							{isCapturing ? (
								<Text size="sm" c="blue">
									Press a key combination...
								</Text>
							) : (
								value.modifiers.concat([value.key]).map((part) => (
									<Badge key={part} variant="light">
										{part.charAt(0).toUpperCase() + part.slice(1)}
									</Badge>
								))
							)}
						</Group>
						{!isCapturing && (
							<Text size="xs" c="dimmed">
								Click to change
							</Text>
						)}
					</Group>
				</Paper>
			</UnstyledButton>
		</div>
	);
}
