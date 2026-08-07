#!/usr/bin/env python3
import argparse
import csv
import os
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://wiki.apterous.org"
SERIES_URL = f"{BASE_URL}/Series_94"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; PuzzleBot/1.0)"}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "puzzle_big.csv"))

PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
MAX_RETRIES = 5
RETRY_DELAY = 3


def fetch_with_retry(url):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            r.raise_for_status()
            return r
        except (requests.RequestException, requests.HTTPError) as e:
            if attempt < MAX_RETRIES:
                print(
                    f"Attempt {attempt} failed: {e}. Retrying in"
                    f" {RETRY_DELAY}s..."
                )
                time.sleep(RETRY_DELAY)
            else:
                print(f"All {MAX_RETRIES} attempts failed for {url}")
                raise
    return None


def get_episode_info(offset=0, target_ep=None):
    r = fetch_with_retry(SERIES_URL)
    if not r:
        return None
    soup = BeautifulSoup(r.text, "html.parser")

    table = next(
        (
            t
            for t in soup.find_all("table")
            if any("date" in th.get_text().lower() for th in t.find_all("th"))
        ),
        None,
    )

    # 1. Look up by direct episode number if passed
    if target_ep:
        target_ep = str(target_ep).strip()
        if table:
            for row in table.find_all("tr")[1:]:
                cells = row.find_all("td")
                if len(cells) < 2:
                    continue
                ep_link = cells[0].find("a")
                ep_num = ep_link.get_text(strip=True) if ep_link else None
                if ep_num == target_ep:
                    date_str = cells[1].get_text(strip=True)
                    guest_cell = row.find("td", class_="guest")
                    guest = (
                        guest_cell.get_text(strip=True)
                        if guest_cell
                        else "Unknown"
                    )
                    max_cell = row.find("td", class_="max")
                    max_score = (
                        max_cell.get_text(strip=True) if max_cell else "Unknown"
                    )
                    return {
                        "ep_num": ep_num,
                        "date": date_str,
                        "guest": guest,
                        "max_score": max_score,
                    }
        # Fallback metadata if not listed in table
        return {
            "ep_num": target_ep,
            "date": "Manual Test",
            "guest": "Unknown",
            "max_score": "Unknown",
        }

    # 2. Look up by date using offset
    target_date = datetime.now(PACIFIC_TZ) + timedelta(days=offset)
    date_str = target_date.strftime("%d/%m/%Y")
    if not table:
        return None

    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        if cells[1].get_text(strip=True) == date_str:
            ep_link = cells[0].find("a")
            ep_num = ep_link.get_text(strip=True) if ep_link else None
            guest_cell = row.find("td", class_="guest")
            guest = (
                guest_cell.get_text(strip=True) if guest_cell else "Unknown"
            )
            max_cell = row.find("td", class_="max")
            max_score = (
                max_cell.get_text(strip=True) if max_cell else "Unknown"
            )
            return {
                "ep_num": ep_num,
                "date": date_str,
                "guest": guest,
                "max_score": max_score,
            }
    return None


def fetch_episode_table(ep_num):
    rounds = []
    r = fetch_with_retry(f"{BASE_URL}/Episode_{ep_num}")
    soup = BeautifulSoup(r.text, "html.parser")

    l_count, n_count, t_count, c_count = 1, 1, 1, 1

    for row in soup.select("tbody tr"):
        if "ttt" in row.get("class", []):
            sel = row.select_one(".tselection")
            clue_cell = row.select_one("td[colspan='3']")
            answer_cell = row.select_one("td[colspan='2']")
            letters = list(sel.get_text(strip=True).upper()) if sel else []
            letters += [""] * (9 - len(letters))
            clue = clue_cell.get_text(" ", strip=True) if clue_cell else ""
            answer = answer_cell.get_text(strip=True) if answer_cell else ""
            rounds.append({
                "type": "T",
                "round_id": f"T{t_count:02d}",
                "letters": letters,
                "answer": answer,
                "clue": clue,
            })
            t_count += 1
            continue

        sel_cell = row.select_one(".lselection, .nselection, .cselection")
        if not sel_cell:
            continue
        sel_text = sel_cell.get_text(strip=True)
        classes = sel_cell.get("class", [])

        if "lselection" in classes:
            round_id = f"L{l_count:02d}"
            l_count += 1
            letters = list(sel_text.upper()) + [""] * (9 - len(sel_text))
            answer_cells = [
                w.strip()
                for cls_name in ["c1word", "c2word", "lothers"]
                for cell in row.select(f".{cls_name}")
                for w in cell.get_text(strip=True).split(",")
                if w and not w.strip().endswith(("x", "☓", "*"))
            ]
            answer_text = ", ".join(answer_cells)
            rounds.append({
                "type": "L",
                "round_id": round_id,
                "letters": letters,
                "answer": answer_text,
                "clue": None,
            })
        elif "nselection" in classes:
            round_id = f"N{n_count:02d}"
            n_count += 1
            parts = sel_text.split("→")
            numbers = parts[0].split()
            target = parts[1].strip() if len(parts) > 1 else ""
            numbers += [""] * (9 - len(numbers))
            rounds.append({
                "type": "N",
                "round_id": round_id,
                "letters": numbers,
                "answer": "",
                "clue": target,
            })
        elif "cselection" in classes:
            round_id = f"C{c_count:02d}"
            c_count += 1
            letters = list(sel_text.upper()) + [""] * (9 - len(sel_text))
            answer_cell = row.select_one(".c1buzz")
            answer_text = (
                answer_cell.get_text(strip=True).split("(")[0].strip()
                if answer_cell
                else ""
            )
            rounds.append({
                "type": "C",
                "round_id": round_id,
                "letters": letters,
                "answer": answer_text,
                "clue": None,
            })
    return rounds


def write_csv(offset=0, target_ep=None):
    info = get_episode_info(offset=offset, target_ep=target_ep)
    if not info or not info.get("ep_num"):
        print("No episode found.")
        return

    rounds = fetch_episode_table(info["ep_num"])

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        writer.writerow([f"Date: {info['date']}"])
        writer.writerow([f"Guest: {info['guest']}"])
        writer.writerow([f"Max: {info['max_score']}"])
        writer.writerow([])

        writer.writerow([
            "ROUND",
            "S",
            "E",
            "L",
            "E",
            "C",
            "T",
            "I",
            "O",
            "N",
            "TARGET",
            "ANSWERS",
        ])

        for r in rounds:
            letters = r["letters"]
            ans = r.get("answer", "")
            target = r.get("clue", "") if r["type"] == "N" else ""

            if r["type"] == "T" and r.get("clue"):
                writer.writerow([r["round_id"]] + [r["clue"], ""])

            writer.writerow([r["round_id"], *letters, target, ans])

    print(f"CSV written to {OUTPUT_FILE} with {len(rounds)} rounds.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape Apterous episode puzzles."
    )
    parser.add_argument(
        "--ep",
        type=str,
        default="",
        help="Specific episode number (e.g. 9123)",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Days offset (e.g. -1 for yesterday)",
    )
    parser.add_argument(
        "--force", action="store_true", help="Bypass weekend check"
    )
    args = parser.parse_args()

    pacific_now = datetime.now(PACIFIC_TZ)
    is_weekend = pacific_now.weekday() >= 5

    target_ep = args.ep.strip() if args.ep.strip() else None

    if is_weekend and not args.force and not target_ep:
        print("Weekend in Pacific Time, skipping.")
    else:
        write_csv(offset=args.offset, target_ep=target_ep)
