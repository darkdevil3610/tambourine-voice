use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;

use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

use crate::focus::{
    FocusConfidenceLevel, FocusContextSnapshot, FocusEventSource, FocusTrackingCapabilities,
    FocusedApplication, FocusedBrowserTab, FocusedWindow,
};

fn get_foreground_window() -> Option<HWND> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0 == 0 {
        None
    } else {
        Some(hwnd)
    }
}

fn get_window_title(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buffer) } as usize;
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len]))
}

fn get_process_path(hwnd: HWND) -> Option<String> {
    let mut process_id: u32 = 0;
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            hwnd,
            Some(&mut process_id),
        );
    }
    if process_id == 0 {
        return None;
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) };
    let handle = handle.ok()?;

    let mut buffer = vec![0u16; MAX_PATH as usize];
    let mut size = buffer.len() as u32;
    let success = unsafe { QueryFullProcessImageNameW(handle, 0, &mut buffer, &mut size) };
    unsafe {
        CloseHandle(handle).ok();
    }
    if !success.as_bool() {
        return None;
    }

    Some(
        OsString::from_wide(&buffer[..size as usize])
            .to_string_lossy()
            .to_string(),
    )
}

fn get_application_display_name(process_path: &str) -> String {
    Path::new(process_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(process_path)
        .to_string()
}

fn infer_browser_tab(window_title: &str, application_name: &str) -> Option<FocusedBrowserTab> {
    let known_browsers = [
        "chrome",
        "msedge",
        "brave",
        "opera",
        "firefox",
        "edge",
        "google chrome",
        "microsoft edge",
        "brave browser",
    ];

    let lower_app = application_name.to_lowercase();
    if !known_browsers.iter().any(|name| lower_app.contains(name)) {
        return None;
    }

    let mut title = window_title.to_string();
    if let Some(separator_index) = window_title.rfind(" - ") {
        title = window_title[..separator_index].to_string();
    }

    Some(FocusedBrowserTab {
        title: if title.is_empty() { None } else { Some(title) },
        url: None,
        browser: Some(application_name.to_string()),
    })
}

pub fn get_current_focus_context() -> FocusContextSnapshot {
    let captured_at = chrono::Utc::now().to_rfc3339();

    let hwnd = match get_foreground_window() {
        Some(hwnd) => hwnd,
        None => {
            return FocusContextSnapshot {
                focused_application: None,
                focused_window: None,
                focused_browser_tab: None,
                event_source: FocusEventSource::Polling,
                confidence_level: FocusConfidenceLevel::Low,
                privacy_filtered: true,
                captured_at,
            };
        }
    };

    let window_title = get_window_title(hwnd);
    let process_path = get_process_path(hwnd);

    let focused_application = process_path.as_ref().map(|path| FocusedApplication {
        display_name: get_application_display_name(path),
        bundle_id: None,
        process_path: Some(path.to_string()),
    });

    let focused_window = window_title.as_ref().map(|title| FocusedWindow {
        title: title.clone(),
    });

    let focused_browser_tab = match (window_title.as_ref(), focused_application.as_ref()) {
        (Some(title), Some(application)) => infer_browser_tab(title, &application.display_name),
        _ => None,
    };

    FocusContextSnapshot {
        focused_application,
        focused_window,
        focused_browser_tab,
        event_source: FocusEventSource::Polling,
        confidence_level: FocusConfidenceLevel::High,
        privacy_filtered: true,
        captured_at,
    }
}

pub fn get_focus_capabilities() -> FocusTrackingCapabilities {
    FocusTrackingCapabilities {
        supports_focused_application_detection: true,
        supports_focused_window_detection: true,
        supports_focused_browser_tab_detection: true,
        supports_realtime_event_streaming: true,
        supports_private_browsing_detection: false,
    }
}
