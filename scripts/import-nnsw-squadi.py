#!/usr/bin/env python3
"""Import a reviewed 2026 NNSW first-grade Squadi snapshot via Hub APIs.

Dry-run is the default. --apply requires normal app credentials from an
environment secret. No direct database writes, invented goals, or lineups.
"""
import argparse
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo


CODES = {
    "Adamstown Rosebud JFC": "ADA",
    "Broadmeadow Magic FC": "BRO",
    "Charlestown Azzurri FC": "CHA",
    "Lake Macquarie City FC": "LAK",
    "Maitland FC": "MAI",
    "New Lambton FC": "NEL",
    "Newcastle Olympic FC": "NEO",
}
FINAL_STAGES = {"Semi Finals": "SF", "Preliminary Final": "PF", "Grand Final": "GF"}


def prepare(source):
    if source.get("allRoundsHidden") or not isinstance(source.get("rounds"), list):
        raise ValueError("No visible rounds in snapshot")
    fixtures, clubs, byes, seen = [], {}, 0, set()
    for stage in source["rounds"]:
        if stage.get("isHidden"):
            raise ValueError("Hidden round needs separate review")
        label = stage["name"]
        if re.fullmatch(r"[1-9]\d*", label):
            prefix = "R" + label
            regular = True
        elif label in FINAL_STAGES:
            prefix, regular = FINAL_STAGES[label], False
        else:
            raise ValueError(f"Unsupported stage: {label}")
        for game_number, match in enumerate(sorted(stage["matches"], key=lambda m: m["id"]), 1):
            if match["competitionId"] != 1296 or match["divisionId"] != 9315:
                raise ValueError("Snapshot contains a different competition or division")
            if match["id"] in seen:
                raise ValueError("Duplicate Squadi match ID")
            seen.add(match["id"])
            home, away = match["team1"], match["team2"]
            if home["name"] == "Bye" or away["name"] == "Bye":
                byes += 1
                continue
            if match["matchStatus"] != "ENDED" or match["resultStatus"] != "FINAL":
                raise ValueError(f"Unconfirmed result: {match['id']}")
            if home["name"] not in CODES or away["name"] not in CODES:
                raise ValueError("Unreviewed club name in snapshot")
            if home["id"] != match["team1Id"] or away["id"] != match["team2Id"]:
                raise ValueError("Team identity mismatch")
            if home["id"] == away["id"]:
                raise ValueError("A club cannot play itself")
            scores = [match["team1Score"], match["team2Score"]]
            if any(type(s) is not int or s < 0 for s in scores):
                raise ValueError("Missing or invalid score")
            if regular and match["isFinals"]:
                raise ValueError("Numbered round marked as finals")
            if regular and match["hasPenalty"]:
                raise ValueError("Regular-season shootout requires review")
            shootout = None
            if match["hasPenalty"]:
                shootout = [match["team1PenaltyScore"], match["team2PenaltyScore"]]
                if (any(type(s) is not int or s < 0 for s in shootout)
                        or shootout[0] == shootout[1] or scores[0] != scores[1]):
                    raise ValueError("Invalid shootout result")
            kickoff = dt.datetime.fromisoformat(match["startTime"].replace("Z", "+00:00"))
            date = kickoff.astimezone(ZoneInfo("Australia/Sydney")).date().isoformat()
            if not date.startswith("2026-"):
                raise ValueError("Snapshot contains a different season")
            for team in (home, away):
                existing = clubs.get(team["name"])
                if existing and existing["id"] != team["id"]:
                    raise ValueError("Club has inconsistent source IDs")
                clubs[team["name"]] = team
            code = prefix if regular else f"{prefix}{game_number}"
            match_id = f"{code}-{CODES[home['name']]}-{CODES[away['name']]}"
            fixture = {
                "matchId": match_id, "matchDate": date,
                "homeTeam": home["name"], "awayTeam": away["name"],
                "homeGoals": scores[0], "awayGoals": scores[1],
                "venue": match.get("venueCourt", {}).get("venue", {}).get("name"),
            }
            fixtures.append({
                "body": fixture, "squadiMatchId": match["id"],
                "stage": label, "countsTowardLadder": regular,
                "sourceIsFinals": match["isFinals"],
                "shootout": shootout,
            })
    if set(clubs) != set(CODES):
        raise ValueError("Snapshot does not cover all seven reviewed clubs")
    if len({f["body"]["matchId"] for f in fixtures}) != len(fixtures):
        raise ValueError("Hub match IDs collide")
    if (len(fixtures), byes, sum(f["countsTowardLadder"] for f in fixtures)) != (67, 21, 63):
        raise ValueError("Snapshot differs from the reviewed complete 2026 season; review before importing")
    return fixtures, clubs, byes


class Hub:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, body=None):
        request = urllib.request.Request(
            self.base + path, method="POST" if body is not None else "GET",
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Never print login response bodies or request credentials.
            if path.startswith("/auth/"):
                raise RuntimeError(f"App sign-in failed (HTTP {error.code})") from None
            message = error.read().decode()[:500]
            raise RuntimeError(f"{path}: HTTP {error.code}: {message}") from None


def apply(hub, fixtures, clubs, focus, email, password):
    hub.request("/auth/login", {"email": email, "password": password})
    leagues = [l for l in hub.request("/leagues") if l["name"] == "NNSW NPLW"]
    if len(leagues) > 1:
        raise ValueError("Ambiguous target league")
    league = leagues[0] if leagues else hub.request("/leagues", {
        "name": "NNSW NPLW", "region": "Northern NSW", "focusClub": focus})
    if league.get("focusClub") != focus:
        raise ValueError("Existing league has a different focus club; no overwrite")
    seasons = [s for s in hub.request("/seasons")
               if s["leagueId"] == league["id"] and s["year"] == "2026"]
    if len(seasons) > 1:
        raise ValueError("Ambiguous target season")
    season = seasons[0] if seasons else hub.request("/seasons", {
        "leagueId": league["id"], "year": "2026", "label": "2026 Season", "isActive": True})
    existing_clubs = {c["name"] for c in hub.request("/clubs") if c["leagueId"] == league["id"]}
    for name, source in clubs.items():
        if name not in existing_clubs:
            hub.request("/clubs", {"leagueId": league["id"], "name": name,
                                  "primaryColor": "#888888", "logoUrl": source.get("logoUrl")})
    teams = [t for t in hub.request("/teams") if t.get("clubName") == focus
             and t["gender"] == "Women" and t["ageGroup"] == "First Grade"]
    if len(teams) > 1:
        raise ValueError("Ambiguous focus team")
    team = teams[0] if teams else hub.request("/teams", {
        "name": f"{focus} First Grade Women", "clubName": focus, "gender": "Women",
        "ageGroup": "First Grade", "analyticsEnabled": True})
    path = f"/entry/league-matches?seasonId={season['id']}"
    saved = hub.request(path)
    pending, skipped = [], 0
    for fixture in fixtures:
        body = fixture["body"]
        existing = [m for m in saved if m["matchId"] == body["matchId"] or
                    (m["matchDate"] == body["matchDate"] and
                     m["homeTeam"] == body["homeTeam"] and m["awayTeam"] == body["awayTeam"])]
        if existing:
            if len(existing) != 1 or any(existing[0].get(k) != body[k] for k in
                    ("matchId", "matchDate", "homeTeam", "awayTeam", "homeGoals", "awayGoals")):
                raise ValueError(f"Existing fixture differs: {body['matchId']}; no overwrite")
            skipped += 1
        else:
            pending.append(body)
    for body in pending:
        hub.request("/entry/match", {**body, "seasonId": season["id"], "teamId": team["id"]})
    verified = hub.request(path)
    expected = {f["body"]["matchId"]: f["body"] for f in fixtures}
    for stored in verified:
        body = expected.pop(stored["matchId"], None)
        if body and any(stored[k] != body[k] for k in
                ("matchDate", "homeTeam", "awayTeam", "homeGoals", "awayGoals")):
            raise ValueError("Saved fixture verification failed")
    if expected:
        raise ValueError("Some source fixtures are missing after import")
    return {"leagueId": league["id"], "seasonId": season["id"], "teamId": team["id"],
            "imported": len(pending), "alreadyPresent": skipped, "verified": len(fixtures)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--focus-club", choices=CODES, default="Maitland FC")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--base-url", default="http://localhost:80/api")
    parser.add_argument("--allow-live", action="store_true",
                        help="Explicitly permit an authorized production API target")
    parser.add_argument("--email")
    parser.add_argument("--password-secret", default="ADMIN_PASSWORD")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    fixtures, clubs, byes = prepare(json.loads(args.snapshot.read_text()))
    report = {"focusClub": args.focus_club, "matches": len(fixtures), "byesExcluded": byes,
              "regularSeason": sum(f["countsTowardLadder"] for f in fixtures),
              "finals": sum(not f["countsTowardLadder"] for f in fixtures),
              "scorelineGoals": sum(f["body"]["homeGoals"] + f["body"]["awayGoals"] for f in fixtures),
              "focusMatches": sum(args.focus_club in (f["body"]["homeTeam"], f["body"]["awayTeam"])
                                  for f in fixtures),
              "goalEventsImported": 0, "lineupsImported": 0, "fixtures": fixtures}
    if args.apply:
        target = urllib.parse.urlparse(args.base_url)
        if target.scheme not in ("http", "https"):
            raise ValueError("Invalid API URL")
        if target.hostname not in ("localhost", "127.0.0.1") and not args.allow_live:
            raise ValueError("Live target requires --allow-live and explicit authorization")
        password = os.environ.get(args.password_secret)
        if not args.email or not password:
            raise ValueError("Email and password environment secret are required")
        report["saved"] = apply(Hub(args.base_url), fixtures, clubs, args.focus_club,
                                args.email, password)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "fixtures"}, indent=2))


if __name__ == "__main__":
    main()