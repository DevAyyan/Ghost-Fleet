"""Approximate sea names for a point, so a reader sees "Gulf of Oman" instead of bare coordinates.

A small hand-made table of boxes (lat0, lat1, lon0, lon1), most specific first. It is a reading aid, not a
boundary dataset: a point near an edge can get the neighbouring sea's name, so callers say "near".
"""
from __future__ import annotations

_BOXES: list[tuple[str, float, float, float, float]] = [
    ("Strait of Hormuz", 25.5, 27.2, 55.5, 57.5),
    ("Persian Gulf", 23.5, 30.5, 47.5, 56.0),
    ("Gulf of Oman", 22.0, 26.5, 56.0, 62.0),
    ("Gulf of Aden", 10.0, 15.5, 43.0, 52.0),
    ("Red Sea", 12.0, 30.0, 32.0, 44.0),
    ("Arabian Sea", 5.0, 26.0, 52.0, 77.0),
    ("Bay of Bengal", 5.0, 23.0, 77.0, 95.0),
    ("Andaman Sea", 5.0, 17.0, 92.0, 99.0),
    ("Strait of Malacca", 0.0, 6.5, 97.0, 104.5),
    ("Gulf of Thailand", 5.5, 14.0, 99.0, 105.5),
    ("Java Sea", -8.5, -2.5, 105.0, 118.0),
    ("Yellow Sea", 31.5, 41.0, 117.0, 127.0),
    ("East China Sea", 24.5, 33.5, 119.0, 131.0),
    ("Sea of Japan", 33.5, 52.0, 127.0, 142.5),
    ("South China Sea", -3.0, 24.5, 104.5, 121.5),
    ("Philippine Sea", 3.0, 33.0, 121.5, 145.0),
    ("Banda and Arafura Seas", -12.0, -2.0, 118.0, 141.5),
    ("Sea of Okhotsk", 44.0, 62.0, 135.0, 163.0),
    ("Bering Sea", 51.0, 66.5, 163.0, 180.0),
    ("Bering Sea", 51.0, 66.5, -180.0, -157.0),
    ("Gulf of Alaska", 48.0, 61.5, -157.0, -130.0),
    ("Gulf of California", 22.5, 32.0, -115.0, -107.0),
    ("Gulf of Mexico", 18.0, 31.0, -98.0, -81.0),
    ("Caribbean Sea", 8.0, 23.0, -89.0, -59.0),
    ("Black Sea", 40.5, 47.5, 27.0, 42.0),
    ("Baltic Sea", 53.5, 66.0, 9.5, 30.5),
    ("North Sea", 50.5, 61.5, -4.5, 9.5),
    ("English Channel and Celtic Sea", 47.5, 52.5, -11.0, 2.0),
    ("Bay of Biscay", 43.0, 48.0, -10.0, -1.0),
    ("Norwegian Sea", 61.5, 72.0, -10.0, 20.0),
    ("Barents Sea", 68.0, 81.0, 16.0, 60.0),
    ("Mediterranean Sea", 30.0, 46.0, -6.0, 36.5),
    ("Gulf of Guinea", -6.0, 7.0, -9.0, 12.5),
    ("waters off West Africa", 7.0, 28.0, -26.0, -9.0),
    ("Mozambique Channel", -27.0, -10.0, 34.0, 49.5),
    ("waters off East Africa", -12.0, 12.0, 39.0, 60.0),
    ("waters off South Africa", -40.0, -27.0, 12.0, 38.0),
    ("Tasman Sea", -48.0, -28.0, 147.0, 174.0),
    ("Coral Sea", -28.0, -8.0, 142.0, 168.0),
    ("waters off Peru and Ecuador", -20.0, 3.0, -95.0, -70.0),
    ("waters off Chile", -57.0, -20.0, -90.0, -66.0),
    ("Patagonian Shelf", -56.0, -35.0, -70.0, -50.0),
    ("waters off Brazil", -35.0, 5.0, -52.0, -28.0),
    ("Hudson Bay and Labrador Sea", 50.0, 70.0, -95.0, -44.0),
    ("Southern Ocean", -90.0, -55.0, -180.0, 180.0),
    ("Arctic Ocean", 72.0, 90.0, -180.0, 180.0),
    ("North Atlantic", 0.0, 72.0, -82.0, 0.0),
    ("South Atlantic", -55.0, 0.0, -70.0, 20.0),
    ("Indian Ocean", -55.0, 26.0, 20.0, 120.0),
    ("North Pacific", 0.0, 66.0, 120.0, 180.0),
    ("North Pacific", 0.0, 66.0, -180.0, -78.0),
    ("South Pacific", -55.0, 0.0, 142.0, 180.0),
    ("South Pacific", -55.0, 0.0, -180.0, -66.0),
]

# Where crews are advised they may switch AIS off for safety (piracy / conflict risk): a legitimate reason for a gap.
_HIGH_RISK = [("the Gulf of Aden, southern Red Sea and Somali Basin", -5.0, 20.0, 40.0, 65.0),
              ("the Gulf of Guinea", -5.0, 8.0, -8.0, 12.0)]


def sea_name(lat: float, lon: float) -> str:
    for name, la0, la1, lo0, lo1 in _BOXES:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return name
    return "open ocean"


def high_risk_area(lat: float, lon: float) -> str | None:
    for name, la0, la1, lo0, lo1 in _HIGH_RISK:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return name
    return None


def coord_label(lat: float, lon: float) -> str:
    return f"{abs(lat):.1f}°{'N' if lat >= 0 else 'S'} {abs(lon):.1f}°{'E' if lon >= 0 else 'W'}"
