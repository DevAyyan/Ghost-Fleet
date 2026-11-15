"""Encounters, loitering, vessel insights and seasonal closures: cross-checks and wording."""
from ghostfleet.api import sea_service
from ghostfleet.sea import auth_word, slim_encounter

RAW_ENC = {
    "id": "e1.1", "start": "2026-10-20T10:00:00.000Z", "end": "2026-10-20T16:00:00.000Z", "type": "encounter",
    "position": {"lat": -20.0, "lon": 60.0}, "regions": {"highSeas": ["high_seas"], "eez": [], "rfmo": ["IOTC"]},
    "distances": {"startDistanceFromShoreKm": 700},
    "vessel": {"id": "carrier-1", "name": "COLD STAR", "ssvid": "1", "flag": "PAN", "type": "carrier"},
    "encounter": {"vessel": {"id": "fisher-1", "name": "LUCKY 7", "ssvid": "2", "flag": "XYZ", "type": "fishing"},
                  "medianDistanceKilometers": 0.03, "medianSpeedKnots": 0.4, "type": "carrier-fishing", "potentialRisk": True,
                  "mainVesselPublicAuthorizationStatus": "publicly_authorized",
                  "encounteredVesselPublicAuthorizationStatus": "not_matching_relevant_public_authorization"}}


def test_authorisation_words():
    assert auth_word("publicly_authorized") == "AUTHORISED"
    assert auth_word("not_matching_relevant_public_authorization") == "NOT_FOUND"
    assert auth_word(None) == "UNKNOWN"


def test_encounter_is_linked_to_a_nearby_switch_off_and_ranked_first():
    enc = slim_encounter(RAW_ENC)
    quiet = {**enc, "id": "e2", "vessels": [{**v, "vesselId": v["vesselId"] + "-other"} for v in enc["vessels"]]}
    gaps = [{"vesselId": "fisher-1", "start": "2026-10-21T08:00:00.000Z", "end": "2026-10-22T08:00:00.000Z"}]
    r = sea_service.encounters({"fetchedAt": "x", "start": "2026-10-20", "end": "2026-10-21", "truncated": False,
                                "events": [quiet, enc]}, gaps)
    top = r.events[0]
    assert top.id == "e1.1" and top.dark_link and [v.went_dark for v in top.vessels] == [False, True]
    assert top.vessels[1].authorisation.value == "NOT_FOUND"
    text = " ".join(s.text for s in top.statements)
    assert "COLD STAR (refrigerated carrier, flag PAN)" in text and "no matching public RFMO authorisation" in text
    assert "Possible unreported transshipment" in text
    assert not r.events[1].dark_link
    labels = [s.label.value for s in top.statements]
    assert labels[0] == "OBSERVATION" and "HYPOTHESIS" in labels and labels[-1] == "RECOMMENDATION"


def test_loitering_carrier_that_met_a_vessel_is_flagged():
    enc = slim_encounter(RAW_ENC)
    loi = {"id": "l1", "lat": -20.1, "lon": 60.1, "start": "2026-10-19T00:00:00Z", "end": "2026-10-20T09:00:00Z",
           "durationHours": 33.0, "distanceKm": 20.0, "speedKnots": 0.3, "shoreKm": 690.0, "highSeas": True, "eez": [],
           "vesselId": "carrier-1", "vesselName": "COLD STAR", "flag": "PAN", "vesselType": "carrier", "mmsi": "1"}
    r = sea_service.loitering({"fetchedAt": "x", "start": "a", "end": "b", "truncated": False, "events": [loi]}, [enc])
    assert r.events[0].met_vessel
    assert any("recorded encounter" in s.text for s in r.events[0].statements)


def test_insights_never_turn_a_missing_licence_into_a_finding():
    raw = {"apparentFishing": {"periodSelectedCounters": {"events": 7, "eventsInRFMOWithoutKnownAuthorization": 5, "eventsInNoTakeMPAs": 0}},
           "gap": {"periodSelectedCounters": {"events": 2}}, "coverage": {"percentage": 40.0},
           "vesselIdentity": {"iuuVesselList": {"valuesInThePeriod": [], "totalTimesListed": 0, "totalTimesListedInThePeriod": 0}}}
    r = sea_service.insights({"fetchedAt": "x", "vesselId": "v", "start": "a", "end": "b", "raw": raw})
    assert not r.iuu_listed_in_period and r.fishing_in_rfmo_without_known_authorisation == 5 and r.ais_off_events == 2
    text = " ".join(s.text for s in r.statements)
    assert "not proof" in text and "40%" in text


def test_closure_season_compares_the_ban_with_the_weeks_around_it():
    d = {"fetchedAt": "x", "closures": [{
        "id": "IN-W", "country": "India", "name": "India west coast monsoon ban", "eez": "8480", "from": "06-01", "to": "07-31",
        "confidence": "HIGH", "scope": "s", "sources": ["u"],
        "seasons": [{"year": 2026, "start": "2026-06-01", "end": "2026-07-31", "days": 61, "hoursBefore": 1000.0,
                     "hoursDuring": 100.0, "hoursAfter": 1000.0, "ratio": 0.1, "cellsDuring": 1,
                     "cells": [{"lat": 15.0, "lon": 72.0, "hours": 100.0, "vessels": 3}]}]}]}
    r = sea_service.closures(d)
    c = r.closures[0]
    assert c.window == "1 Jun to 31 Jul" and c.seasons[0].id == "IN-W-2026"
    text = " ".join(s.text for s in c.seasons[0].statements)
    assert "90% below" in text and "not all the ban's doing" in text and "exempt" in text


def test_slick_candidates_are_ranked_and_cross_checked_with_ais_switch_offs():
    d = {"fetchedAt": "x", "start": "2026-10-20", "end": "2026-10-30", "matched": 1, "candidatesAvailable": True, "slicks": [{
        "id": "9", "lat": 26.0, "lon": 56.5, "time": "2026-10-26T07:16:54", "areaKm2": 40.0, "lengthKm": 30.0, "confidence": 0.97,
        "possibleSource": "VESSEL", "url": None,
        "candidates": [{"rank": 1, "type": "VESSEL", "ref": "111", "score": -0.8, "url": "u"},
                       {"rank": 2, "type": "DARK_VESSEL", "ref": "D1.2", "score": -2.0, "url": None}]}]}
    gaps = [{"mmsi": "111", "vesselName": "SLICK MAKER", "start": "2026-10-26T20:00:00Z", "end": "2026-10-27T05:00:00Z"},
            {"mmsi": "222", "vesselName": "FAR AWAY", "start": "2026-10-01T00:00:00Z", "end": "2026-10-02T00:00:00Z"}]
    r = sea_service.slicks(d, gaps)
    k = r.slicks[0]
    assert [c.rank for c in k.candidates] == [1, 2] and k.candidates[0].went_dark and not k.candidates[1].went_dark
    assert k.candidates[0].vessel_name == "SLICK MAKER"
    text = " ".join(s.text for s in k.statements)
    assert "not evidence that the source released oil" in text and "switched AIS off" in text
    assert all(s.label.value != "OBSERVATION" or "released" not in s.text for s in k.statements)   # a match is never an observation
