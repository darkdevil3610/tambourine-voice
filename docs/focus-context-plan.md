# Focus Context Capture + Prompt Injection (Windows + macOS)

## Summary
Add a cross-platform, best-effort focus context snapshot in the Tauri backend. The backend continuously pushes the newest focus context to the TypeScript frontend (instant access for UI/logic). The frontend only sends focus context to the Python server when recording starts. The server stores the latest focus context per connection and injects it into the LLM system prompt at the start of each recording. Browser tab URL/title are attempted when possible; if unavailable, they are omitted with low confidence metadata.

## High-Level Flow
1. Tauri focus watcher detects changes and emits `focus://context-changed` to the frontend.
2. Frontend maintains `latestFocusContext` in memory for instant access.
3. On recording start, frontend sends `latestFocusContext` to the server via RTVI.
4. Server stores the snapshot and injects it into the system prompt for that recording.

## Public API / Interface Changes
1. Tauri commands (new):
- `focus_get_current_context`: returns a `FocusContextSnapshot` payload (used for immediate fetch if needed).
- `focus_get_capabilities`: returns `FocusTrackingCapabilities` (compile-time + runtime best-effort).

2. Tauri event stream (new):
- `focus://context-changed` event carrying `FocusContextSnapshot` payloads to the TypeScript frontend.

3. RTVI client message (new):
- `type: "focus-context"` with `data: FocusContextSnapshot`.

4. Server prompt injection:
- `DictationContextManager` appends a `Focus Context` system message when available.

## Implementation Plan

### 1) Define Focus Types (shared shape)

Rust (Tauri)
- Create `app/src-tauri/src/focus/` with:
  - `FocusContextSnapshot`
    - `focused_application`: `{ display_name, bundle_id?, process_path? } | None`
    - `focused_window`: `{ title } | None`
    - `focused_browser_tab`: `{ title?, url?, browser? } | None`
    - `event_source`: `"polling" | "accessibility" | "uia" | "unknown"`
    - `confidence_level`: `"high" | "medium" | "low"`
    - `privacy_filtered`: `bool`
    - `captured_at`: ISO string or epoch millis
  - `FocusTrackingCapabilities`
    - `supports_focused_application_detection`
    - `supports_focused_window_detection`
    - `supports_focused_browser_tab_detection`
    - `supports_realtime_event_streaming` (always `false` for this MVP)
    - `supports_private_browsing_detection` (initially `false`)

Python (server)
- Add the same shape in `server/protocol/messages.py`:
  - `FocusedApplication`, `FocusedWindow`, `FocusedBrowserTab`
  - `FocusEventSource`, `FocusConfidenceLevel`
  - `FocusContextSnapshot`
  - `FocusContextMessage` with `type: "focus-context"` and `data: FocusContextSnapshot`

### 2) Platform Libraries and APIs (explicit choices)

Windows
- Win32:
  - `GetForegroundWindow`, `GetWindowTextW`
  - `GetWindowThreadProcessId`, `OpenProcess`, `QueryFullProcessImageNameW`
- UI Automation (accessibility tree, no screenshots):
  - Use `IUIAutomation` to traverse the focused window subtree
  - Browser adapters for Chromium-based browsers first (Chrome, Edge, Brave, Opera)

macOS
- Rust crates:
  - `objc2`, `objc2-foundation`, `objc2-app-kit`, `objc2-accessibility`
  - `core-foundation`, `core-graphics`
- APIs:
  - `NSWorkspace.sharedWorkspace.frontmostApplication`
  - `AXUIElement`, `AXObserver` for focused window/element

### 3) Tauri Backend: Windows + macOS Snapshot

Windows (new file `app/src-tauri/src/focus/windows.rs`)
- Use `GetForegroundWindow` -> `GetWindowTextW` for window title.
- Use `GetWindowThreadProcessId` -> `OpenProcess` + `QueryFullProcessImageNameW` for process path + display name.
- Browser tab best-effort:
  - UI Automation (UIA) reads the accessibility tree, not screenshots or pixel scraping.
  - If process name is in `[chrome, msedge, brave, opera]`, attempt UI Automation (UIA) to locate address bar and tab title.
  - If UIA is unavailable or fails, fall back to window title only.
- Set `event_source` to `uia` if UIA succeeds, else `polling`.
- `confidence_level`: `high` for app/window, `medium` for tab title from window title, `low` if URL missing.

macOS (new file `app/src-tauri/src/focus/macos.rs`)
- Use `NSWorkspace.sharedWorkspace.frontmostApplication` to get app name + bundle ID.
- Use Accessibility (`AXUIElement`) to get focused window title.
- Browser tab best-effort:
  - For Safari/Chrome/Edge/Brave, attempt `AXURL` and tab title via accessibility tree.
  - Fallback to window title only if URL unavailable.
- Accessibility permission should already be granted for text insertion; treat missing permission as unexpected but still fall back to `focused_window: None`, `focused_browser_tab: None`, `confidence_level: low`, `privacy_filtered: true`.

Shared
- Provide `focus_get_current_context` command that dispatches to the platform module.
- Provide `focus_get_capabilities` with compile-time constants and runtime checks (e.g., accessibility permission).
- Add a background focus watcher that emits `focus://context-changed` events to the frontend when context changes (with debounce).

Watcher defaults
- Focus switch debounce: 50-100ms
- Browser tab switch debounce: 25-50ms
- Stale browser tab timeout: 1-2s

Code outline (Rust)
- New module: `app/src-tauri/src/focus/mod.rs`
  - `pub mod windows;` / `pub mod macos;`
  - `pub struct FocusContextSnapshot { ... }`
  - `pub struct FocusTrackingCapabilities { ... }`
  - `pub enum FocusEventSource { Polling, Accessibility, Uia, Unknown }`
  - `pub enum FocusConfidenceLevel { High, Medium, Low }`
  - `pub fn get_current_focus_context() -> FocusContextSnapshot`
  - `pub fn get_focus_capabilities() -> FocusTrackingCapabilities`
- New watcher: `app/src-tauri/src/focus/watcher.rs`
  - `pub fn start_focus_watcher(app: AppHandle) -> FocusWatcherHandle`
  - Polls every 250ms, compares semantic fields, applies debounce, emits `focus://context-changed`.
  - Keeps last snapshot in memory to avoid duplicate emits.
- Tauri commands in `app/src-tauri/src/lib.rs`
  - `#[tauri::command] fn focus_get_current_context() -> FocusContextSnapshot`
  - `#[tauri::command] fn focus_get_capabilities() -> FocusTrackingCapabilities`
  - Start the watcher in `setup()` and store handle in `AppState` for clean shutdown if needed.

### 4) Frontend: Subscribe + Send at Recording Start

`app/src/lib/tauri.ts`
- Add `focusGetCurrentContext()` and `focusGetCapabilities()` using `invoke`.
- Add `onFocusContextChanged()` event listener.

`app/src/OverlayApp.tsx`
- Maintain `latestFocusContext` from `focus://context-changed`.
- On recording start, send `latestFocusContext` if present:
  - `safeSendClientMessage(client, "focus-context", latestFocusContext, ...)`
  - Then send `start-recording`
- If no snapshot is available, log and continue without context.

Code outline (TypeScript)
- `app/src/lib/tauri.ts`
  - `export type FocusContextSnapshot = { ... }`
  - `export function focusGetCurrentContext(): Promise<FocusContextSnapshot>`
  - `export function focusGetCapabilities(): Promise<FocusTrackingCapabilities>`
  - `export function onFocusContextChanged(cb: (payload: FocusContextSnapshot) => void): Promise<UnlistenFn>`
- `app/src/lib/events.ts`
  - Add event name `focusContextChanged: "focus-context-changed"` (or keep `focus://context-changed` as raw)
  - Add payload typing to `EventPayloads`
- `app/src/OverlayApp.tsx`
  - `const latestFocusContextRef = useRef<FocusContextSnapshot | null>(null);`
  - On event, update ref immediately.
  - On start-recording, send `latestFocusContextRef.current` if non-null.

### 5) Server: Store Focus Context + Inject into Prompt

`server/protocol/messages.py`
- Add new client message type `FocusContextMessage` to the discriminated union.
- Update `parse_client_message`.

`server/main.py`
- In `on_client_message`, handle `FocusContextMessage`:
  - `context_manager.set_focus_context(parsed.data)`

`server/processors/context_manager.py`
- Add `_focus_context: FocusContextSnapshot | None`
- Add `set_focus_context(...)`
- In `reset_context_for_new_recording`, append a second system message after the existing prompt:
  -
    ```
    Focus Context (best-effort, may be incomplete):
    - Application: ...
    - Window: ...
    - Browser Tab: ... (URL origin only if available)
    ```
- Only include the block if `focus_context` is present and not stale (e.g., captured within 5 seconds).

Code outline (Python)
- `server/protocol/messages.py`
  - `class FocusedApplication(BaseModel): display_name: str; bundle_id: str | None; process_path: str | None`
  - `class FocusedWindow(BaseModel): title: str`
  - `class FocusedBrowserTab(BaseModel): title: str | None; url: str | None; browser: str | None`
  - `class FocusContextSnapshot(BaseModel): ...`
  - `class FocusContextMessage(BaseModel): type: Literal["focus-context"]; data: FocusContextSnapshot`
  - Add to `_ClientMessageUnion`
- `server/processors/context_manager.py`
  - `def set_focus_context(self, focus: FocusContextSnapshot) -> None: self._focus_context = focus`
  - `def _format_focus_context_block(self) -> str` helper
  - `def _is_focus_context_fresh(self, now: datetime) -> bool` helper
- `server/main.py`
  - In `on_client_message`, handle `FocusContextMessage()` by calling `context_manager.set_focus_context(...)`.

## Test Cases and Scenarios

Server (Python)
- `test_focus_context_message_parsing`: validates `FocusContextMessage` parsing.
- `test_focus_prompt_injection`: verifies the system prompt includes the focus block only when snapshot is present.
- `test_focus_context_stale`: stale snapshots are ignored.

Tauri (Rust, unit)
- `focus_snapshot_windows_returns_title`: mocked foreground window produces expected fields.
- `focus_snapshot_macos_without_accessibility`: returns low confidence and no window/tab.

Manual / Integration
- Start recording while focused on:
  1. A native app (e.g., Notepad/TextEdit) -> app + window title shown.
  2. Chrome/Edge -> tab title + URL when available.
  3. Accessibility disabled on macOS -> focus block omitted or low confidence.

## Assumptions and Defaults
- Send timing: only at recording start.
- OS support: Windows + macOS in this first pass.
- Browser tab extraction: best-effort via UIA on Windows and accessibility on macOS; no extension yet.
- Privacy defaults: omit URL query parameters; include origin and path only if available.
- If focus is the Tambourine app itself: keep the snapshot but allow it to be overwritten on next recording.
