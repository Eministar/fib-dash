//! Eine Reservierung gilt vom Startversuch bis zum tatsächlichen Ende des Wächters.
//! Stop setzt nur dessen eigenes Token; ein Neustart kann es nie wieder einschalten.

use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};

#[derive(Default)]
pub struct WatchControl {
    active: Mutex<Option<Arc<AtomicBool>>>,
}

pub struct WatchLease {
    owner: Arc<WatchControl>,
    pub running: Arc<AtomicBool>,
}

impl WatchControl {
    pub fn is_active(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }

    pub fn acquire(self: &Arc<Self>) -> Option<WatchLease> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return None;
        }
        let running = Arc::new(AtomicBool::new(true));
        *active = Some(running.clone());
        Some(WatchLease { owner: self.clone(), running })
    }

    pub fn stop(&self) {
        if let Some(running) = self.active.lock().unwrap().as_ref() {
            running.store(false, Ordering::SeqCst);
        }
    }
}

impl Drop for WatchLease {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        *self.owner.active.lock().unwrap() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rapid_stop_start_cannot_revive_the_old_watcher() {
        let control = Arc::new(WatchControl::default());
        let first = control.acquire().unwrap();
        let old_token = first.running.clone();
        control.stop();
        assert!(!old_token.load(Ordering::SeqCst));
        assert!(control.acquire().is_none(), "alter Wächter räumt noch auf");
        drop(first);
        let next = control.acquire().unwrap();
        assert!(next.running.load(Ordering::SeqCst));
        assert!(!old_token.load(Ordering::SeqCst), "altes Token bleibt aus");
    }

    #[test]
    fn simultaneous_starts_have_only_one_owner_and_failed_start_releases_it() {
        let control = Arc::new(WatchControl::default());
        let leases = std::thread::scope(|scope| {
            let tasks: Vec<_> = (0..8).map(|_| {
                let control = control.clone();
                scope.spawn(move || control.acquire())
            }).collect();
            tasks.into_iter().filter_map(|task| task.join().unwrap()).collect::<Vec<_>>()
        });
        assert_eq!(leases.len(), 1);
        // Auch ein Fehler vor dem Thread-Start gibt die Reservierung per Drop frei.
        drop(leases);
        assert!(control.acquire().is_some());
    }
}
