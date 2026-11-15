"""Turns analytics results into API responses. Heavy work runs once at startup and is cached."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from functools import lru_cache

import numpy as np

import re

from ..analytics.causelens import confidence, rank_explanations, recommended_action
from ..analytics.disprove import disprove
from ..analytics.msdi import STEP_LABELS, STEPS, correction_series
from ..analytics.scan import ScanResult, scan
from ..analytics.trend import TrendResult
from ..panel import Panel
from ..places import sea_name
from ..real import RealExtras
from . import schemas as S

N_SENSORS = 1   # SAR only until VIIRS boat detections are ingested

LIMITATIONS = [
    "An unmatched detection is not evidence of wrongdoing: many legitimate vessels are not required to carry AIS.",
    "Sentinel-1 SAR reliably detects vessels larger than about 15 m; small artisanal boats are mostly invisible.",
    "Rough seas (strong winds) hide small targets; this is corrected statistically, not removed.",
    "The AIS-reception correction can also absorb a real change that happens at the same time as receiver changes.",
    "Results depend on analysis choices; see the Try-to-disprove report for how robust this alert is.",
]

REAL_SOURCES = [
    S.DataSource(name="Global Fishing Watch SAR vessel detections", role="Vessel detections, AIS-matched/unmatched",
                 url="https://globalfishingwatch.org/our-apis/"),
    S.DataSource(name="Sentinel-1 GRD IW scenes (Element 84 Earth Search)", role="Observation opportunities",
                 url="https://earth-search.aws.element84.com/v1/collections/sentinel-1-grd"),
    S.DataSource(name="NASA POWER", role="Wind", url="https://power.larc.nasa.gov/"),
]
DEMO_SOURCE = [S.DataSource(name="Synthetic demo panel (ghostfleet.synthetic)",
                            role="DEMO DATA with planted effects — not an observation",
                            url="backend/ghostfleet/synthetic.py")]

DISCLAIMER = ("Ghost Fleet X produces investigation leads, not accusations. An unmatched or changing signal is "
              "never by itself evidence of illegal activity. Human review is required.")


def f(x) -> float | None:
    """NaN/inf -> None for JSON."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def direction(d: str) -> S.Direction:
    return {"increasing": S.Direction.INCREASING, "decreasing": S.Direction.DECREASING}.get(d, S.Direction.NONE)


def trend_out(t: TrendResult, pct: float | None = None) -> S.Trend:
    return S.Trend(direction=direction(t.direction), pct_per_year=f(pct), slope_per_month=f(t.slope),
                   slope_ci=(f(t.slope_lo), f(t.slope_hi)), p=f(t.p), z=f(t.z), n=int(t.n))


def _pct(t: TrendResult, ref: float) -> float | None:
    return f(t.slope * 12 / abs(ref) * 100) if ref and math.isfinite(ref) else None


class NotFound(Exception):
    def __init__(self, what: str, ident: str):
        super().__init__(f"{what} '{ident}' not found")


_CELL_ID = re.compile(r"^([NS])(-?[\d.]+)([EW])(-?[\d.]+)$")


def cell_label(cell_id: str) -> str:
    """'N24.61E66.80' -> '24.61°N 66.80°E', 'S34.45W18.98' -> '34.45°S 18.98°W'; other ids unchanged."""
    m = _CELL_ID.match(cell_id)
    return f"{m[2]}°{m[1]} {m[4]}°{m[3]}" if m else cell_id


class GhostFleetService:
    def __init__(self, panel: Panel, alpha: float = 0.05, extras: RealExtras | None = None,
                 result: ScanResult | None = None):
        """`result`: a precomputed scan of this exact panel (see analytics/scan_io.py); otherwise the scan runs here."""
        self.panel = panel
        self.extras = extras
        self.alpha = alpha
        self.result = result if result is not None else scan(panel, alpha=alpha)
        self.months = [str(m) for m in panel.months.astype("datetime64[M]")]
        self.cell_event = {c: e["id"] for e in self.result.events for c in e["cells"]}
        self.events = {e["id"]: e for e in self.result.events}
        self._disproof = lru_cache(maxsize=256)(self._run_disproof)
        # The weather step is labelled by what this panel actually contains (the global build has wind, no chlorophyll).
        has_wind, has_chl = bool(np.isfinite(panel.wind).any()), bool(np.isfinite(panel.chl).any())
        self.step_labels = dict(STEP_LABELS)
        if not (has_wind and has_chl):
            self.step_labels["environment"] = ("− wind" if has_wind else "− chlorophyll" if has_chl
                                               else "− weather (no data in this build)")
        self._cells_cache: S.CellsResponse | None = None
        self._event_cells_cache: S.CellsResponse | None = None

    # ---------- helpers ----------
    def _steps(self, cell_id: str) -> list[S.WaterfallStep]:
        cr = self.result.cells[cell_id]
        return [S.WaterfallStep(step=S.StepId(s.step.upper()), label=self.step_labels[s.step], trend=trend_out(s.trend, s.pct_per_year),
                                q=f(cr.q_by_step[s.step])) for s in cr.steps]

    def _summary(self, cell_id: str) -> S.CellSummary:
        cr = self.result.cells[cell_id]
        i = self.panel.index(cell_id)
        ring = self.panel.boundaries.get(cell_id, [])
        center = tuple(np.mean(np.asarray(ring[:-1]), axis=0)) if ring else (float("nan"), float("nan"))
        series = correction_series(self.panel.unmatched[i], self.panel.opportunities[i], self.panel.ais_reception[i],
                                   self.panel.wind[i], self.panel.chl[i], self.panel.month_of_year)
        return S.CellSummary(cell_id=cell_id, boundary=[tuple(p) for p in ring], center=(f(center[0]), f(center[1])),
                             trend=trend_out(cr.final, cr.steps[-1].pct_per_year), q=f(cr.q),
                             is_significant=cr.significant, event_id=self.cell_event.get(cell_id),
                             msdi_series=[f(v) for v in series["coverage"]])

    def _series(self, cell_id: str) -> list[S.MonthPoint]:
        p, i = self.panel, self.panel.index(cell_id)
        s = correction_series(p.unmatched[i], p.opportunities[i], p.ais_reception[i], p.wind[i], p.chl[i], p.month_of_year)
        return [S.MonthPoint(month=m, unmatched=f(p.unmatched[i, k]), matched=f(p.matched[i, k]),
                             opportunities=f(p.opportunities[i, k]), ais_reception=f(p.ais_reception[i, k]),
                             wind=f(p.wind[i, k]), chl=f(p.chl[i, k]), raw=f(s["raw"][k]), msdi=f(s["coverage"][k]),
                             ais_corrected=f(s["ais_reception"][k]), season_adjusted=f(s["season"][k]),
                             environment_adjusted=f(s["environment"][k]))
                for k, m in enumerate(self.months)]

    def _event_or_404(self, event_id: str) -> dict:
        if event_id not in self.events:
            raise NotFound("Event", event_id)
        return self.events[event_id]

    def _event_summary(self, e: dict) -> S.EventSummary:
        verb = "increased" if e["direction"] == "increasing" else "decreased"
        pct = f(e["pct_per_year"])
        ring = self.panel.boundaries.get(e["lead_cell"], [])
        place = None
        if ring:
            lon, lat = np.mean(np.asarray(ring[:-1]), axis=0)
            place = sea_name(float(lat), float(lon))
        where = f"{cell_label(e['lead_cell'])}" + (f" ({place})" if place else "")
        txt = (f"After all corrections, unmatched SAR activity in {len(e['cells'])} cell(s) around {where} "
               f"{verb} by {abs(pct or 0):.1f}% per year (FDR q = {e['q']:.2g}).")
        return S.EventSummary(event_id=e["id"], rank=e["rank"], direction=direction(e["direction"]),
                              lead_cell_id=e["lead_cell"], cell_ids=e["cells"], pct_per_year=pct, q=f(e["q"]),
                              max_abs_z=e["max_abs_z"], headline=S.Statement(label=S.EpistemicLabel.OBSERVATION, text=txt), place=place)

    def _run_disproof(self, cell_id: str, variants: tuple[str, ...] | None) -> dict:
        return disprove(self.panel, cell_id, alpha=self.alpha, variants=list(variants) if variants else None)

    def _completeness(self, cell_id: str) -> float:
        i = self.panel.index(cell_id)
        m = correction_series(self.panel.unmatched[i], self.panel.opportunities[i], self.panel.ais_reception[i],
                              self.panel.wind[i], self.panel.chl[i], self.panel.month_of_year)["coverage"]
        return float(np.isfinite(m).mean())

    # ---------- endpoints ----------
    def meta(self) -> S.MetaResponse:
        return S.MetaResponse(
            is_demo_data=self.panel.is_synthetic, source_note=self.panel.source_note, months=self.months,
            alpha=self.alpha, steps=[S.StepInfo(step=S.StepId(s.upper()), label=self.step_labels[s]) for s in STEPS],
            alerts_by_step={S.StepId(k.upper()): v for k, v in self.result.alerts_by_step.items()},
            cell_count=len(self.panel.cell_ids), event_count=len(self.events),
            sensors=["Sentinel-1 SAR (via Global Fishing Watch)"], disclaimer=DISCLAIMER,
            fetched_at=self.extras.fetched_at if self.extras else None,
            cell_size_deg=self.extras.cell_size_deg if self.extras else None)

    def detections(self, month: str | None) -> S.DetectionsResponse:
        det = self.extras.detections if self.extras else {}
        m = month or self.months[-1]
        if m not in self.months:
            raise NotFound("Month", m)
        pts = [S.DetectionPoint(lat=p[0], lon=p[1], unmatched=int(p[2]), matched=int(p[3])) for p in det.get(m, [])]
        return S.DetectionsResponse(is_demo_data=self.panel.is_synthetic, month=m, points=pts,
                                    total_unmatched=sum(p.unmatched for p in pts),
                                    total_matched=sum(p.matched for p in pts))

    def cells(self) -> S.CellsResponse:
        if self._cells_cache is None:   # thousands of cells in the global build: build once per loaded panel
            self._cells_cache = S.CellsResponse(is_demo_data=self.panel.is_synthetic, months=self.months,
                                                cells=[self._summary(c) for c in self.panel.cell_ids])
        return self._cells_cache

    def event_cells(self) -> S.CellsResponse:
        """Only the cells inside a change event: what the map draws, without summarising every cell (~7 s globally)."""
        if self._event_cells_cache is None:
            ids = [c for c in self.panel.cell_ids if c in self.cell_event]
            self._event_cells_cache = S.CellsResponse(is_demo_data=self.panel.is_synthetic, months=self.months,
                                                      cells=[self._summary(c) for c in ids])
        return self._event_cells_cache

    def cell(self, cell_id: str) -> S.CellDetailResponse:
        if cell_id not in self.result.cells:
            raise NotFound("Cell", cell_id)
        return S.CellDetailResponse(is_demo_data=self.panel.is_synthetic, cell=self._summary(cell_id),
                                    waterfall=self._steps(cell_id), series=self._series(cell_id),
                                    neighbor_ids=self.panel.neighbors.get(cell_id, []))

    def list_events(self, page: int, page_size: int, dir_filter: S.Direction | None) -> S.EventsResponse:
        evs = [e for e in self.result.events if dir_filter is None or direction(e["direction"]) == dir_filter]
        total = len(evs)
        chunk = evs[(page - 1) * page_size: page * page_size]
        return S.EventsResponse(is_demo_data=self.panel.is_synthetic, data=[self._event_summary(e) for e in chunk],
                                pagination=S.Pagination(page=page, page_size=page_size, total_items=total,
                                                        total_pages=max(1, math.ceil(total / page_size))))

    def event(self, event_id: str) -> S.EventDetailResponse:
        e = self._event_or_404(event_id)
        lead = e["lead_cell"]
        cr = self.result.cells[lead]
        d = self._disproof(lead, None)
        conf = confidence(d["survival_rate"], self._completeness(lead), N_SENSORS)
        opp = []
        for pair in self.result.opposite_pairs:
            if lead in (pair["increasing"], pair["decreasing"]):
                other = pair["decreasing"] if pair["increasing"] == lead else pair["increasing"]
                oc = self.result.cells[other]
                opp.append(S.OppositeNeighbor(cell_id=other, direction=direction(oc.final.direction),
                                              pct_per_year=f(oc.steps[-1].pct_per_year), q=f(oc.q)))
        raw, final = cr.steps[0], cr.steps[-1]
        statements = [
            S.Statement(label=S.EpistemicLabel.OBSERVATION,
                        text=f"Raw unmatched detections changed {f(raw.pct_per_year) or 0:+.1f}%/yr; after all corrections "
                             f"the change is {f(final.pct_per_year) or 0:+.1f}%/yr."),
            S.Statement(label=S.EpistemicLabel.INFERENCE,
                        text=f"The alert survived {d['survived']} of {d['total']} disproof tests."),
        ]
        if opp:
            statements.append(S.Statement(label=S.EpistemicLabel.HYPOTHESIS,
                                          text=f"A neighbouring cell ({cell_label(opp[0].cell_id)}) changed in the opposite direction, "
                                               "consistent with activity relocating rather than appearing or vanishing."))
        return S.EventDetailResponse(
            is_demo_data=self.panel.is_synthetic, event=self._event_summary(e), waterfall=self._steps(lead),
            series=self._series(lead), opposite_neighbors=opp,
            explanations=[S.Explanation(**x) for x in rank_explanations(cr.steps)],
            confidence=S.Confidence(**conf),
            recommended_action=S.Statement(label=S.EpistemicLabel.RECOMMENDATION,
                                           text=recommended_action(conf["level"], e["direction"],
                                                                   (self.months[0], self.months[-1]))),
            statements=statements)

    def disproof(self, event_id: str, variants: list[S.DisproofVariant] | None) -> S.DisproofResponse:
        e = self._event_or_404(event_id)
        key = tuple(sorted(dict.fromkeys(v.value for v in variants))) if variants else None
        d = self._disproof(e["lead_cell"], key)
        ref = np.nanmean(correction_series(*self._cell_inputs(e["lead_cell"]))["coverage"])
        outs = [S.VariantOutcome(variant=S.DisproofVariant(v.variant), description=v.description,
                                 trend=trend_out(v.trend, _pct(v.trend, ref)), alpha=v.alpha, survived=v.survived)
                for v in d["variants"]]
        rate = f(d["survival_rate"])
        if rate is None:
            verdict = "No disproof variants could be run."
        elif rate >= 0.8:
            verdict = f"Robust: the alert survived {d['survived']} of {d['total']} alternative analyses."
        elif rate >= 0.5:
            verdict = f"Partly robust: the alert survived {d['survived']} of {d['total']} alternative analyses."
        else:
            verdict = f"Fragile: the alert survived only {d['survived']} of {d['total']} alternative analyses. Treat with caution."
        return S.DisproofResponse(is_demo_data=self.panel.is_synthetic, event_id=event_id, cell_id=e["lead_cell"],
                                  baseline=trend_out(d["baseline"], _pct(d["baseline"], ref)), variants=outs,
                                  survived=d["survived"], total=d["total"], survival_rate=rate,
                                  verdict=S.Statement(label=S.EpistemicLabel.INFERENCE, text=verdict))

    def _cell_inputs(self, cell_id: str):
        p, i = self.panel, self.panel.index(cell_id)
        return p.unmatched[i], p.opportunities[i], p.ais_reception[i], p.wind[i], p.chl[i], p.month_of_year

    def case_file(self, event_id: str) -> S.CaseFile:
        det = self.event(event_id)
        dis = self.disproof(event_id, None)
        return S.CaseFile(
            is_demo_data=self.panel.is_synthetic,
            case_id=f"GFX-{event_id}",
            generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            summary=det.event.headline,
            what_changed=det.statements,
            evidence={"waterfall": [w.model_dump(by_alias=True) for w in det.waterfall],
                      "disproof": dis.model_dump(by_alias=True, exclude={"is_demo_data"}),
                      "oppositeNeighbors": [o.model_dump(by_alias=True) for o in det.opposite_neighbors],
                      "cells": det.event.cell_ids},
            alternative_explanations=det.explanations, confidence=det.confidence,
            recommended_action=det.recommended_action, limitations=LIMITATIONS,
            data_sources=DEMO_SOURCE if self.panel.is_synthetic else
            ([S.DataSource(**s) for s in self.extras.sources] if self.extras else REAL_SOURCES))

    def case_file_geojson(self, event_id: str) -> dict:
        cf = self.case_file(event_id)
        feats = []
        for cid in cf.evidence["cells"]:
            s = self._summary(cid)
            feats.append({"type": "Feature",
                          "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in s.boundary]]},
                          "properties": {"cellId": cid, "eventId": event_id, "isDemoData": cf.is_demo_data,
                                         "direction": s.trend.direction.value, "pctPerYear": s.trend.pct_per_year,
                                         "q": s.q, "caseId": cf.case_id, "generatedAt": cf.generated_at}})
        return {"type": "FeatureCollection", "isDemoData": cf.is_demo_data, "features": feats}
