//! Open-world cycle derivation. DE doesn't publish cycles as such, but they
//! are deterministic clocks, so we compute them locally instead of trusting
//! warframestat's often-hours-stale origin snapshot:
//!
//! - **Cetus / Cambion Drift** tick on the Ostron bounty window — the
//!   `CetusSyndicate` expiry in DE's raw worldstate is exactly the end of the
//!   current Cetus night (150-min cycle: 100 day, 50 night). Cambion mirrors
//!   the same clock (day ↔ fass, night ↔ vome). The clock is periodic, so any
//!   past anchor rolls forward without error if DE is briefly unreachable.
//! - **Orb Vallis** is a fixed 1600 s loop (400 warm, 1200 cold) anchored to
//!   the community-established epoch.
//! - **Duviri** moods rotate every 2 h on even UTC boundaries, five-mood loop.

use super::Cycle;

const CETUS_PERIOD: i64 = 9000; // 150 min
const CETUS_NIGHT: i64 = 3000; // the last 50 min of each cycle

const VALLIS_EPOCH: i64 = 1_541_837_628; // a known warm-start (Nov 2018)
const VALLIS_PERIOD: i64 = 1600;
const VALLIS_WARM: i64 = 400; // warm first, then 1200 s cold

const DUVIRI_PERIOD: i64 = 7200;
// Indexed by (unix / 7200) % 5 — the phase offset bakes the joy→anger→envy→
// sorrow→fear in-game order into epoch alignment.
const DUVIRI_MOODS: [&str; 5] = ["sorrow", "fear", "joy", "anger", "envy"];

fn iso(ts: i64) -> Option<String> {
    Some(chrono::DateTime::from_timestamp(ts, 0)?.to_rfc3339())
}

fn cycle(id: &str, name: &str, state: &str, expiry: i64) -> Cycle {
    Cycle {
        id: id.into(),
        name: name.into(),
        state: state.into(),
        time_left: None,
        expiry: iso(expiry),
    }
}

/// All four cycle cards, in the bar's display order. `cetus_night_end` is any
/// known cycle boundary (a CetusSyndicate bounty expiry — current, past, or
/// future); the modular math normalizes it.
pub(super) fn derive(cetus_night_end: i64, now: i64) -> Vec<Cycle> {
    // Cetus phase: 0 at a cycle boundary (day starts), night in the last 3000 s.
    let pos = (now - cetus_night_end).rem_euclid(CETUS_PERIOD);
    let day = pos < CETUS_PERIOD - CETUS_NIGHT;
    let cycle_end = now - pos + CETUS_PERIOD;
    let cetus_expiry = if day {
        cycle_end - CETUS_NIGHT
    } else {
        cycle_end
    };

    let vpos = (now - VALLIS_EPOCH).rem_euclid(VALLIS_PERIOD);
    let warm = vpos < VALLIS_WARM;
    let vallis_expiry = now - vpos + if warm { VALLIS_WARM } else { VALLIS_PERIOD };

    let dphase = now.div_euclid(DUVIRI_PERIOD);
    let mood = DUVIRI_MOODS[dphase.rem_euclid(5) as usize];

    vec![
        cycle(
            "cetus",
            "Cetus",
            if day { "day" } else { "night" },
            cetus_expiry,
        ),
        cycle(
            "vallis",
            "Orb Vallis",
            if warm { "warm" } else { "cold" },
            vallis_expiry,
        ),
        cycle(
            "cambion",
            "Cambion Drift",
            if day { "fass" } else { "vome" },
            cetus_expiry,
        ),
        cycle("duviri", "Duviri", mood, (dphase + 1) * DUVIRI_PERIOD),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    // Anchored against live observations from 2026-06-06: DE's CetusSyndicate
    // expiry was 03:37:24Z while in-cycle time 03:01:10Z showed night (36 min
    // till bounty rotation < the 50-min night), and warframestat's independent
    // derivation at 21:36:24Z agreed on vallis=warm / duviri=anger.
    const BOUNTY_END: i64 = 1_780_717_044; // 2026-06-06T03:37:24Z

    #[test]
    fn cetus_night_before_boundary() {
        let now = 1_780_714_870; // 03:01:10Z — inside the final 50 min
        let c = derive(BOUNTY_END, now);
        assert_eq!(c[0].state, "night");
        assert_eq!(c[2].state, "vome"); // cambion mirrors
        assert_eq!(c[0].expiry, iso(BOUNTY_END));
    }

    #[test]
    fn cetus_day_after_boundary_rolls_forward() {
        let now = BOUNTY_END + 10; // a fresh cycle just started
        let c = derive(BOUNTY_END, now);
        assert_eq!(c[0].state, "day");
        assert_eq!(c[2].state, "fass");
        // day ends 100 min into the new cycle
        assert_eq!(c[0].expiry, iso(BOUNTY_END + CETUS_PERIOD - CETUS_NIGHT));
    }

    #[test]
    fn stale_anchor_is_equivalent() {
        // an anchor many cycles old must yield the same answer
        let now = 1_780_714_870;
        let fresh = derive(BOUNTY_END, now);
        let stale = derive(BOUNTY_END - 37 * CETUS_PERIOD, now);
        assert_eq!(fresh[0].state, stale[0].state);
        assert_eq!(fresh[0].expiry, stale[0].expiry);
    }

    #[test]
    fn vallis_and_duviri_match_warframestat_snapshot() {
        let now = 1_780_695_384; // 2026-06-05T21:36:24Z
        let c = derive(BOUNTY_END, now);
        assert_eq!(c[1].state, "warm"); // 156 s into the loop, warm < 400 s
        assert_eq!(c[1].expiry, iso(now + (VALLIS_WARM - 156)));
        assert_eq!(c[3].state, "anger");
        assert_eq!(c[3].expiry, iso(1_780_696_800)); // 22:00:00Z boundary
    }
}
