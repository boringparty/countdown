#!/usr/bin/env python3
"""Polite scraper for Cats Does Countdown episode round tables.

Scrapes only Episode_Cats114 through Episode_Cats177 from the Apterous Wiki.
Writes data/cats-episodes.json. Intended to run from GitHub Actions.
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

FIRST_EPISODE = 114
LAST_EPISODE = 177
BASE_URL = "https://wiki.apterous.org/Episode_Cats{}"
OUTPUT = Path("data/cats-episodes.json")

# Keep the request rate low. One request at a time, with a pause between pages.
REQUEST_DELAY_SECONDS = 3.0
TIMEOUT_SECONDS = 25
USER_AGENT = (
    "CatsCountdownPersonalArchive/1.0 "
    "(polite educational episode-data scraper; GitHub Actions)"
)

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml",
}


def clean_text(node: Any) -> str:
    """Return readable text, normalizing non-breaking spaces and whitespace."""
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True).replace("\xa0", " ")).strip()


def parse_number_selection(value: str) -> dict[str, Any]:
    """Parse a selection such as '75 50 1 5 8 1 → 845'."""
    if "→" in value:
        left, right = re.split(r"\s*→\s*", value, maxsplit=1)
    else:
        left, right = value, ""
    numbers = [int(n) for n in re.findall(r"\d+", left)]
    target_match = re.search(r"\d+", right) if right else None
    return {
        "numbers": numbers,
        "target": int(target_match.group()) if target_match else None,
        "raw": value,
    }


def parse_ttt(row: Any) -> dict[str, Any]:
    cells = row.find_all("td", recursive=False)
    selection_cell = next((c for c in cells if "tselection" in c.get("class", [])), None)
    answer_cell = cells[-1] if len(cells) >= 3 else None

    # The clue is normally the td spanning three columns, between the selection
    # and the answer. Avoid accidentally using the TTT label or answer cell.
    clue = ""
    for cell in cells:
        if cell is selection_cell or cell is answer_cell:
            continue
        if cell.get("colspan") == "3":
            clue = clean_text(cell)
            break

    letters = clean_text(selection_cell) if selection_cell else ""
    answer = clean_text(answer_cell) if answer_cell else ""
    return {
        "type": "teaser",
        "selection": re.sub(r"\s+", "", letters).upper(),
        "clue": clue,
        "answer": re.sub(r"\s+", "", answer).upper(),
    }


def parse_round(row: Any) -> dict[str, Any] | None:
    cells = row.find_all("td", recursive=False)
    if len(cells) < 2:
        return None

    number_text = clean_text(cells[0])
    if not number_text.isdigit():
        return None

    selection_cell = cells[1]
    classes = selection_cell.get("class", [])
    round_number = int(number_text)

    if "lselection" in classes:
        selection = re.sub(r"\s+", "", clean_text(selection_cell)).upper()
        return {
            "round": round_number,
            "type": "letters",
            "selection": selection,
        }

    if "nselection" in classes:
        parsed = parse_number_selection(clean_text(selection_cell))
        return {
            "round": round_number,
            "type": "numbers",
            "numbers": parsed["numbers"],
            "target": parsed["target"],
        }

    if "cselection" in classes:
        selection = re.sub(r"\s+", "", clean_text(selection_cell)).upper()
        # The conundrum solution is not consistently exposed in a dedicated
        # cell, so retain the full round row for later inspection if needed.
        return {
            "round": round_number,
            "type": "conundrum",
            "selection": selection,
        }

    # Unknown selection class: keep a diagnostic instead of silently guessing.
    return {
        "round": round_number,
        "type": "unknown",
        "selection_raw": clean_text(selection_cell),
        "selection_classes": classes,
    }


def parse_episode(episode_number: int, html: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find(id="firstHeading") or soup.find("h1")
    title = clean_text(heading) or f"Episode Cats{episode_number}"

    intro = ""
    content = soup.select_one("#mw-content-text")
    if content:
        for node in content.find_all(["p"], recursive=True):
            candidate = clean_text(node)
            if candidate and f"Episode Cats{episode_number}" in candidate:
                intro = candidate
                break

    table = soup.select_one("table.round_table")
    if table is None:
        raise ValueError("No table.round_table found")

    rounds: list[dict[str, Any]] = []
    for row in table.find_all("tr"):
        classes = row.get("class", [])
        if "ttt" in classes:
            rounds.append(parse_ttt(row))
            continue

        parsed = parse_round(row)
        if parsed:
            rounds.append(parsed)

    if not rounds:
        raise ValueError("Round table found, but no rounds were parsed")

    return {
        "episode": episode_number,
        "title": title,
        "url": url,
        "summary": intro,
        "rounds": rounds,
    }


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update(HEADERS)

    episodes: list[dict[str, Any]] = []
    failures: list[dict[str, str | int]] = []

    for episode_number in range(FIRST_EPISODE, LAST_EPISODE + 1):
        url = BASE_URL.format(episode_number)
        print(f"[{episode_number}/{LAST_EPISODE}] Fetching {url}", flush=True)
        try:
            response = session.get(url, timeout=TIMEOUT_SECONDS)
            if response.status_code == 404:
                failures.append({"episode": episode_number, "error": "HTTP 404"})
                print("  Page not found; continuing.", flush=True)
            else:
                response.raise_for_status()
                episode = parse_episode(episode_number, response.text, url)
                episodes.append(episode)
                print(f"  Parsed {len(episode['rounds'])} rounds.", flush=True)
        except Exception as exc:
            failures.append({"episode": episode_number, "error": str(exc)})
            print(f"  ERROR: {exc}", file=sys.stderr, flush=True)

        if episode_number < LAST_EPISODE:
            time.sleep(REQUEST_DELAY_SECONDS)

    payload = {
        "source": "Apterous Wiki",
        "range": {"first_episode": FIRST_EPISODE, "last_episode": LAST_EPISODE},
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "episode_count": len(episodes),
        "failures": failures,
        "episodes": episodes,
    }

    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"\nSaved {len(episodes)} episodes to {OUTPUT}; "
        f"{len(failures)} page(s) failed.",
        flush=True,
    )

    # Fail the workflow if every page failed, but keep partial results for
    # review if only some episodes could not be fetched or parsed.
    return 1 if not episodes else 0


if __name__ == "__main__":
    raise SystemExit(main())
