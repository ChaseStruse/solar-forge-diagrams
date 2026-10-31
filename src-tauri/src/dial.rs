//! Huion Kamvas wheels and pen side button. Without Huion's driver the wheels
//! report only on the tablet's vendor HID interface, and Hyprland passes the
//! pen to apps as a plain mouse without its side button, so the app reads the
//! HID reports directly and forwards wheel turns, wheel presses and side-button
//! presses to the frontend.

use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

const HUION_VENDOR: &str = ":0000256C:";
const DIAL_REPORT: u8 = 0x11;
const PEN_REPORT: u8 = 0x0a;
/// Pen status bits: 0x80 in range, 0x01 tip down, 0x08 side button.
const PEN_SIDE_BUTTON: u8 = 0x08;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DialStatus {
    /// No Huion tablet is plugged in.
    Absent,
    /// A tablet is present but its HID nodes are not readable by this user.
    Permission,
    Connected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DialEvent {
    /// Signed wheel movement; positive is one direction, negative the other.
    Turn {
        delta: i16,
    },
    Press,
    /// The pen's side button went down or up.
    Pen {
        pressed: bool,
    },
}

/// Button state carried between reports, so presses fire on the edge.
#[derive(Default)]
pub struct Held {
    dial: u8,
    pen: bool,
}

static STATUS: Mutex<DialStatus> = Mutex::new(DialStatus::Absent);
static ACTIVE: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

#[tauri::command]
pub fn tablet_dial_status() -> DialStatus {
    STATUS.lock().map(|s| *s).unwrap_or(DialStatus::Absent)
}

/// Decode one wheel or pen report into button edges and wheel movement.
pub fn decode(report: &[u8], held: &mut Held) -> Vec<DialEvent> {
    let mut events = Vec::new();
    match report.first() {
        Some(&DIAL_REPORT) if report.len() >= 4 => {
            let buttons = report[1];
            if buttons != 0 && held.dial == 0 {
                events.push(DialEvent::Press);
            }
            held.dial = buttons;
            let delta = i16::from_le_bytes([report[2], report[3]]);
            if delta != 0 {
                events.push(DialEvent::Turn { delta });
            }
        }
        Some(&PEN_REPORT) if report.len() >= 2 => {
            let pressed = report[1] & PEN_SIDE_BUTTON != 0;
            if pressed != held.pen {
                held.pen = pressed;
                events.push(DialEvent::Pen { pressed });
            }
        }
        _ => {}
    }
    events
}

fn huion_nodes() -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir("/sys/class/hidraw") else {
        return Vec::new();
    };
    let mut nodes: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            fs::read_to_string(entry.path().join("device/uevent"))
                .map(|uevent| uevent.to_ascii_uppercase().contains(HUION_VENDOR))
                .unwrap_or(false)
        })
        .map(|entry| Path::new("/dev").join(entry.file_name()))
        .collect();
    nodes.sort();
    nodes
}

fn read_node(app: tauri::AppHandle, path: PathBuf, mut file: File) {
    let mut buffer = [0u8; 64];
    let mut held = Held::default();
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(length) => {
                for event in decode(&buffer[..length], &mut held) {
                    let _ = app.emit("tablet-dial", event);
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    if let Ok(mut active) = ACTIVE.lock() {
        active.get_or_insert_with(HashSet::new).remove(&path);
    }
}

/// Watch for the tablet, including after it is unplugged and plugged back in.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let nodes = huion_nodes();
        let mut denied = false;
        for path in &nodes {
            let Ok(mut active) = ACTIVE.lock() else {
                return;
            };
            let active = active.get_or_insert_with(HashSet::new);
            if active.contains(path) {
                continue;
            }
            match File::open(path) {
                Ok(file) => {
                    active.insert(path.clone());
                    let (app, path) = (app.clone(), path.clone());
                    std::thread::spawn(move || read_node(app, path, file));
                }
                Err(error) if error.kind() == ErrorKind::PermissionDenied => denied = true,
                Err(_) => {}
            }
        }
        let connected = ACTIVE
            .lock()
            .map(|active| active.as_ref().is_some_and(|set| !set.is_empty()))
            .unwrap_or(false);
        let status = if connected {
            DialStatus::Connected
        } else if denied {
            DialStatus::Permission
        } else {
            DialStatus::Absent
        };
        if let Ok(mut current) = STATUS.lock() {
            if *current != status {
                *current = status;
                let _ = app.emit("tablet-dial-status", status);
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_are_signed_and_presses_fire_once() {
        let mut held = Held::default();
        assert_eq!(
            decode(&[0x11, 0, 0x0d, 0, 0, 0, 0, 0, 0], &mut held),
            vec![DialEvent::Turn { delta: 13 }]
        );
        assert_eq!(
            decode(&[0x11, 0, 0xf5, 0xff, 0, 0, 0, 0, 0], &mut held),
            vec![DialEvent::Turn { delta: -11 }]
        );
        assert_eq!(decode(&[0x11, 2, 0, 0], &mut held), vec![DialEvent::Press]);
        assert!(decode(&[0x11, 3, 0, 0], &mut held).is_empty());
        assert!(decode(&[0x11, 0, 0, 0], &mut held).is_empty());
        assert_eq!(decode(&[0x11, 2, 0, 0], &mut held), vec![DialEvent::Press]);
    }

    #[test]
    fn pen_side_button_reports_edges_only() {
        let mut held = Held::default();
        let pen = |status: u8| [0x0a, status, 0x46, 0x37, 0x6b, 0x4b, 0, 0, 0x11, 0x13];
        assert!(decode(&pen(0xc0), &mut held).is_empty());
        assert_eq!(
            decode(&pen(0xc8), &mut held),
            vec![DialEvent::Pen { pressed: true }]
        );
        assert!(decode(&pen(0xc8), &mut held).is_empty());
        // Touching the tip with the button held is not a new press.
        assert!(decode(&pen(0xc9), &mut held).is_empty());
        assert!(decode(&pen(0xc1), &mut held) == vec![DialEvent::Pen { pressed: false }]);
        assert!(decode(&pen(0xc0), &mut held).is_empty());
    }

    #[test]
    fn other_reports_are_ignored() {
        let mut held = Held::default();
        assert!(decode(&[0x03, 0, 0, 0, 0, 0, 0, 0], &mut held).is_empty());
        assert!(decode(&[0x11, 2], &mut held).is_empty());
        assert!(decode(&[0x0a], &mut held).is_empty());
        assert_eq!(held.dial, 0);
    }
}
