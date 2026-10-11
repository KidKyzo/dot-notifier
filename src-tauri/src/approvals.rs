use std::collections::HashMap;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

const APPROVAL_TTL: Duration = Duration::from_secs(90);

#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

struct PendingApproval {
    nonce: String,
    expires_at: Instant,
    response: mpsc::Sender<ApprovalDecision>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalDecision {
    Allow,
    Deny,
}

impl ApprovalRegistry {
    pub fn register(
        &self,
        event_id: &str,
    ) -> Result<(String, mpsc::Receiver<ApprovalDecision>), String> {
        self.register_for(event_id, APPROVAL_TTL)
    }

    fn register_for(
        &self,
        event_id: &str,
        ttl: Duration,
    ) -> Result<(String, mpsc::Receiver<ApprovalDecision>), String> {
        let mut bytes = [0_u8; 24];
        getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
        let nonce: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let (response, receiver) = mpsc::channel();
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Approval state is unavailable".to_owned())?;
        pending.retain(|_, request| request.expires_at > Instant::now());
        pending.insert(
            event_id.to_owned(),
            PendingApproval {
                nonce: nonce.clone(),
                expires_at: Instant::now() + ttl,
                response,
            },
        );
        Ok((nonce, receiver))
    }

    pub fn complete(
        &self,
        event_id: &str,
        nonce: &str,
        decision: ApprovalDecision,
    ) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Approval state is unavailable".to_owned())?;
        let request = pending
            .get(event_id)
            .ok_or_else(|| "Permission request is no longer active".to_owned())?;
        if request.expires_at <= Instant::now() {
            pending.remove(event_id);
            return Err("Permission request expired".to_owned());
        }
        if request.nonce != nonce {
            return Err("Permission request nonce did not match".to_owned());
        }
        let request = pending
            .remove(event_id)
            .ok_or_else(|| "Permission request is no longer active".to_owned())?;
        request
            .response
            .send(decision)
            .map_err(|_| "Permission hook is no longer connected".to_owned())
    }

    pub fn cancel(&self, event_id: &str, nonce: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .get(event_id)
                .is_some_and(|request| request.nonce == nonce)
            {
                pending.remove(event_id);
            }
        }
    }

    pub fn dismiss(&self, event_id: &str, nonce: &str) -> Result<(), String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Approval state is unavailable".to_owned())?;
        let request = pending
            .get(event_id)
            .ok_or_else(|| "Permission request is no longer active".to_owned())?;
        if request.expires_at <= Instant::now() {
            pending.remove(event_id);
            return Err("Permission request expired".to_owned());
        }
        if request.nonce != nonce {
            return Err("Permission request nonce did not match".to_owned());
        }
        pending.remove(event_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{ApprovalDecision, ApprovalRegistry};

    #[test]
    fn accepts_one_matching_action_and_rejects_replay() {
        let registry = ApprovalRegistry::default();
        let (nonce, response) = registry.register("event-1").expect("register");
        registry
            .complete("event-1", &nonce, ApprovalDecision::Allow)
            .expect("first action is accepted");
        assert_eq!(
            response.recv().expect("decision received"),
            ApprovalDecision::Allow
        );
        assert!(registry
            .complete("event-1", &nonce, ApprovalDecision::Allow)
            .is_err());
    }

    #[test]
    fn rejects_a_nonce_bound_to_another_event() {
        let registry = ApprovalRegistry::default();
        let (nonce, _response) = registry.register("event-1").expect("register");
        assert!(registry
            .complete("event-2", &nonce, ApprovalDecision::Deny)
            .is_err());
        assert!(registry
            .complete("event-1", "wrong-nonce", ApprovalDecision::Deny)
            .is_err());
        assert!(registry
            .complete("event-1", &nonce, ApprovalDecision::Allow)
            .is_ok());
    }

    #[test]
    fn dismissal_and_hook_disconnect_leave_no_decision() {
        let registry = ApprovalRegistry::default();
        let (nonce, response) = registry.register("event-1").expect("register");
        registry.dismiss("event-1", &nonce).expect("dismiss");
        assert!(response.recv().is_err());
        assert!(registry
            .complete("event-1", &nonce, ApprovalDecision::Allow)
            .is_err());

        let (nonce, response) = registry.register("event-2").expect("register");
        registry.cancel("event-2", &nonce);
        assert!(response.recv().is_err());
    }

    #[test]
    fn expired_nonce_cannot_decide() {
        let registry = ApprovalRegistry::default();
        let (nonce, _response) = registry
            .register_for("event-1", std::time::Duration::ZERO)
            .expect("register");
        assert!(registry
            .complete("event-1", &nonce, ApprovalDecision::Allow)
            .is_err());
    }
}
