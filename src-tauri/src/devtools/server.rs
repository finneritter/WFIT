//! Dev-only dashboard HTTP server (feature `dev-dashboard`), bound to loopback.
//!
//! Serves a single embedded `dashboard.html` plus a small JSON/SSE API over the
//! live [`AppState`]. Loopback-only + feature-gated out of release, so it needs no
//! auth. Handlers call the underlying domain functions directly (never the Tauri
//! `#[command]` wrappers, which require Tauri's `State`/`AppHandle`). Stress and
//! action endpoints are added in later phases; this is the observability core.

use axum::{
    extract::State,
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Json, Response,
    },
    routing::{get, post},
    Router,
};
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// The dashboard URL, published once the server successfully binds. Read by the
/// `dev_dashboard_url` command so the Settings button only appears when it's live.
static DASHBOARD_URL: OnceLock<String> = OnceLock::new();

/// `Some(url)` once the dev dashboard is bound and serving, else `None`.
pub fn dashboard_url() -> Option<String> {
    DASHBOARD_URL.get().cloned()
}

use super::faults::{self, FaultView};
use super::metrics::{self, MetricsSnapshot};

/// Shared handler state — the live app + the DB path (simulate snapshots beside it).
#[derive(Clone)]
struct DashState {
    app: Arc<crate::AppState>,
    db_path: PathBuf,
}

/// Maps a domain error to a 500 with its message, so handlers can use `?`.
struct ApiErr(String);
impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}
impl From<crate::error::AppError> for ApiErr {
    fn from(e: crate::error::AppError) -> Self {
        ApiErr(e.to_string())
    }
}

/// Bind `127.0.0.1:port` and serve until the process exits. Errors are logged, not
/// propagated — a dev tool failing to bind must never take down the app.
pub async fn serve(app: Arc<crate::AppState>, db_path: PathBuf, port: u16) {
    let st = DashState { app, db_path };
    let router = Router::new()
        .route("/", get(index))
        .route("/api/metrics", get(metrics_json))
        .route("/api/stream", get(metrics_sse))
        .route("/api/faults", get(get_faults).post(set_faults))
        .route("/api/stress/simulate", post(stress_simulate))
        .route("/api/stress/market-burst", post(stress_market_burst))
        .route("/api/stress/valuation-bench", post(stress_valuation_bench))
        .route("/api/stress/full-sync", post(stress_full_sync))
        .route("/api/actions/rebuild-cache", post(act_rebuild))
        .route("/api/actions/clear", post(act_clear))
        .with_state(st);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            let _ = DASHBOARD_URL.set(format!("http://127.0.0.1:{port}"));
            tracing::info!("dev dashboard: http://127.0.0.1:{port}");
            if let Err(e) = axum::serve(listener, router).await {
                tracing::error!(error = %e, "dev dashboard server stopped");
            }
        }
        Err(e) => tracing::error!(error = %e, port, "dev dashboard: failed to bind"),
    }
}

async fn index() -> Html<&'static str> {
    Html(include_str!("dashboard.html"))
}

async fn metrics_json(State(st): State<DashState>) -> Json<MetricsSnapshot> {
    Json(metrics::snapshot(&st.app.db))
}

async fn get_faults() -> Json<FaultView> {
    Json(faults::get())
}

/// Arm/disarm fault knobs. Returns the (capped) state actually applied.
async fn set_faults(Json(v): Json<FaultView>) -> Json<FaultView> {
    faults::set(v);
    Json(faults::get())
}

/// 1 Hz snapshot push so the page updates live without polling.
async fn metrics_sse(
    State(st): State<DashState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = futures_util::stream::unfold(st, |st| async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let snap = metrics::snapshot(&st.app.db);
        let data = serde_json::to_string(&snap).unwrap_or_default();
        Some((Ok(Event::default().data(data)), st))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Stress generation -----------------------------------------------------

#[derive(Deserialize)]
struct SimReq {
    #[serde(default = "fill_default")]
    fill: i64,
}
fn fill_default() -> i64 {
    100
}

/// Replace the inventory with a simulated account of the given fill %. Runs on a
/// blocking thread (synchronous DB writes + a pre-snapshot file copy).
async fn stress_simulate(
    State(st): State<DashState>,
    Json(req): Json<SimReq>,
) -> Result<Json<crate::types::SimSummary>, ApiErr> {
    let app = st.app.clone();
    let path = st.db_path.clone();
    let summary =
        tokio::task::spawn_blocking(move || crate::db::simulate::simulate(&app.db, &path, req.fill))
            .await
            .map_err(|e| ApiErr(e.to_string()))??;
    Ok(Json(summary))
}

#[derive(Deserialize)]
struct BurstReq {
    #[serde(default = "burst_default")]
    n: usize,
    #[serde(default)]
    kind: String, // "stats" | anything else → order books
}
fn burst_default() -> usize {
    8
}

#[derive(Serialize)]
struct BurstResult {
    requested: usize,
    ok: usize,
    elapsed_ms: u64,
    req_per_s: f64, // ≈ 2.5 proves the global throttle serialized the burst
}

/// Fire N concurrent market fetches at once — the throttle must serialize them to
/// ~2.5 req/s. Capped at 30 so we never hammer warframe.market.
async fn stress_market_burst(
    State(st): State<DashState>,
    Json(req): Json<BurstReq>,
) -> Result<Json<BurstResult>, ApiErr> {
    let n = req.n.clamp(1, 30);
    let slugs: Vec<String> = st.app.db.read(|c| {
        let mut stmt =
            c.prepare("SELECT slug FROM catalog_items WHERE is_tradeable = 1 LIMIT ?1")?;
        let rows = stmt.query_map([n as i64], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })?;
    let stats = req.kind == "stats";
    let t = Instant::now();
    let futs = slugs.iter().map(|slug| {
        let m = st.app.market.clone();
        let slug = slug.clone();
        async move {
            if stats {
                m.fetch_statistics(&slug).await.map(|_| ())
            } else {
                m.fetch_order_book(&slug).await.map(|_| ())
            }
        }
    });
    let results = futures_util::future::join_all(futs).await;
    let elapsed = t.elapsed();
    let ok = results.iter().filter(|r| r.is_ok()).count();
    let secs = elapsed.as_secs_f64().max(0.001);
    Ok(Json(BurstResult {
        requested: slugs.len(),
        ok,
        elapsed_ms: elapsed.as_millis() as u64,
        req_per_s: round2(slugs.len() as f64 / secs),
    }))
}

#[derive(Deserialize)]
struct BenchReq {
    #[serde(default = "bench_default")]
    n: usize,
}
fn bench_default() -> usize {
    20
}

#[derive(Serialize)]
struct BenchResult {
    runs: usize,
    p50_ms: f64,
    p95_ms: f64,
    min_ms: f64,
    max_ms: f64,
}

/// Time N full batched valuations (`owned_holdings`) back-to-back on a blocking
/// thread. The breakpoint finder for inventory scale (pair with /stress/simulate).
async fn stress_valuation_bench(
    State(st): State<DashState>,
    Json(req): Json<BenchReq>,
) -> Result<Json<BenchResult>, ApiErr> {
    let n = req.n.clamp(1, 200);
    let app = st.app.clone();
    let mut us: Vec<u64> = tokio::task::spawn_blocking(move || {
        let mut ds = Vec::with_capacity(n);
        for _ in 0..n {
            let t = Instant::now();
            let _ = crate::db::inventory::owned_holdings(&app.db);
            ds.push(t.elapsed().as_micros() as u64);
        }
        ds
    })
    .await
    .map_err(|e| ApiErr(e.to_string()))?;
    us.sort_unstable();
    let pick = |p: f64| us[(((us.len() - 1) as f64 * p).round() as usize).min(us.len() - 1)];
    Ok(Json(BenchResult {
        runs: us.len(),
        p50_ms: round2(pick(0.50) as f64 / 1000.0),
        p95_ms: round2(pick(0.95) as f64 / 1000.0),
        min_ms: round2(us[0] as f64 / 1000.0),
        max_ms: round2(*us.last().unwrap() as f64 / 1000.0),
    }))
}

#[derive(Serialize)]
struct SyncResult {
    elapsed_ms: u64,
}

/// Run the full launch refresh (catalog → vault → owned → drain), timed.
async fn stress_full_sync(State(st): State<DashState>) -> Result<Json<SyncResult>, ApiErr> {
    let t = Instant::now();
    crate::launch_refresh(st.app.clone()).await?;
    Ok(Json(SyncResult {
        elapsed_ms: t.elapsed().as_millis() as u64,
    }))
}

// --- Actions ---------------------------------------------------------------

async fn act_rebuild(State(st): State<DashState>) -> Result<Json<serde_json::Value>, ApiErr> {
    let n = crate::commands::rebuild_cache_impl(&st.app).await?;
    Ok(Json(json!({ "catalog_items": n })))
}

async fn act_clear(State(st): State<DashState>) -> Result<Json<serde_json::Value>, ApiErr> {
    let app = st.app.clone();
    tokio::task::spawn_blocking(move || crate::db::simulate::clear(&app.db))
        .await
        .map_err(|e| ApiErr(e.to_string()))??;
    Ok(Json(json!({ "ok": true })))
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}
