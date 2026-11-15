"""Turns the live sea layers (ghostfleet.sea) into API responses, with labelled statements.

Every record gets one OBSERVATION and then HYPOTHESES about what might have happened. The hypotheses are simple,
explainable rules over the record's own context (vessel type, protected area, distance from shore, known high-risk
areas). They are leads to check, never findings.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone
from statistics import median

from ..places import coord_label, high_risk_area, sea_name
from . import schemas as S

LIST_MAX = 2500          # newest AIS-off events returned with full statements; the density layer still uses them all
HOTSPOT_DEG = 2.0
OBS, INF, HYP, REC = (S.EpistemicLabel.OBSERVATION, S.EpistemicLabel.INFERENCE, S.EpistemicLabel.HYPOTHESIS,
                      S.EpistemicLabel.RECOMMENDATION)
TYPE_WORD = {"fishing": "fishing vessel", "cargo": "cargo ship", "carrier": "refrigerated carrier", "bunker": "bunker tanker"}


def _st(label, text) -> S.Statement:
    return S.Statement(label=label, text=text)


def pool_statements(resp, records: str = "events"):
    """?compact=true: send each distinct statement once per response. Most of a list's text is the same few explanatory
    sentences repeated on every record; each record then carries only indices into `statement_table`, in order."""
    table: list[S.Statement] = []
    index: dict[tuple, int] = {}
    for rec in getattr(resp, records):
        ids = []
        for st in rec.statements:
            key = (st.label, st.text)
            if key not in index:
                index[key] = len(table)
                table.append(st)
            ids.append(index[key])
        rec.statement_ids, rec.statements = ids, []
    resp.statement_table = table
    return resp


def _r(x, digits: int = 1):
    """GFW gives distances, speeds and durations to 13 decimals; a lead needs one or two."""
    return None if x is None else round(float(x), digits)


def _where(lat: float, lon: float) -> str:
    name = sea_name(lat, lon)
    if name.startswith("open"):
        return "in the open ocean"
    if name.startswith("waters"):
        return f"in {name}"
    return f"on the {name}" if name.endswith("Shelf") else f"in the {name}"


def _span(hours: float | None) -> str:
    if hours is None:
        return "an unknown time"
    return f"{hours:.0f} hours" if hours < 48 else f"{hours / 24:.0f} days"


def _day(iso: str | None) -> str:
    try:
        return datetime.fromisoformat((iso or "").replace("Z", "+00:00")).strftime("%-d %b %Y")
    except ValueError:
        return "an unknown date"


def _datetime_utc(iso: str | None) -> str:
    try:
        dt = datetime.fromisoformat((iso or "").replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y, %H:%M UTC")
    except (ValueError, AttributeError):
        return "an unknown time"


def _window_str(iso1: str | None, iso2: str | None) -> str:
    if not iso1 and not iso2:
        return "at an unknown time"
    if not iso1:
        return f"on {_datetime_utc(iso2)}"
    if not iso2 or iso1 == iso2:
        return f"on {_datetime_utc(iso1)}"
    d1 = _day(iso1)
    d2 = _day(iso2)
    t1 = _datetime_utc(iso1)
    t2 = _datetime_utc(iso2)
    if d1 == d2:
        h1 = iso1[11:16] if len(iso1) >= 16 else ""
        h2 = iso2[11:16] if len(iso2) >= 16 else ""
        if h1 and h2:
            return f"on {d1}, between {h1} and {h2} UTC"
    return f"between {t1} and {t2}"


def gap_hypotheses(vessel_type: str | None, lat: float, lon: float, shore_km: float | None, hours: float | None,
                   distance_km: float | None, in_mpa: bool, in_no_take: bool, high_seas: bool) -> list[S.Statement]:
    out = []
    risk = high_risk_area(lat, lon)
    fishing = vessel_type == "fishing"
    if fishing and in_no_take:
        out.append(_st(HYP, "Possible fishing inside a no-take protected area while not broadcasting. The area's managing "
                            "authority can say whether this vessel was authorised to be there."))
    elif fishing and in_mpa:
        out.append(_st(HYP, "Possible fishing inside a marine protected area while not broadcasting. Many protected areas "
                            "allow some fishing, so the area's own rules decide whether this matters."))
    if risk:
        out.append(_st(HYP, f"This is {risk}, where crews are advised they may switch AIS off to avoid piracy or attack. "
                            "That is a legitimate safety reason."))
    if shore_km is not None and shore_km < 20:
        out.append(_st(HYP, "Close to shore: the transponder may simply have been switched off in a port or anchorage."))
    if fishing and (high_seas or (shore_km or 0) > 370):
        out.append(_st(HYP, "On the high seas, fishing vessels often go dark to hide productive grounds from competitors, "
                            "or while meeting a carrier to hand over catch (transshipment)."))
    elif fishing and not in_no_take and (shore_km or 0) >= 20:
        out.append(_st(HYP, "Inside a national zone: possibly fishing where the vessel wants its position hidden, whether "
                            "from competitors or because it may lack a licence. The coastal state's licence list would settle it."))
    if vessel_type == "carrier":
        out.append(_st(HYP, "Refrigerated carriers that go dark near fishing fleets may be receiving catch at sea (transshipment)."))
    if vessel_type in ("cargo", "bunker") and not risk:
        out.append(_st(HYP, "Possibly a ship-to-ship transfer or a call the operator did not want recorded. It is also "
                            "consistent with equipment failure or maintenance."))
    if hours is not None and hours > 14 * 24:
        out.append(_st(HYP, "Dark for more than two weeks: long enough for a whole fishing trip or voyage to go unrecorded."))
    elif hours is not None and distance_km is not None and hours > 24 and distance_km < 20:
        out.append(_st(HYP, f"It reappeared only {distance_km:.0f} km away: consistent with drifting, anchoring or working one spot."))
    if not out:
        out.append(_st(HYP, "Nothing in the context points to a particular reason."))
    return out


def ais_off_event(e: dict) -> S.AisOffEvent:
    lat, lon, vt = float(e["lat"]), float(e["lon"]), e.get("vesselType")
    who = f"{e.get('vesselName') or 'An unnamed vessel'} ({TYPE_WORD.get(vt, vt or 'vessel of unknown type')}, flag {e.get('flag') or 'unknown'})"
    dist = f" and reappeared {e['distanceKm']:.0f} km away" if e.get("distanceKm") is not None else ""
    obs = f"{who} stopped broadcasting AIS {_where(lat, lon)} on {_day(e.get('start'))} for {_span(e.get('durationHours'))}{dist}."
    stmts = [_st(OBS, obs)]
    intentional = e.get("intentional", True)
    if not intentional:
        stmts.append(_st(INF, "Global Fishing Watch does not class this gap as intentional: reception was patchy before the signal "
                              "stopped, so it may simply be a gap in satellite or shore reception."))
    elif e.get("positionsBefore"):
        stmts.append(_st(INF, f"Global Fishing Watch classes this gap as likely intentional: {e['positionsBefore']:.0f} positions were "
                              "received in the 12 hours before it, so reception was good when the signal stopped."))
    stmts += gap_hypotheses(vt, lat, lon, e.get("shoreKm"), e.get("durationHours"), e.get("distanceKm"),
                            bool(e.get("inMpa")), bool(e.get("inNoTake")), bool(e.get("highSeas")))
    return S.AisOffEvent(id=e["id"], lat=lat, lon=lon, start=e.get("start"), end=e.get("end"),
                         duration_hours=e.get("durationHours"), distance_km=e.get("distanceKm"), vessel_name=e.get("vesselName"),
                         flag=e.get("flag"), vessel_type=vt, shore_km=e.get("shoreKm"), place=sea_name(lat, lon),
                         in_protected_area=bool(e.get("inMpa")), in_no_take=bool(e.get("inNoTake")),
                         high_seas=bool(e.get("highSeas")), statements=stmts, vessel_id=e.get("vesselId"), mmsi=e.get("mmsi"),
                         on_lat=e.get("onLat"), on_lon=e.get("onLon"), likely_intentional=bool(intentional),
                         no_take_area_ids=e.get("noTakeIds") or [], part_no_take_area_ids=e.get("partNoTakeIds") or [])


def _span_days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1


def _period_words(start: str, end: str) -> str:
    return f"between {_day(start)} and {_day(end)}"


def hotspots(events: list[dict], period: str, top: int = 12, min_count: int = 5) -> list[S.AisOffHotspot]:
    """Busiest 2° squares, skipping squares that touch a busier one already chosen. Stats use the square and its neighbours."""
    cells: dict[tuple[int, int], list[dict]] = {}
    for e in events:
        cells.setdefault((int(e["lat"] // HOTSPOT_DEG), int(e["lon"] // HOTSPOT_DEG)), []).append(e)
    chosen: list[tuple[int, int]] = []
    for c, evs in sorted(cells.items(), key=lambda kv: -len(kv[1])):
        if len(chosen) >= top or len(evs) < min_count:
            break
        if all(abs(c[0] - d[0]) > 1 or abs(c[1] - d[1]) > 1 for d in chosen):
            chosen.append(c)
    out = []
    for rank, (i, j) in enumerate(chosen, 1):
        evs = [e for di in (-1, 0, 1) for dj in (-1, 0, 1) for e in cells.get((i + di, j + dj), [])]
        lat, lon = sum(e["lat"] for e in evs) / len(evs), sum(e["lon"] for e in evs) / len(evs)
        types = Counter(e.get("vesselType") or "unknown" for e in evs)
        top_type, n_top = types.most_common(1)[0]
        flags = [f for f, _ in Counter(e.get("flag") for e in evs if e.get("flag")).most_common(3)]
        durs = [e["durationHours"] for e in evs if e.get("durationHours") is not None]
        med = median(durs) if durs else None
        shores = [e["shoreKm"] for e in evs if e.get("shoreKm") is not None]
        share = lambda key: sum(bool(e.get(key)) for e in evs) / len(evs)   # noqa: E731
        obs = (f"{len(evs)} vessels switched AIS off {_where(lat, lon)} (around {coord_label(lat, lon)}) {period}. "
               f"{n_top / len(evs):.0%} were {TYPE_WORD.get(top_type, top_type)}s"
               + (f", mostly flagged {', '.join(flags)}" if flags else "") + (f"; a typical gap lasted {_span(med)}." if med else "."))
        stmts = [_st(OBS, obs)] + gap_hypotheses(top_type, lat, lon, median(shores) if shores else None, med, None,
                                                 share("inMpa") > 0.3, share("inNoTake") > 0.3, share("highSeas") > 0.5)
        stmts.append(_st(REC, "Compare with the radar layer here: vessels seen by radar but not on AIS at the same place and "
                              "time would support a real change in behaviour over a reception problem."))
        out.append(S.AisOffHotspot(id=f"HOT-{rank:02d}", lat=round(lat, 3), lon=round(lon, 3), radius_km=330.0, count=len(evs),
                                   place=sea_name(lat, lon), top_vessel_type=top_type, top_vessel_type_share=n_top / len(evs),
                                   top_flags=flags, median_duration_hours=med, statements=stmts))
    out.sort(key=lambda h: -h.count)
    for rank, h in enumerate(out, 1):
        h.id = f"HOT-{rank:02d}"
    return out


def coordinated_turn_ons(events: list[dict], period_str: str, max_dist_deg: float = 2.2, min_overlap_sec: float = 1800.0) -> list[S.CoordinatedTurnOn]:
    """Areas where vessels turned off AIS while entering, operated dark together inside, and turned AIS on while exiting."""
    def parse_t(iso: str | None) -> float:
        if not iso:
            return 0.0
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    valid = []
    for e in events:
        if e.get("lat") is None or e.get("lon") is None or e.get("onLat") is None or e.get("onLon") is None:
            continue
        if not e.get("start") or not e.get("end"):
            continue
        t_start, t_end = parse_t(e["start"]), parse_t(e["end"])
        if t_end <= t_start:
            continue
        valid.append({
            "raw": e,
            "t_start": t_start,
            "t_end": t_end,
            "enter_lat": float(e["lat"]),
            "enter_lon": float(e["lon"]),
            "exit_lat": float(e["onLat"]),
            "exit_lon": float(e["onLon"]),
        })

    if not valid:
        return []

    # Sort by exit time so pairwise comparisons can break early outside the 24h window
    valid.sort(key=lambda v: v["t_end"])

    # Build pairwise adjacency for shared dark operations
    adj: dict[int, list[int]] = {i: [] for i in range(len(valid))}
    for i in range(len(valid)):
        v1 = valid[i]
        for j in range(i + 1, len(valid)):
            v2 = valid[j]
            if v2["t_end"] - v1["t_end"] > 24 * 3600:
                break
            overlap = min(v1["t_end"], v2["t_end"]) - max(v1["t_start"], v2["t_start"])
            if overlap < min_overlap_sec:
                continue
            d_enter = ((v1["enter_lat"] - v2["enter_lat"]) ** 2 + (v1["enter_lon"] - v2["enter_lon"]) ** 2) ** 0.5
            if d_enter > max_dist_deg:
                continue
            d_exit = ((v1["exit_lat"] - v2["exit_lat"]) ** 2 + (v1["exit_lon"] - v2["exit_lon"]) ** 2) ** 0.5
            if d_exit > max_dist_deg:
                continue
            adj[i].append(j)
            adj[j].append(i)

    # Greedily form clusters where all members spent concurrent time inside the area together
    clusters: list[list[dict]] = []
    visited: set[int] = set()
    nodes_by_degree = sorted(range(len(valid)), key=lambda idx: -len(adj[idx]))

    for node in nodes_by_degree:
        if node in visited or not adj[node]:
            continue
        group = [node]
        for nbr in sorted(adj[node], key=lambda n: -len(adj[n])):
            if nbr in visited:
                continue
            min_end = min(valid[m]["t_end"] for m in group + [nbr])
            max_start = max(valid[m]["t_start"] for m in group + [nbr])
            if min_end - max_start < min_overlap_sec:
                continue
            avg_en_lat = sum(valid[m]["enter_lat"] for m in group) / len(group)
            avg_en_lon = sum(valid[m]["enter_lon"] for m in group) / len(group)
            avg_ex_lat = sum(valid[m]["exit_lat"] for m in group) / len(group)
            avg_ex_lon = sum(valid[m]["exit_lon"] for m in group) / len(group)
            if ((valid[nbr]["enter_lat"] - avg_en_lat) ** 2 + (valid[nbr]["enter_lon"] - avg_en_lon) ** 2) ** 0.5 > max_dist_deg:
                continue
            if ((valid[nbr]["exit_lat"] - avg_ex_lat) ** 2 + (valid[nbr]["exit_lon"] - avg_ex_lon) ** 2) ** 0.5 > max_dist_deg:
                continue
            group.append(nbr)

        if len(group) >= 2:
            for m in group:
                visited.add(m)
            clusters.append([valid[m] for m in group])

    clusters.sort(key=lambda g: -len(g))
    out: list[S.CoordinatedTurnOn] = []
    for rank, g in enumerate(clusters[:30], 1):
        enter_lats = [v["enter_lat"] for v in g]
        enter_lons = [v["enter_lon"] for v in g]
        exit_lats = [v["exit_lat"] for v in g]
        exit_lons = [v["exit_lon"] for v in g]

        c_en_lat, c_en_lon = sum(enter_lats) / len(g), sum(enter_lons) / len(g)
        c_ex_lat, c_ex_lon = sum(exit_lats) / len(g), sum(exit_lons) / len(g)
        center_lat, center_lon = (c_en_lat + c_ex_lat) / 2.0, (c_en_lon + c_ex_lon) / 2.0

        min_end = min(v["t_end"] for v in g)
        max_start = max(v["t_start"] for v in g)
        shared_h = round(max(0.1, (min_end - max_start) / 3600.0), 1)

        co_start_iso = datetime.fromtimestamp(max_start, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        co_end_iso = datetime.fromtimestamp(min_end, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        co_start_str = _datetime_utc(co_start_iso)
        co_end_str = _datetime_utc(co_end_iso)

        end_times = [v["t_end"] for v in g]
        span_h = round((max(end_times) - min(end_times)) / 3600.0, 2)

        start_times = [v["t_start"] for v in g]
        raw_events = [v["raw"] for v in g]
        earliest_enter = min(raw_events, key=lambda e: parse_t(e.get("start"))).get("start")
        latest_enter = max(raw_events, key=lambda e: parse_t(e.get("start"))).get("start")
        earliest_exit = min(raw_events, key=lambda e: parse_t(e.get("end"))).get("end") or ""
        latest_exit = max(raw_events, key=lambda e: parse_t(e.get("end"))).get("end") or ""

        flags = [f for f, _ in Counter(e.get("flag") for e in raw_events if e.get("flag")).most_common(3)]
        types = [t for t, _ in Counter(e.get("vesselType") for e in raw_events if e.get("vesselType")).most_common(3)]
        all_types = set(e.get("vesselType") for e in raw_events)
        durs = [e["durationHours"] for e in raw_events if e.get("durationHours") is not None]
        med_dur = median(durs) if durs else None

        place = sea_name(center_lat, center_lon)
        span_word = f"{int(span_h * 60)} minutes" if span_h < 1 else _span(span_h)
        shared_word = f"{int(shared_h * 60)} minutes" if shared_h < 1 else _span(shared_h)
        type_summary = ", ".join(f"{c} {TYPE_WORD.get(t, t).lower()}s" for t, c in Counter(e.get("vesselType") for e in raw_events).items())

        enter_window = _window_str(earliest_enter, latest_enter)
        exit_window = _window_str(earliest_exit, latest_exit)

        obs = (f"{len(g)} vessels operated concurrently inside the {place} area with their AIS turned off "
               f"from {co_start_str} to {co_end_str} ({shared_word} together). "
               f"They ceased AIS transmissions upon entering around {coord_label(c_en_lat, c_en_lon)} {enter_window}, "
               f"and turned AIS back on while exiting around {coord_label(c_ex_lat, c_ex_lon)} {exit_window}. "
               f"Fleet composition: {type_summary}"
               + (f", mostly flagged {', '.join(flags)}" if flags else "")
               + (f"; median dark duration was {_span(med_dur)}." if med_dur else "."))

        stmts = [_st(OBS, obs)]
        stmts.append(_st(INF, f"Concurrent dark presence: All {len(g)} vessels were simultaneously in this area "
                              f"with AIS switched off between {co_start_str} and {co_end_str}. "
                              f"Synchronized entry and concurrent unmonitored presence in the same area for {shared_word}, "
                              f"followed by synchronized reconnection upon exit (within {span_word}), indicates coordinated fleet command."))

        has_cargo_or_carrier = bool(all_types & {"carrier", "cargo", "bunker"})
        has_fishing = "fishing" in all_types
        if has_cargo_or_carrier and has_fishing:
            stmts.append(_st(HYP, "Transshipment rendezvous: A cargo/carrier/bunker vessel and fishing vessels turned off transponders "
                                  "upon entering the area and reappeared together. Consistent with an at-sea meeting to offload catch or "
                                  "refuel while dark before parting ways upon exit."))
        elif all_types == {"fishing"} and len(flags) == 1:
            stmts.append(_st(HYP, f"Sister fleet sweep: All {len(g)} vessels are {flags[0]}-flagged fishing vessels that went dark "
                                  "upon entering and reactivated together upon exiting. Consistent with a coordinated flotilla operating "
                                  "dark together to conceal productive fishing grounds or joint sweeps."))
        elif any(e.get("highSeas") for e in raw_events) and any(e.get("shoreKm") is not None and e["shoreKm"] < 370 for e in raw_events):
            stmts.append(_st(HYP, "Border zone incursion: Dark entry and exit points frame an EEZ boundary. Vessels may have operated dark "
                                  "inside coastal or restricted waters and reactivated transponders upon exiting back to the high seas."))
        else:
            stmts.append(_st(HYP, "Synchronized flotilla transit: Vessels moving in convoy, entering and traversing the area dark under "
                                  "shared command, and turning transponders back on in unison upon reaching their exit waypoint."))

        v_list = [
            S.CoordinatedTurnOnVessel(
                vessel_id=v["raw"].get("vesselId"),
                vessel_name=v["raw"].get("vesselName"),
                vessel_type=v["raw"].get("vesselType"),
                flag=v["raw"].get("flag"),
                start=v["raw"].get("start"),
                end=v["raw"].get("end"),
                duration_hours=v["raw"].get("durationHours"),
                distance_km=v["raw"].get("distanceKm"),
                enter_lat=round(v["enter_lat"], 4),
                enter_lon=round(v["enter_lon"], 4),
                exit_lat=round(v["exit_lat"], 4),
                exit_lon=round(v["exit_lon"], 4),
                lat=round(v["exit_lat"], 4),
                lon=round(v["exit_lon"], 4),
            )
            for v in g
        ]

        all_lats = enter_lats + exit_lats
        all_lons = enter_lons + exit_lons
        max_radius = 50.0
        if len(all_lats) > 1:
            max_radius = max(50.0, max(((la - center_lat) ** 2 + (lo - center_lon) ** 2) ** 0.5 * 111 for la, lo in zip(all_lats, all_lons)))

        out.append(S.CoordinatedTurnOn(
            id=f"TURNON-{rank:02d}",
            lat=round(center_lat, 3),
            lon=round(center_lon, 3),
            enter_lat=round(c_en_lat, 3),
            enter_lon=round(c_en_lon, 3),
            exit_lat=round(c_ex_lat, 3),
            exit_lon=round(c_ex_lon, 3),
            radius_km=round(max_radius, 1),
            count=len(g),
            shared_hours=shared_h,
            span_hours=span_h,
            co_presence_start=co_start_iso,
            co_presence_end=co_end_iso,
            earliest=earliest_exit,
            latest=latest_exit,
            earliest_enter=earliest_enter,
            latest_enter=latest_enter,
            place=place,
            top_flags=flags,
            vessel_types=types,
            vessels=v_list,
            statements=stmts,
        ))
    return out


def ais_off(d: dict) -> S.AisOffResponse:
    evs, start, end = d["events"], d["start"], d["end"]
    days = _span_days(start, end)
    listed = [ais_off_event(e) for e in evs[:LIST_MAX]]        # newest first
    period_words = _period_words(start, end)
    return S.AisOffResponse(is_demo_data=False, fetched_at=d["fetchedAt"], window_days=days, recent_days=days,
                            total=len(evs), events=listed, hotspots=hotspots(evs, period_words),
                            turn_on_clusters=coordinated_turn_ons(evs, period_words),
                            heat=[(round(e["lat"], 2), round(e["lon"], 2)) for e in evs],
                            start=start, end=end, truncated=bool(d.get("truncated")))


SLICK_HYP = {
    "VESSEL": "Cerulean matched a vessel's AIS track to this slick: consistent with oily bilge water or tank washings discharged under way.",
    "INFRASTRUCTURE": "The nearest candidate source is offshore oil or gas infrastructure: consistent with a leak or an operational discharge.",
    "DARK_VESSEL": "The nearest candidate source is a vessel seen on radar that was not broadcasting AIS.",
    "NATURAL": "The nearest candidate source is a known natural oil seep.",
    "UNKNOWN": "No source was matched. It could be a discharge from a vessel, a natural seep, or a look-alike such as calm water, algae or ice.",
}


CANDIDATE_WORD = {"VESSEL": "a ship on AIS", "DARK_VESSEL": "a ship seen on radar but not on AIS",
                  "INFRASTRUCTURE": "an offshore structure", "UNKNOWN": "an unidentified source"}


def slicks(d: dict, gaps: list[dict] | None = None) -> S.SlicksResponse:
    """Slicks with Cerulean's ranked candidate sources, each AIS candidate cross-checked against AIS switched off within 48 h."""
    dark_by_mmsi: dict[str, list] = {}
    names: dict[str, str] = {}
    for g in gaps or []:
        if g.get("mmsi"):
            dark_by_mmsi.setdefault(str(g["mmsi"]), []).append((_ts(g.get("start")), _ts(g.get("end"))))
            if g.get("vesselName"):
                names[str(g["mmsi"])] = g["vesselName"]
    out = []
    for k in d["slicks"]:
        lat, lon = float(k["lat"]), float(k["lon"])
        t = _ts(k.get("time"))
        cands = [S.SlickCandidate(**c, went_dark=c["type"] == "VESSEL" and _near(dark_by_mmsi.get(c["ref"], []), t, t, DARK_LINK_H),
                                  vessel_name=names.get(c["ref"])) for c in k.get("candidates", [])]
        obs = (f"A possible oil slick of about {k['areaKm2']:.0f} km² ({k['lengthKm']:.0f} km long) was detected on Sentinel-1 radar "
               f"{_where(lat, lon)} on {_day(k.get('time'))}.")
        stmts = [_st(OBS, obs),
                 _st(INF, f"Detected by a machine-learning model (confidence {min(k['confidence'], 0.99):.0%}) and not checked by a person.")]
        if cands:
            best = cands[0]
            who = f"{best.vessel_name} (MMSI {best.ref})" if best.vessel_name else (f"MMSI {best.ref}" if best.type == "VESSEL" else best.ref)
            others = f" ({len(cands)} candidates ranked)" if len(cands) > 1 else ""
            stmts.append(_st(INF, f"Cerulean's best-matching candidate source is {CANDIDATE_WORD[best.type]}, {who}{others}. "
                                  "It ranks ships whose AIS track passed the slick close to the time of the radar image, and structures "
                                  "beside it, by how well they fit its shape; a match is not evidence that the source released oil."))
            for c in cands:
                if c.went_dark:
                    stmts.append(_st(OBS, f"Candidate MMSI {c.ref}{f' ({c.vessel_name})' if c.vessel_name else ''} switched AIS off "
                                          f"(classed as likely intentional) within {DARK_LINK_H} hours of the slick."))
            what = ("A leak from the structure" if best.type == "INFRASTRUCTURE" else
                    "Possible illegal discharge (for example bilge or tank washing) by the top candidate")
            stmts.append(_st(HYP, what + (", made more worth checking by an AIS switch-off" if any(c.went_dark for c in cands) else "")
                                  + ". Also consistent with a natural seep, an earlier spill drifting, or a look-alike such as low wind."))
            stmts.append(_st(REC, "Check the radar image, then ask the flag or port state to inspect the candidate's oil record book."))
        else:
            stmts.append(_st(HYP, SLICK_HYP[k["possibleSource"]]))
        out.append(S.OilSlick(id=k["id"], lat=lat, lon=lon, time=k.get("time"), area_km2=k["areaKm2"], length_km=k["lengthKm"],
                              confidence=k["confidence"], possible_source=k["possibleSource"], place=sea_name(lat, lon),
                              url=k.get("url"), statements=stmts, candidates=cands))
    return S.SlicksResponse(is_demo_data=False, fetched_at=d["fetchedAt"], window_days=_span_days(d["start"], d["end"]),
                            total_matched=d.get("matched"), slicks=out, start=d["start"], end=d["end"],
                            candidates_available=d.get("candidatesAvailable", True))


def protected_fishing(d: dict, start: str | None = None, end: str | None = None) -> S.ProtectedFishingResponse:
    out = []
    for e in d["events"]:
        if start and end and not ((e.get("start") or "")[:10] <= end and (e.get("end") or e.get("start") or "")[:10] >= start):
            continue
        lat, lon = float(e["lat"]), float(e["lon"])
        who = f"{e.get('vesselName') or 'An unnamed vessel'} (flag {e.get('flag') or 'unknown'})"
        area = "a no-take marine protected area" if e.get("fullNoTake") else "a marine protected area that is partly no-take"
        obs = (f"{who} showed apparent fishing movement inside {area} {_where(lat, lon)} on {_day(e.get('start'))}"
               + (f", for about {_span(e['durationHours'])}." if e.get("durationHours") else "."))
        stmts = [_st(OBS, obs),
                 _st(INF, "\"Apparent fishing\" is inferred by Global Fishing Watch from how the vessel moved on AIS. It is not a sighting of gear in the water."),
                 _st(HYP, "Possible unauthorised fishing. It is also consistent with a permitted vessel, research, transit at fishing-like "
                          "speed, or activity in the part of the area where fishing is allowed."),
                 _st(REC, "Check the vessel against the area's permit list before drawing any conclusion.")]
        out.append(S.ProtectedFishingEvent(id=e["id"], lat=lat, lon=lon, start=e.get("start"), end=e.get("end"),
                                           duration_hours=e.get("durationHours"), vessel_name=e.get("vesselName"), flag=e.get("flag"),
                                           vessel_type=e.get("vesselType"), shore_km=e.get("shoreKm"),
                                           full_no_take=bool(e.get("fullNoTake")), place=sea_name(lat, lon), statements=stmts,
                                           vessel_id=e.get("vesselId"), area_ids=e.get("areaIds") or []))
    return S.ProtectedFishingResponse(is_demo_data=False, fetched_at=d["fetchedAt"], days=d["days"], scanned=d["scanned"], events=out,
                                      start=start, end=end)


KIND_WORDS = {"fishing": ("stretch of apparent fishing", "stretches of apparent fishing"), "loitering": ("spell of loitering", "spells of loitering"),
              "port_visit": ("port call", "port calls"), "encounter": ("meeting with another vessel", "meetings with other vessels")}


def identity(i: dict) -> S.VesselIdentity:
    return S.VesselIdentity(vessel_id=i["vesselId"], name=i.get("name"), flag=i.get("flag"), mmsi=i.get("mmsi"), imo=i.get("imo"),
                            callsign=i.get("callsign"), gear=i.get("gear") or [], length_m=i.get("lengthM"), tonnage_gt=i.get("tonnageGt"),
                            transmits_from=i.get("transmitsFrom"), transmits_to=i.get("transmitsTo"))


def vessel(d: dict) -> S.VesselResponse:
    """A ship's path through its recorded events, and every time it went dark."""
    ident, start, end = d["identity"], d["start"], d["end"]
    ident = {**ident, "vesselId": ident.get("vesselId") or d["vesselId"]}
    vtype = "fishing" if any("FISH" in g or "LONGLINE" in g or "TRAWL" in g or "SEINE" in g or "JIG" in g for g in ident.get("gear") or []) else None
    points, gaps, counts = [], [], {}
    for e in sorted(d["events"], key=lambda x: x.get("start") or ""):
        kind = e["kind"]
        if kind == "gap":
            g = {**e["gap"], "vesselName": e["gap"].get("vesselName") or ident.get("name"), "flag": e["gap"].get("flag") or ident.get("flag"),
                 "vesselType": e["gap"].get("vesselType") or vtype, "vesselId": ident["vesselId"]}
            counts["gap"] = counts.get("gap", 0) + 1
            gaps.append(ais_off_event(g))
            points.append(S.VesselPoint(time=e["start"], lat=g["lat"], lon=g["lon"], kind="gap_off", label=None, event_id=e["id"]))
            if g.get("onLat") is not None and g.get("onLon") is not None and e.get("end"):
                points.append(S.VesselPoint(time=e["end"], lat=g["onLat"], lon=g["onLon"], kind="gap_on", label=None, event_id=e["id"]))
        elif kind in KIND_WORDS:
            counts[kind] = counts.get(kind, 0) + 1
            points.append(S.VesselPoint(time=e["start"], lat=e["lat"], lon=e["lon"], kind=kind, label=e.get("label"), event_id=e["id"]))
    points.sort(key=lambda p: p.time)
    name = ident.get("name") or "This vessel"
    parts = [f"{n} {KIND_WORDS[k][0] if n == 1 else KIND_WORDS[k][1]}" for k, n in counts.items() if k in KIND_WORDS]
    dark_h = sum(g.duration_hours or 0 for g in gaps)
    if points:
        obs = (f"{name} has {len(d['events'])} recorded events {_period_words(start, end)}"
               + (f": {', '.join(parts)}" if parts else "") + ". "
               + (f"It stopped broadcasting AIS {len(gaps)} {'time' if len(gaps) == 1 else 'times'}, for {_span(dark_h)} in all."
                  if gaps else "It did not stop broadcasting AIS in that time."))
    else:
        obs = f"{name} has no recorded events {_period_words(start, end)}. It may have been in port, out of AIS range, or not broadcasting."
    stmts = [_st(OBS, obs),
             _st(INF, "The path is drawn through these events in time order. It is not the ship's full track: positions between "
                      "events are not shown, because raw AIS tracks are not part of the free data. Dashed stretches were sailed unseen.")]
    return S.VesselResponse(is_demo_data=False, fetched_at=d["fetchedAt"], start=start, end=end, truncated=bool(d.get("truncated")),
                            identity=identity(ident), points=points, gaps=gaps, counts=counts, statements=stmts)


# ---------- encounters, loitering, insights, seasonal closures ----------
DARK_LINK_H = 48
MEET_LINK_H = 24
PARTY_WORD = {"carrier": "refrigerated carrier", "bunker": "bunker tanker", "support": "support vessel", "tanker": "tanker",
              "fishing": "fishing vessel"}
AUTH_SENTENCE = {"AUTHORISED": "has a matching public RFMO authorisation", "PARTLY": "has a partly matching public RFMO authorisation",
                 "NOT_FOUND": "has no matching public RFMO authorisation on record", "UNKNOWN": "has no authorisation information"}


def _ts(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()   # Cerulean's times carry no zone: they are UTC


def _gaps_by_vessel(gaps: list[dict]) -> dict[str, list[tuple[float | None, float | None]]]:
    out: dict[str, list] = {}
    for g in gaps:
        if g.get("vesselId"):
            out.setdefault(g["vesselId"], []).append((_ts(g.get("start")), _ts(g.get("end"))))
    return out


def _near(windows: list, t0: float | None, t1: float | None, hours: float) -> bool:
    """Does any (start, end) window begin or end within `hours` of the span t0..t1?"""
    if t0 is None:
        return False
    lo, hi = t0 - hours * 3600, (t1 or t0) + hours * 3600
    return any((s is not None and lo <= s <= hi) or (e is not None and lo <= e <= hi) for s, e in windows)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _who(v: dict) -> str:
    return f"{v.get('name') or 'an unnamed vessel'} ({PARTY_WORD.get(v.get('vesselType') or '', v.get('vesselType') or 'vessel')}, flag {v.get('flag') or 'unknown'})"


def encounters(d: dict, gaps: list[dict]) -> S.EncountersResponse:
    """Meetings at sea, each cross-checked against intentional AIS gaps of either vessel within 48 hours."""
    by_vessel = _gaps_by_vessel(gaps)
    out = []
    for e in d["events"]:
        lat, lon = float(e["lat"]), float(e["lon"])
        t0, t1 = _ts(e.get("start")), _ts(e.get("end"))
        vessels = [S.EncounterVessel(**v, went_dark=_near(by_vessel.get(v.get("vesselId") or "", []), t0, t1, DARK_LINK_H))
                   for v in e["vessels"]]
        dark = any(v.went_dark for v in vessels)
        a, b = e["vessels"][0], e["vessels"][1]
        dist = f"{round((e.get('medianDistanceKm') or 0) * 1000):,} m" if e.get("medianDistanceKm") is not None else "close"
        obs = (f"{_cap(_who(a))} and {_who(b)} stayed about {dist} apart"
               + (f" at {e['medianSpeedKnots']:.1f} knots" if e.get("medianSpeedKnots") is not None else "")
               + f" for {_span(e.get('durationHours'))}, from {_day(e.get('start'))}, {_where(lat, lon)}"
               + (f", {round(e['shoreKm']):,} km from shore." if e.get("shoreKm") is not None else "."))
        stmts = [_st(OBS, obs)]
        auth_bits = [f"{v.name or 'One vessel'} {AUTH_SENTENCE[v.authorisation.value]}" for v in vessels
                     if v.authorisation != S.Authorisation.UNKNOWN]
        if auth_bits:
            stmts.append(_st(OBS, "Public registries: " + "; ".join(auth_bits) + "."))
        if dark:
            names = ", ".join(v.name or "an unnamed vessel" for v in vessels if v.went_dark)
            stmts.append(_st(OBS, f"{names} switched AIS off (classed as likely intentional) within {DARK_LINK_H} hours of this meeting."))
        stmts.append(_st(INF, "Two vessels holding station side by side for hours is how catch, crew or fuel is moved at sea. "
                              "Global Fishing Watch detects it from AIS; nobody saw a transfer."))
        if dark and any(v.authorisation == S.Authorisation.NOT_FOUND for v in vessels):
            stmts.append(_st(HYP, "Possible unreported transshipment: a meeting involving a vessel with no public authorisation on record, "
                                  "next to AIS being switched off. Also consistent with a declared transfer, a crew change or bad reception."))
        elif dark:
            stmts.append(_st(HYP, "Switching AIS off around a meeting is consistent with hiding where the catch went. "
                                  "It is also consistent with reception gaps far offshore or routine privacy."))
        else:
            stmts.append(_st(HYP, "Consistent with a routine, declared transshipment or refuelling; the record alone cannot tell."))
        stmts.append(_st(REC, "Check the RFMO's transshipment declarations and observer records for these vessels and dates."))
        out.append(S.Encounter(id=e["id"], lat=lat, lon=lon, start=e.get("start"), end=e.get("end"),
                               duration_hours=_r(e.get("durationHours")), type=e.get("type"),
                               median_distance_km=_r(e.get("medianDistanceKm"), 3), median_speed_knots=_r(e.get("medianSpeedKnots"), 2),
                               potential_risk=bool(e.get("potentialRisk")), shore_km=_r(e.get("shoreKm")), high_seas=bool(e.get("highSeas")),
                               place=sea_name(lat, lon), rfmo=e.get("rfmo") or [], vessels=vessels, dark_link=dark,
                               statements=stmts))
    # strongest leads first: AIS off nearby, then GFW's risk flag, then the longest meetings
    out.sort(key=lambda x: (not x.dark_link, not x.potential_risk, -(x.duration_hours or 0)))
    return S.EncountersResponse(is_demo_data=False, fetched_at=d["fetchedAt"], start=d["start"], end=d["end"],
                                truncated=d["truncated"], total=len(out), events=out)


def loitering(d: dict, enc: list[dict]) -> S.LoiteringResponse:
    """Carriers and bunkers loitering far offshore, each checked for a recorded meeting within 24 hours."""
    met: dict[str, list] = {}
    for e in enc:
        for v in e["vessels"]:
            if v.get("vesselId"):
                met.setdefault(v["vesselId"], []).append((_ts(e.get("start")), _ts(e.get("end"))))
    out = []
    for e in d["events"]:
        lat, lon = float(e["lat"]), float(e["lon"])
        hit = _near(met.get(e.get("vesselId") or "", []), _ts(e.get("start")), _ts(e.get("end")), MEET_LINK_H)
        who = _who({"name": e.get("vesselName"), "vesselType": e.get("vesselType"), "flag": e.get("flag")})
        obs = (f"{_cap(who)} drifted or idled for {_span(e.get('durationHours'))}"
               + (f" at {e['speedKnots']:.1f} knots on average" if e.get("speedKnots") is not None else "")
               + f", about {round(e.get('shoreKm') or 0):,} km from shore {_where(lat, lon)}, from {_day(e.get('start'))}.")
        stmts = [_st(OBS, obs)]
        if hit:
            stmts.append(_st(OBS, f"It had a recorded encounter with another vessel within {MEET_LINK_H} hours."))
        stmts += [_st(INF, "Carriers and bunker tankers wait far from port to meet fishing vessels; the wait itself shows on AIS as loitering."),
                  _st(HYP, "Waiting for a transshipment or refuelling rendezvous" + (", which the recorded encounter supports." if hit else
                           ". Also consistent with waiting for orders, a berth, or better weather.")),
                  _st(REC, "Look for fishing vessels nearby that went dark at the same time, and the RFMO's transshipment records.")]
        out.append(S.Loitering(id=e["id"], lat=lat, lon=lon, start=e.get("start"), end=e.get("end"),
                               duration_hours=_r(e.get("durationHours")), distance_km=_r(e.get("distanceKm")),
                               speed_knots=_r(e.get("speedKnots"), 2), shore_km=_r(e.get("shoreKm")), high_seas=bool(e.get("highSeas")), place=sea_name(lat, lon),
                               vessel_id=e.get("vesselId"), vessel_name=e.get("vesselName"), flag=e.get("flag"),
                               vessel_type=e.get("vesselType"), met_vessel=hit, statements=stmts))
    out.sort(key=lambda x: (not x.met_vessel, -(x.duration_hours or 0)))
    return S.LoiteringResponse(is_demo_data=False, fetched_at=d["fetchedAt"], start=d["start"], end=d["end"],
                               truncated=d["truncated"], total=len(out), events=out)


def _int(x) -> int | None:
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def insights(d: dict) -> S.VesselInsights:
    r = d["raw"]
    fish = (r.get("apparentFishing") or {}).get("periodSelectedCounters") or {}
    gap = (r.get("gap") or {}).get("periodSelectedCounters") or {}
    iuu = ((r.get("vesselIdentity") or {}).get("iuuVesselList")) or {}
    cov = (r.get("coverage") or {}).get("percentage")
    listed_now = bool(iuu.get("totalTimesListedInThePeriod")) or bool(iuu.get("valuesInThePeriod"))
    times = _int(iuu.get("totalTimesListed")) or 0
    no_auth, no_take = _int(fish.get("eventsInRFMOWithoutKnownAuthorization")), _int(fish.get("eventsInNoTakeMPAs"))
    stmts = []
    if listed_now:
        stmts.append(_st(OBS, "This vessel is on an RFMO illegal, unreported and unregulated (IUU) vessel list in this period."))
    elif times:
        stmts.append(_st(OBS, f"This vessel has appeared on an RFMO IUU vessel list {times} time(s), though not in this period."))
    else:
        stmts.append(_st(OBS, "This vessel does not appear on any RFMO IUU vessel list."))
    if fish.get("events") is not None:
        stmts.append(_st(OBS, f"{_int(fish.get('events'))} apparent-fishing events in the period: {no_auth or 0} inside an RFMO area where "
                              f"no public authorisation for it was found, {no_take or 0} inside a no-take protected area."))
    if no_auth:
        stmts.append(_st(INF, "Missing from public authorisation lists is not proof of fishing without a licence: lists are incomplete "
                              "and some fisheries do not publish them."))
    if cov is not None and cov < 50:
        stmts.append(_st(INF, f"AIS positions cover only {round(cov)}% of the period, so much of what it did is not on record."))
    if listed_now or no_auth or no_take:
        stmts.append(_st(REC, "Ask the flag state and the RFMO for the vessel's licences for these areas and dates."))
    return S.VesselInsights(is_demo_data=False, fetched_at=d["fetchedAt"], vessel_id=d["vesselId"], start=d["start"], end=d["end"],
                            iuu_listed_in_period=listed_now, iuu_times_listed=times, fishing_events=_int(fish.get("events")),
                            fishing_in_rfmo_without_known_authorisation=no_auth, fishing_in_no_take_mpas=no_take,
                            ais_off_events=_int(gap.get("events")), coverage_pct=round(cov, 1) if cov is not None else None,
                            statements=stmts)


_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _md(mmdd: str) -> str:
    m, dd = map(int, mmdd.split("-"))
    return f"{dd} {_MON[m - 1]}"


def closures(d: dict) -> S.ClosuresResponse:
    out = []
    for c in d["closures"]:
        seasons = []
        for s in c["seasons"]:
            r = s.get("ratio")
            obs = (f"AIS-broadcasting vessels logged {round(s['hoursDuring']):,} hours of apparent fishing in the waters covered by the {c['name']} "
                   f"during the ban ({_day(s['start'])} to {_day(s['end'])}), against {round(s['hoursBefore']):,} hours in the "
                   f"{s['days']} days before and {round(s['hoursAfter']):,} hours in the {s['days']} days after.")
            stmts = [_st(OBS, obs)]
            if r is not None:
                drop = round((1 - r) * 100)
                stmts.append(_st(INF, f"Fishing during the ban was {drop}% below the surrounding weeks." if drop > 0 else
                                      f"Fishing during the ban was not lower than the surrounding weeks ({round(r * 100)}% of their level)."))
                stmts.append(_st(INF, "Weather and fish migration also change effort between seasons (the monsoon keeps many boats in "
                                      "port), so the difference is not all the ban's doing."))
            if s["hoursDuring"] > 0:
                stmts.append(_st(HYP, "The remaining effort may be exempt vessels (traditional craft, territorial waters, licensed fleets), "
                                      "transit misread as fishing, or fishing in breach of the ban."))
                stmts.append(_st(REC, "Compare the busiest cells with the fisheries department's exemptions and patrol records."))
            seasons.append(S.ClosureSeason(id=f"{c['id']}-{s['year']}", **{k: v for k, v in s.items() if k != "cells"},
                                           cells=[S.ClosureCell(**x) for x in s["cells"]], statements=stmts))
        out.append(S.Closure(id=c["id"], country=c["country"], name=c["name"], eez=c["eez"],
                             window=f"{_md(c['from'])} to {_md(c['to'])}", scope=c["scope"],
                             confidence=S.ConfidenceLevel(c["confidence"]), sources=c["sources"], seasons=seasons))
    return S.ClosuresResponse(is_demo_data=False, fetched_at=d["fetchedAt"], closures=out)
