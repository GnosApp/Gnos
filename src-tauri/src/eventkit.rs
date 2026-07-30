// System calendar (macOS EventKit) — read-only fetch of events for a date
// range. On non-macOS these commands return an error so the JS side degrades
// gracefully. Needs NSCalendarsUsageDescription (+ full-access on macOS 14+)
// in the bundle Info.plist; macOS shows the permission prompt on first request.

use serde::Serialize;

#[derive(Serialize)]
pub struct CalEvent {
    pub id: String,
    pub title: String,
    pub start: f64, // unix seconds
    pub end: f64,
    pub all_day: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub calendar: Option<String>,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::CalEvent;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_event_kit::{EKEntityType, EKEvent, EKEventStore};
    use objc2_foundation::{NSArray, NSDate, NSError};

    pub fn fetch(start: f64, end: f64) -> Result<Vec<CalEvent>, String> {
        unsafe {
            let store = EKEventStore::new();

            // Request full access to events (macOS 14+); block on the completion.
            let (tx, rx) = mpsc::channel::<Result<(), String>>();
            let handler = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
                let _ = tx.send(if granted.as_bool() {
                    Ok(())
                } else {
                    Err("Calendar access denied".to_string())
                });
            });
            // The generated binding takes a raw *mut DynBlock pointer.
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&handler));

            match rx.recv_timeout(Duration::from_secs(60)) {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(e),
                Err(_) => return Err("Calendar permission request timed out".to_string()),
            }

            let start_date: Retained<NSDate> = NSDate::dateWithTimeIntervalSince1970(start);
            let end_date: Retained<NSDate> = NSDate::dateWithTimeIntervalSince1970(end);
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(
                &start_date,
                &end_date,
                None::<&NSArray<objc2_event_kit::EKCalendar>>,
            );
            let events: Retained<NSArray<EKEvent>> = store.eventsMatchingPredicate(&predicate);

            let mut out = Vec::new();
            for ev in events.iter() {
                // title/startDate/endDate are non-null (Retained); the rest are Option.
                let title = ev.title().to_string();
                let start_ts = ev.startDate().timeIntervalSince1970();
                let end_ts = ev.endDate().timeIntervalSince1970();
                let location = ev.location().map(|s| s.to_string()).filter(|s| !s.is_empty());
                let notes = ev.notes().map(|s| s.to_string()).filter(|s| !s.is_empty());
                let calendar = ev.calendar().map(|c| c.title().to_string());
                let id = ev
                    .eventIdentifier()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("ek_{}_{}", start_ts as i64, title));

                out.push(CalEvent {
                    id,
                    title,
                    start: start_ts,
                    end: end_ts,
                    all_day: ev.isAllDay(),
                    location,
                    notes,
                    calendar,
                });
            }
            Ok(out)
        }
    }

    pub fn status() -> String {
        unsafe {
            let status = EKEventStore::authorizationStatusForEntityType(EKEntityType::Event);
            match status.0 {
                0 => "notDetermined",
                1 => "restricted",
                2 => "denied",
                3 => "authorized",
                4 => "fullAccess",
                _ => "unknown",
            }
            .to_string()
        }
    }
}

#[tauri::command]
pub fn eventkit_fetch(start: f64, end: f64) -> Result<Vec<CalEvent>, String> {
    #[cfg(target_os = "macos")]
    {
        imp::fetch(start, end)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (start, end);
        Err("System calendar is only available on macOS".to_string())
    }
}

#[tauri::command]
pub fn eventkit_status() -> String {
    #[cfg(target_os = "macos")]
    {
        imp::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported".to_string()
    }
}
