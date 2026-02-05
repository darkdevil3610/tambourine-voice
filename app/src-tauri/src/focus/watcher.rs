use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::events::EventName;
use crate::focus::{get_current_focus_context, FocusContextSnapshot};

#[derive(Debug, Clone)]
pub struct FocusWatcherHandle {
    should_stop: Arc<AtomicBool>,
}

impl FocusWatcherHandle {
    pub fn stop(&self) {
        self.should_stop.store(true, Ordering::SeqCst);
    }
}

impl Drop for FocusWatcherHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn build_focus_semantic_key(snapshot: &FocusContextSnapshot) -> String {
    let application_key = snapshot
        .focused_application
        .as_ref()
        .map_or("", |app| app.display_name.as_str());
    let window_key = snapshot
        .focused_window
        .as_ref()
        .map_or("", |window| window.title.as_str());
    let tab_title_key = snapshot
        .focused_browser_tab
        .as_ref()
        .and_then(|tab| tab.title.as_deref())
        .unwrap_or("");
    let tab_url_key = snapshot
        .focused_browser_tab
        .as_ref()
        .and_then(|tab| tab.url.as_deref())
        .unwrap_or("");

    format!(
        "{application_key}|{window_key}|{tab_title_key}|{tab_url_key}|{:?}",
        snapshot.confidence_level
    )
}

pub fn start_focus_watcher(app: AppHandle) -> FocusWatcherHandle {
    let should_stop = Arc::new(AtomicBool::new(false));
    let should_stop_clone = should_stop.clone();

    thread::spawn(move || {
        let poll_interval = Duration::from_millis(250);
        let debounce_window = Duration::from_millis(75);

        let mut last_emitted_key: Option<String> = None;
        let mut last_change_instant = Instant::now();
        let mut pending_snapshot: Option<FocusContextSnapshot> = None;

        while !should_stop_clone.load(Ordering::SeqCst) {
            let snapshot = get_current_focus_context();
            let current_key = build_focus_semantic_key(&snapshot);

            if last_emitted_key.as_deref() != Some(current_key.as_str()) {
                pending_snapshot = Some(snapshot);
                last_change_instant = Instant::now();
            }

            if let Some(pending) = pending_snapshot.as_ref() {
                if last_change_instant.elapsed() >= debounce_window {
                    let pending_key = build_focus_semantic_key(pending);
                    if last_emitted_key.as_deref() != Some(pending_key.as_str())
                        && app
                            .emit(EventName::FocusContextChanged.as_str(), pending)
                            .is_ok()
                    {
                        last_emitted_key = Some(pending_key);
                    }
                    pending_snapshot = None;
                }
            }

            thread::sleep(poll_interval);
        }
    });

    FocusWatcherHandle { should_stop }
}
