//! warframe.market presence keeper.
//!
//! warframe.market exposes online/in-game status over a **held WebSocket**, not
//! a REST endpoint (`PUT /v2/me/status` 404s). The site connects to its socket,
//! sends a `@WS/USER/SET_STATUS` message, and your presence persists only while
//! that socket stays open. This module mirrors that: a single supervisor task
//! holds the connection while the desired status is online/ingame, pushes the
//! status on connect (and on switch), keeps it alive with periodic pings,
//! reconnects on drop, and goes quiet (closing the socket → server marks you
//! offline) when the desired status is invisible or the session is gone.
//!
//! Isolated from the market HTTP path, like worldstate/gamescan.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::watch;
use tokio::time::{interval, MissedTickBehavior};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

// Presence lives on warframe.market's dedicated socket host (NOT warframe.market/socket,
// which speaks a stale `@WS/...` dialect that rejects SET_STATUS). The current protocol
// is `@wfm|cmd/...` envelopes; you authenticate over the socket with signIn, then push
// status. Subprotocol header must be "wfm".
const SOCKET_URL: &str = "wss://ws.warframe.market/socket";
const WS_PROTOCOL: &str = "wfm";
const PING_SECS: u64 = 30;
const RECONNECT_SECS: u64 = 4;

static MSG_SEQ: AtomicU64 = AtomicU64::new(1);

/// The presence we want warframe.market to show. `Offline` (invisible) holds no
/// connection; `Online("online" | "ingame")` keeps the socket open.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Desired {
    Offline,
    Online(String),
}

/// Handle kept in `AppState`. Setting a value nudges the supervisor task.
pub struct Presence {
    tx: watch::Sender<Desired>,
}

impl Presence {
    /// Create the handle plus the receiver to hand to [`supervisor`].
    pub fn new() -> (Self, watch::Receiver<Desired>) {
        let (tx, rx) = watch::channel(Desired::Offline);
        (Self { tx }, rx)
    }

    /// Request a presence. Cheap and infallible — the supervisor does the work.
    pub fn set(&self, desired: Desired) {
        // Only error is "no receiver", i.e. the supervisor task is gone; nothing
        // we can do about presence then, so ignore.
        let _ = self.tx.send(desired);
    }
}

/// A `@wfm|...` envelope: `{"route", "payload", "id"}`. Each message carries a
/// unique id (the server echoes it as `refId` on the reply).
fn envelope(route: &str, payload: serde_json::Value) -> Message {
    let id = format!("wfit{}", MSG_SEQ.fetch_add(1, Ordering::Relaxed));
    let body = serde_json::json!({ "route": route, "payload": payload, "id": id }).to_string();
    Message::Text(body)
}

fn sign_in_msg(token: &str) -> Message {
    envelope("@wfm|cmd/auth/signIn", serde_json::json!({ "token": token }))
}

fn set_status_msg(status: &str) -> Message {
    envelope("@wfm|cmd/status/set", serde_json::json!({ "status": status }))
}

/// Long-lived task: reconcile the live socket with the desired presence.
pub async fn supervisor(mut rx: watch::Receiver<Desired>) {
    loop {
        let desired = rx.borrow_and_update().clone();
        match desired {
            Desired::Offline => {
                // Nothing held while invisible; wait for the next request.
                if rx.changed().await.is_err() {
                    return; // app shutting down (sender dropped)
                }
            }
            Desired::Online(status) => match hold(&status, &mut rx).await {
                // Desired changed — loop re-reads it immediately.
                HoldEnd::DesiredChanged => {}
                // Socket dropped / connect failed — back off, then reconnect
                // (the loop re-reads `desired`; if still online, we retry).
                HoldEnd::SocketLost => tokio::time::sleep(Duration::from_secs(RECONNECT_SECS)).await,
                // Supervisor should stop (channel closed).
                HoldEnd::Shutdown => return,
            },
        }
    }
}

enum HoldEnd {
    DesiredChanged,
    SocketLost,
    Shutdown,
}

/// Open the socket, push `status`, and hold it until the desired presence
/// changes or the connection drops.
async fn hold(status: &str, rx: &mut watch::Receiver<Desired>) -> HoldEnd {
    let jwt = match crate::wfm_account::load_jwt() {
        Ok(Some(j)) => j,
        // No session: can't authenticate. Idle until the desired status changes
        // so we don't spin reconnecting against a guaranteed failure.
        _ => {
            return match rx.changed().await {
                Ok(()) => HoldEnd::DesiredChanged,
                Err(_) => HoldEnd::Shutdown,
            };
        }
    };

    let mut req = match SOCKET_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "wfm presence: bad socket request");
            return HoldEnd::SocketLost;
        }
    };
    let headers = req.headers_mut();
    if let Ok(v) = WS_PROTOCOL.parse() {
        headers.insert("Sec-WebSocket-Protocol", v);
    }
    if let Ok(v) = "wfit-desktop/0.1".parse() {
        headers.insert("User-Agent", v);
    }

    let mut ws = match connect_async(req).await {
        Ok((ws, _resp)) => ws,
        Err(e) => {
            tracing::warn!(error = %e, "wfm presence: connect failed");
            return HoldEnd::SocketLost;
        }
    };
    // Authenticate over the socket, then push the desired status.
    if let Err(e) = ws.send(sign_in_msg(&jwt)).await {
        tracing::warn!(error = %e, "wfm presence: signIn send failed");
        return HoldEnd::SocketLost;
    }
    if let Err(e) = ws.send(set_status_msg(status)).await {
        tracing::warn!(error = %e, "wfm presence: initial status send failed");
        return HoldEnd::SocketLost;
    }
    tracing::info!(%status, "wfm presence socket connected");

    let mut ping = interval(Duration::from_secs(PING_SECS));
    ping.set_missed_tick_behavior(MissedTickBehavior::Skip);
    ping.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            changed = rx.changed() => {
                if changed.is_err() {
                    let _ = ws.close(None).await;
                    return HoldEnd::Shutdown;
                }
                // Clone to an owned value so the (non-Send) watch guard is dropped
                // before the awaits below — otherwise the task isn't Send.
                let next = rx.borrow_and_update().clone();
                match next {
                    Desired::Offline => {
                        // Tell the server before dropping so buyers see us go
                        // offline immediately, then close.
                        let _ = ws.send(set_status_msg("invisible")).await;
                        let _ = ws.close(None).await;
                        return HoldEnd::DesiredChanged;
                    }
                    Desired::Online(s) => {
                        // online <-> ingame: push the new status on the same socket.
                        if ws.send(set_status_msg(&s)).await.is_err() {
                            return HoldEnd::SocketLost;
                        }
                        tracing::info!(status = %s, "wfm presence status switched");
                    }
                }
            }
            _ = ping.tick() => {
                if ws.send(Message::Ping(Vec::new())).await.is_err() {
                    return HoldEnd::SocketLost;
                }
            }
            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Ping(p))) => {
                        if ws.send(Message::Pong(p)).await.is_err() {
                            return HoldEnd::SocketLost;
                        }
                    }
                    // DIAGNOSTIC: log whatever the server sends so we can see the
                    // real protocol (auth handshake? error? ack?).
                    Some(Ok(Message::Text(t))) => {
                        tracing::info!(frame = %t, "wfm presence <- text");
                    }
                    Some(Ok(Message::Binary(b))) => {
                        tracing::info!(len = b.len(), "wfm presence <- binary");
                    }
                    Some(Ok(Message::Close(c))) => {
                        tracing::warn!(close = ?c, "wfm presence <- close");
                        return HoldEnd::SocketLost;
                    }
                    None => return HoldEnd::SocketLost,
                    Some(Err(e)) => {
                        tracing::debug!(error = %e, "wfm presence socket error");
                        return HoldEnd::SocketLost;
                    }
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}
