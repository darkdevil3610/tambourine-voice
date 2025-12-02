import {
	ActionIcon,
	Button,
	Group,
	ScrollArea,
	Stack,
	Table,
	Text,
	Tooltip,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { Copy, Trash2 } from "lucide-react";
import {
	useClearHistory,
	useDeleteHistoryEntry,
	useHistory,
} from "../lib/queries";

function formatTimestamp(timestamp: string): string {
	const date = new Date(timestamp);
	return date.toLocaleString();
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...`;
}

export function HistoryPanel() {
	const { data: history, isLoading, error } = useHistory(100);
	const deleteEntry = useDeleteHistoryEntry();
	const clearHistory = useClearHistory();
	const clipboard = useClipboard();

	const handleDelete = (id: string) => {
		deleteEntry.mutate(id);
	};

	const handleClearAll = () => {
		if (window.confirm("Are you sure you want to clear all history?")) {
			clearHistory.mutate();
		}
	};

	if (isLoading) {
		return (
			<Stack gap="md" pt="md">
				<Text c="dimmed">Loading history...</Text>
			</Stack>
		);
	}

	if (error) {
		return (
			<Stack gap="md" pt="md">
				<Text c="red">Failed to load history</Text>
			</Stack>
		);
	}

	if (!history || history.length === 0) {
		return (
			<Stack gap="md" pt="md">
				<Text c="dimmed">No dictation history yet.</Text>
				<Text size="sm" c="dimmed">
					Your transcribed text will appear here after you use voice dictation.
				</Text>
			</Stack>
		);
	}

	return (
		<Stack gap="md" pt="md">
			<Group justify="space-between">
				<Text size="sm" c="dimmed">
					{history.length} {history.length === 1 ? "entry" : "entries"}
				</Text>
				<Button
					variant="subtle"
					color="red"
					size="xs"
					onClick={handleClearAll}
					disabled={clearHistory.isPending}
				>
					Clear All
				</Button>
			</Group>

			<ScrollArea h={250}>
				<Table striped highlightOnHover>
					<Table.Thead>
						<Table.Tr>
							<Table.Th>Time</Table.Th>
							<Table.Th>Text</Table.Th>
							<Table.Th w={80}>Actions</Table.Th>
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{history.map((entry) => (
							<Table.Tr key={entry.id}>
								<Table.Td>
									<Text size="xs" c="dimmed">
										{formatTimestamp(entry.timestamp)}
									</Text>
								</Table.Td>
								<Table.Td>
									<Tooltip label={entry.text} multiline maw={300}>
										<Text size="sm">{truncateText(entry.text, 50)}</Text>
									</Tooltip>
								</Table.Td>
								<Table.Td>
									<Group gap="xs">
										<Tooltip label="Copy to clipboard">
											<ActionIcon
												variant="subtle"
												size="sm"
												onClick={() => clipboard.copy(entry.text)}
											>
												<Copy size={14} />
											</ActionIcon>
										</Tooltip>
										<Tooltip label="Delete">
											<ActionIcon
												variant="subtle"
												color="red"
												size="sm"
												onClick={() => handleDelete(entry.id)}
												loading={deleteEntry.isPending}
											>
												<Trash2 size={14} />
											</ActionIcon>
										</Tooltip>
									</Group>
								</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</ScrollArea>
		</Stack>
	);
}
