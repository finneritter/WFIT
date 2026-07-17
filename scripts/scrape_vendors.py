#!/usr/bin/env python3
"""Seed static-vendor offering TSVs from wiki.warframe.com wikitext.

One-shot, re-runnable when the game updates: fetches each vendor page's raw
wikitext, parses the {{SynOfferBox|img|link|name|cost|Rank N: Title}} templates
in its ==Offerings== section, and writes
src-tauri/src/domain/data/vendors/<key>.tsv with columns
    item \t cost \t currency \t rank \t slug_hint
(slug_hint stays blank here — fill by hand for names the fuzzy matcher misses).

The TSVs are committed and hand-reviewed; the app never touches the wiki at
runtime. Spot-check the output before committing (costs and rank gates!).
"""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

WIKI = "https://wiki.warframe.com/w/{page}?action=raw"
OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri/src/domain/data/vendors"

# key → (wiki page, currency for every offering row)
# All syndicate offerings are priced in that syndicate's standing. Open-world
# syndicate pages (Ostron, Solaris United, Entrati, …) use the same
# {{SynOfferBox}} template as the relay six, so they parse identically.
SYNDICATES: dict[str, tuple[str, str]] = {
    # Relay six (Phase A — hand-reviewed; skip unless explicitly re-run).
    "steel_meridian": ("Steel_Meridian", "standing"),
    "arbiters_of_hexis": ("Arbiters_of_Hexis", "standing"),
    "cephalon_suda": ("Cephalon_Suda", "standing"),
    "perrin_sequence": ("The_Perrin_Sequence", "standing"),
    "red_veil": ("Red_Veil", "standing"),
    "new_loka": ("New_Loka", "standing"),
    # Open worlds (Phase B).
    "ostron": ("Ostron", "standing"),                       # Cetus
    "quills": ("The_Quills", "standing"),                   # Cetus
    "solaris_united": ("Solaris_United", "standing"),       # Fortuna
    "vox_solaris": ("Vox_Solaris_(Syndicate)", "standing"),  # Fortuna
    "entrati": ("Entrati", "standing"),                     # Deimos
    "necraloid": ("Necraloid", "standing"),                 # Deimos
}

OFFER_RE = re.compile(r"\{\{SynOfferBox\|([^{}]*)\}\}")
RANK_RE = re.compile(r"Rank\s*(\d)")


def fetch_wikitext(page: str) -> str:
    req = urllib.request.Request(WIKI.format(page=page), headers={"User-Agent": "wfit-vendor-seed/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def offerings_section(wikitext: str) -> str:
    # Relay + open-world hub pages have a dedicated ==Offerings== section.
    m = re.search(r"==\s*Offerings\s*==(.*?)(?:\n==[^=]|\Z)", wikitext, re.S)
    if m:
        return m.group(1)
    # Some syndicate pages (Solaris United, Entrati, Necraloid) scatter their
    # {{SynOfferBox}} rows across per-member subsections instead. Fall back to
    # the whole page — every SynOfferBox is an offering row regardless of where
    # it sits. (Pages that DO have ==Offerings== keep the tighter scope so we
    # don't pull in decoration/captura boxes elsewhere on the page.)
    return wikitext


def clean_name(name: str) -> str:
    # Strip wiki/HTML markup the templates carry: <br />, [[link|text]] → text,
    # bold/italic quotes. Then drop a trailing "(Hek)"-style parenthetical (it
    # names the modded weapon, not the item) so name matching sees the market
    # name.
    name = re.sub(r"<[^>]+>", " ", name)
    name = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", name)
    name = name.replace("'''", "").replace("''", "")
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name.strip())
    return re.sub(r"\s{2,}", " ", name).strip()


def parse_offers(section: str, currency: str) -> list[tuple[str, int, str, str]]:
    rows = []
    for m in OFFER_RE.finditer(section):
        # positional params only; named params (top=, blueprint=t) are skipped
        parts = [p.strip() for p in m.group(1).split("|")]
        pos = [p for p in parts if "=" not in p.split(":")[0] or p.lower().startswith("rank")]
        if len(pos) < 5:
            continue
        _img, _link, raw_name, raw_cost, raw_rank = pos[0], pos[1], pos[2], pos[3], pos[4]
        name = clean_name(raw_name)
        try:
            cost = int(raw_cost.replace(",", "").strip())
        except ValueError:
            continue  # non-numeric cost (weekly specials etc.) — hand-add if wanted
        rank_m = RANK_RE.search(raw_rank)
        rank = rank_m.group(1) if rank_m else ""
        rows.append((name, cost, currency, rank))
    return rows


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Optional key filter: `scrape_vendors.py ostron quills` regenerates only
    # those TSVs (leaves the hand-reviewed ones untouched). No args = all.
    only = set(sys.argv[1:])
    for key, (page, currency) in SYNDICATES.items():
        if only and key not in only:
            continue
        section = offerings_section(fetch_wikitext(page))
        rows = parse_offers(section, currency)
        if len(rows) < 20:
            print(f"!! {key}: only {len(rows)} rows — page layout may have changed", file=sys.stderr)
        out = OUT_DIR / f"{key}.tsv"
        with out.open("w") as f:
            f.write(f"# {page} offerings — seeded from wiki.warframe.com by scripts/scrape_vendors.py\n")
            f.write("# item\tcost\tcurrency\trank\tslug_hint\n")
            for name, cost, cur, rank in rows:
                f.write(f"{name}\t{cost}\t{cur}\t{rank}\t\n")
        print(f"{key}: {len(rows)} rows → {out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out}")


if __name__ == "__main__":
    main()
