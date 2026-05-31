//! Split a warframe.market display name into a bold set/frame name + a part sub.
//!   "Mesa Prime Systems"           → ("Mesa Prime", "Systems")
//!   "Nova Prime Chassis Blueprint" → ("Nova Prime", "Chassis Blueprint")
//!   "Saryn Prime Set"              → ("Saryn Prime", "Set")
//! Non-prime names fall back to (whole name, part_type).

pub fn split_name(display_name: &str, part_type: &str) -> (String, String) {
    if let Some(i) = display_name.find(" Prime") {
        let split = i + " Prime".len();
        let name = display_name[..split].to_string();
        let sub = display_name[split..].trim();
        let sub = if sub.is_empty() {
            part_type.to_string()
        } else {
            sub.to_string()
        };
        (name, sub)
    } else {
        (display_name.to_string(), part_type.to_string())
    }
}
