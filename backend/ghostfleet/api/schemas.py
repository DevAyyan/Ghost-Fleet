"""API contract (source of truth). camelCase on the wire; nulls instead of NaN."""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- enums ----------
class Direction(str, Enum):
    INCREASING = "INCREASING"
    DECREASING = "DECREASING"
    NONE = "NONE"


class EpistemicLabel(str, Enum):
    OBSERVATION = "OBSERVATION"
    INFERENCE = "INFERENCE"
    HYPOTHESIS = "HYPOTHESIS"
    RECOMMENDATION = "RECOMMENDATION"


class ConfidenceLevel(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"


class StepId(str, Enum):
    RAW = "RAW"
    COVERAGE = "COVERAGE"
    AIS_RECEPTION = "AIS_RECEPTION"
    SEASON = "SEASON"
    ENVIRONMENT = "ENVIRONMENT"


class DisproofVariant(str, Enum):
    SEASONAL_MK = "SEASONAL_MK"
    TRIM_START = "TRIM_START"
    TRIM_END = "TRIM_END"
    STRICT_COVERAGE = "STRICT_COVERAGE"
    COARSER_CELLS = "COARSER_CELLS"
    NEIGHBOR_CONTROL = "NEIGHBOR_CONTROL"
    STRICT_ALPHA = "STRICT_ALPHA"


class CaseFileFormat(str, Enum):
    JSON = "json"
    GEOJSON = "geojson"


# ---------- shared pieces ----------
class Statement(Model):
    label: EpistemicLabel
    text: str


class Trend(Model):
    direction: Direction
    pct_per_year: float | None = Field(description="Sen's slope ×12 as % of reference level")
    slope_per_month: float | None
    slope_ci: tuple[float | None, float | None]
    p: float | None
    z: float | None
    n: int


class WaterfallStep(Model):
    step: StepId
    label: str
    trend: Trend
    q: float | None = Field(description="BH-FDR q-value across all cells for this step")


class Envelope(Model):
    is_demo_data: bool


# ---------- ?compact=true on the list endpoints: each distinct statement sent once per response ----------
def _unset(v) -> bool:
    return v is None


class SharesStatements(Model):
    """A record whose statements may be sent as indices into its response's statementTable."""
    statement_ids: list[int] | None = Field(None, exclude_if=_unset, description=(
        "Only with ?compact=true: this record's statements, in order, as indices into the response's statementTable "
        "(`statements` is then empty). Absent otherwise."))


class StatementTable(Model):
    """A response whose records' statements may be pooled (?compact=true)."""
    statement_table: list[Statement] | None = Field(None, exclude_if=_unset, description=(
        "Only with ?compact=true: every distinct statement of the records, once. Absent otherwise."))


# ---------- error ----------
class ErrorBody(Model):
    code: str
    message: str
    details: object | None = None


class ErrorResponse(Model):
    error: ErrorBody


# ---------- /api/meta ----------
class StepInfo(Model):
    step: StepId
    label: str


class MetaResponse(Envelope):
    source_note: str
    months: list[str]
    alpha: float
    steps: list[StepInfo]
    alerts_by_step: dict[StepId, int] = Field(description="Cells each step would flag after FDR (naive vs corrected)")
    cell_count: int
    event_count: int
    sensors: list[str]
    disclaimer: str
    fetched_at: str | None = Field(default=None, description="UTC time the live data was pulled (null for demo data)")
    cell_size_deg: float | None = Field(default=None, description="Analysis cell size in degrees")


# ---------- /api/cells ----------
class CellSummary(Model):
    cell_id: str
    boundary: list[tuple[float, float]] = Field(description="Closed ring of [lon, lat]")
    center: tuple[float, float]
    trend: Trend
    q: float | None
    is_significant: bool
    event_id: str | None
    msdi_series: list[float | None] = Field(description="Aligned to meta.months")


class CellsResponse(Envelope):
    months: list[str]
    cells: list[CellSummary]


class MonthPoint(Model):
    month: str
    unmatched: float | None
    matched: float | None
    opportunities: float | None
    ais_reception: float | None
    wind: float | None
    chl: float | None
    raw: float | None
    msdi: float | None
    ais_corrected: float | None
    season_adjusted: float | None
    environment_adjusted: float | None


class CellDetailResponse(Envelope):
    cell: CellSummary
    waterfall: list[WaterfallStep]
    series: list[MonthPoint]
    neighbor_ids: list[str]


# ---------- /api/detections ----------
class DetectionPoint(Model):
    lat: float
    lon: float
    unmatched: int
    matched: int


class DetectionsResponse(Envelope):
    month: str
    points: list[DetectionPoint]
    packed: list[tuple[float, float, int, int]] | None = Field(
        default=None, description="With ?compact=true: the same points as [lat, lon, unmatched, matched] rows, and `points` is empty. "
                                  "Less than half the size, which matters for a worldwide month")
    total_unmatched: int
    total_matched: int
    fetched_at: str | None = Field(default=None, description="UTC time this month was pulled from Global Fishing Watch")
    source: str = "Global Fishing Watch public-global-sar-presence (Sentinel-1 SAR), 0.1° bins"


# ---------- /api/events ----------
class EventSummary(Model):
    event_id: str
    rank: int
    direction: Direction
    lead_cell_id: str
    cell_ids: list[str]
    pct_per_year: float | None
    q: float | None
    max_abs_z: float
    headline: Statement
    place: str | None = Field(default=None, description="Approximate sea name for the lead cell (reading aid, not a boundary)")


class Pagination(Model):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class EventsResponse(Envelope):
    data: list[EventSummary]
    pagination: Pagination


class Explanation(Model):
    code: str
    text: str
    share: float = Field(description="Share of the apparent change attributed to this explanation (0-1)")
    label: EpistemicLabel


class Confidence(Model):
    level: ConfidenceLevel
    reasons: list[str]


class OppositeNeighbor(Model):
    cell_id: str
    direction: Direction
    pct_per_year: float | None
    q: float | None


class EventDetailResponse(Envelope):
    event: EventSummary
    waterfall: list[WaterfallStep]
    series: list[MonthPoint]
    opposite_neighbors: list[OppositeNeighbor]
    explanations: list[Explanation]
    confidence: Confidence
    recommended_action: Statement
    statements: list[Statement]


# ---------- disproof ----------
class DisproofRequest(Model):
    variants: list[DisproofVariant] | None = Field(default=None, description="Omit to run all variants")


class VariantOutcome(Model):
    variant: DisproofVariant
    description: str
    trend: Trend
    alpha: float
    survived: bool


class DisproofResponse(Envelope):
    event_id: str
    cell_id: str
    baseline: Trend
    variants: list[VariantOutcome]
    survived: int
    total: int
    survival_rate: float | None
    verdict: Statement


# ---------- case file ----------
class DataSource(Model):
    name: str
    role: str
    url: str


class CaseFile(Envelope):
    case_id: str
    generated_at: str
    format_version: Literal["1"] = "1"
    summary: Statement
    what_changed: list[Statement]
    evidence: dict[str, object]
    alternative_explanations: list[Explanation]
    confidence: Confidence
    recommended_action: Statement
    limitations: list[str]
    data_sources: list[DataSource]


# ---------- /api/sea/*: live awareness layers ----------
class AisOffEvent(SharesStatements):
    id: str
    lat: float
    lon: float = Field(description="Where the vessel stopped broadcasting")
    start: str | None
    end: str | None
    duration_hours: float | None
    distance_km: float | None = Field(description="Distance between the last position before and the first after the gap")
    vessel_name: str | None
    flag: str | None
    vessel_type: str | None
    shore_km: float | None
    place: str
    in_protected_area: bool
    in_no_take: bool
    high_seas: bool
    statements: list[Statement] = Field(description="What was observed, and labelled hypotheses about what might have happened")
    vessel_id: str | None = Field(default=None, description="GFW vessel id: open /api/sea/vessels/{vesselId} for the ship's path")
    mmsi: str | None = None
    on_lat: float | None = Field(default=None, description="Where the vessel started broadcasting again")
    on_lon: float | None = None
    likely_intentional: bool = Field(default=True, description="False if GFW does not class the gap as switched off on purpose")
    no_take_area_ids: list[str] = Field(default_factory=list,
                                        description="WDPA ids (SITE_PID) of fully no-take protected areas where the signal stopped")
    part_no_take_area_ids: list[str] = Field(default_factory=list,
                                             description="WDPA ids of partly no-take protected areas where the signal stopped")


class AisOffHotspot(Model):
    id: str
    lat: float
    lon: float
    radius_km: float
    count: int
    place: str
    top_vessel_type: str | None
    top_vessel_type_share: float
    top_flags: list[str]
    median_duration_hours: float | None
    statements: list[Statement]


class CoordinatedTurnOnVessel(Model):
    vessel_id: str | None = None
    vessel_name: str | None = None
    vessel_type: str | None = None
    flag: str | None = None
    start: str | None = None
    end: str | None = None
    duration_hours: float | None = None
    distance_km: float | None = None
    enter_lat: float
    enter_lon: float
    exit_lat: float
    exit_lon: float
    lat: float = Field(description="Exit latitude (where AIS was turned back on)")
    lon: float = Field(description="Exit longitude (where AIS was turned back on)")


class CoordinatedTurnOn(Model):
    id: str
    lat: float = Field(description="Centroid latitude of the dark operational area")
    lon: float = Field(description="Centroid longitude of the dark operational area")
    enter_lat: float = Field(description="Centroid latitude where vessels entered the area and switched AIS off")
    enter_lon: float = Field(description="Centroid longitude where vessels entered the area and switched AIS off")
    exit_lat: float = Field(description="Centroid latitude where vessels exited the area and switched AIS back on")
    exit_lon: float = Field(description="Centroid longitude where vessels exited the area and switched AIS back on")
    radius_km: float
    count: int
    shared_hours: float = Field(description="Hours vessels spent concurrently operating dark inside the area together")
    span_hours: float = Field(description="Time window across which vessels exited and restored AIS")
    co_presence_start: str = Field(description="Exact UTC date and time when all vessels were concurrently dark in the area (start of overlap)")
    co_presence_end: str = Field(description="Exact UTC date and time when all vessels were concurrently dark in the area (end of overlap)")
    earliest: str = Field(description="Earliest exit timestamp (AIS turned on)")
    latest: str = Field(description="Latest exit timestamp (AIS turned on)")
    earliest_enter: str | None = None
    latest_enter: str | None = None
    place: str
    top_flags: list[str]
    vessel_types: list[str]
    vessels: list[CoordinatedTurnOnVessel]
    statements: list[Statement]


class AisOffResponse(Envelope, StatementTable):
    fetched_at: str
    window_days: int
    recent_days: int
    total: int = Field(description="AIS-off events in the whole window")
    events: list[AisOffEvent] = Field(description="Events that started in the last `recentDays` days")
    hotspots: list[AisOffHotspot] = Field(description="Places where AIS is switched off most often, over the whole window")
    turn_on_clusters: list[CoordinatedTurnOn] = Field(default_factory=list, description="Areas where multiple ships turned AIS back on at the same time and place")
    heat: list[tuple[float, float]] = Field(description="[lat, lon] of every event in the window, for a density layer")
    start: str | None = Field(default=None, description="First day of the period (events are selected by the day the gap began)")
    end: str | None = None
    truncated: bool = Field(default=False, description="True if the period held more events than are fetched (15,000)")
    source: str = "Global Fishing Watch events API (public-global-gaps-events), gaps classed as likely intentional"


class SlickCandidate(Model):
    rank: int = Field(description="Cerulean's rank among this slick's candidate sources (1 = best match)")
    type: Literal["VESSEL", "DARK_VESSEL", "INFRASTRUCTURE", "UNKNOWN"]
    ref: str = Field(description="MMSI for a vessel on AIS, Cerulean's detection id for a dark vessel, structure id for infrastructure")
    score: float | None = Field(description="Cerulean's collated match score: higher is a better fit; only meaningful within one slick")
    url: str | None
    went_dark: bool = Field(False, description="This MMSI switched AIS off (likely intentionally) within 48 h of the slick")
    vessel_name: str | None = Field(None, description="Known from a matching AIS-off event, else looked up on demand")


class OilSlick(SharesStatements):
    id: str
    lat: float
    lon: float
    time: str | None
    area_km2: float
    length_km: float
    confidence: float
    possible_source: Literal["VESSEL", "INFRASTRUCTURE", "DARK_VESSEL", "NATURAL", "UNKNOWN"]
    place: str
    url: str | None
    statements: list[Statement]
    candidates: list[SlickCandidate] = Field(default_factory=list, description="Ranked candidate sources (Cerulean), best first")


class SlicksResponse(Envelope, StatementTable):
    fetched_at: str
    window_days: int
    total_matched: int | None = Field(description="Slicks above the size and confidence floor in the window; the largest are returned")
    slicks: list[OilSlick]
    candidates_available: bool = Field(True, description="False if Cerulean's source matching could not be fetched this time")
    start: str | None = None
    end: str | None = None
    source: str = "SkyTruth Cerulean (machine-detected on Sentinel-1 radar; not verified by a person)"


class ProtectedFishingEvent(SharesStatements):
    id: str
    lat: float
    lon: float
    start: str | None
    end: str | None
    duration_hours: float | None
    vessel_name: str | None
    flag: str | None
    vessel_type: str | None
    shore_km: float | None
    full_no_take: bool = Field(description="True if the whole area is no-take; false if only part of it is")
    place: str
    statements: list[Statement]
    vessel_id: str | None = None
    area_ids: list[str] = Field(default_factory=list, description="WDPA ids (SITE_PID) of the no-take protected areas it was in")


class ProtectedFishingResponse(Envelope, StatementTable):
    fetched_at: str
    days: list[str]
    scanned: int = Field(description="Apparent-fishing events examined for those days")
    events: list[ProtectedFishingEvent]
    start: str | None = Field(default=None, description="Period filter applied to `events` (`days` lists every day that has been scanned)")
    end: str | None = None
    source: str = "Global Fishing Watch events API (public-global-fishing-events) tagged inside no-take marine protected areas"


# ---------- /api/sea/vessels: one ship ----------
class VesselIdentity(Model):
    vessel_id: str
    name: str | None
    flag: str | None
    mmsi: str | None
    imo: str | None
    callsign: str | None
    gear: list[str]
    length_m: float | None
    tonnage_gt: float | None
    transmits_from: str | None = Field(description="First AIS transmission GFW holds for this ship")
    transmits_to: str | None


class VesselPoint(Model):
    time: str
    lat: float
    lon: float
    kind: Literal["fishing", "loitering", "port_visit", "encounter", "gap_off", "gap_on"] = Field(
        description="What the ship was recorded doing. The stretch from a gap_off point to the next gap_on point was sailed unseen")
    label: str | None = Field(description="Port name, or the other vessel in an encounter")
    event_id: str | None = None


class VesselResponse(Envelope):
    fetched_at: str
    start: str
    end: str
    truncated: bool = Field(description="True if the ship had more events in the period than are fetched (3,000)")
    identity: VesselIdentity
    points: list[VesselPoint] = Field(description="The ship's recorded events in time order. Joined up, they are its path")
    gaps: list[AisOffEvent] = Field(description="Every time it stopped broadcasting in the period: where, when, for how long, and where it reappeared")
    counts: dict[str, int]
    statements: list[Statement]
    source: str = "Global Fishing Watch vessel identity and events APIs. Raw AIS tracks are not part of the free data."


class VesselSearchResponse(Envelope):
    query: str
    results: list[VesselIdentity]



# ---------- /api/sea/encounters: meetings at sea (possible transshipment) ----------
class Authorisation(str, Enum):
    AUTHORISED = "AUTHORISED"
    PARTLY = "PARTLY"
    NOT_FOUND = "NOT_FOUND"     # no matching public RFMO authorisation found: not proof of being unauthorised
    UNKNOWN = "UNKNOWN"


class EncounterVessel(Model):
    vessel_id: str | None
    name: str | None
    flag: str | None
    vessel_type: str | None
    mmsi: str | None
    authorisation: Authorisation
    went_dark: bool = Field(False, description="Switched AIS off (likely intentionally) within 48 h before or after the encounter")


class Encounter(SharesStatements):
    id: str
    lat: float
    lon: float
    start: str | None
    end: str | None
    duration_hours: float | None
    type: str | None = Field(description="GFW encounter type, e.g. carrier-fishing, bunker-fishing")
    median_distance_km: float | None
    median_speed_knots: float | None
    potential_risk: bool = Field(description="GFW's own flag: at least one vessel lacks a matching public authorisation")
    shore_km: float | None
    high_seas: bool
    place: str
    rfmo: list[str]
    vessels: list[EncounterVessel]
    dark_link: bool = Field(description="Either vessel switched AIS off within 48 h of the meeting")
    statements: list[Statement]


class EncountersResponse(Envelope, StatementTable):
    fetched_at: str
    start: str
    end: str
    truncated: bool
    total: int
    events: list[Encounter]
    source: str = "Global Fishing Watch events API (public-global-encounters-events), cross-checked with AIS gap events"


# ---------- /api/sea/loitering: carriers waiting far offshore ----------
class Loitering(SharesStatements):
    id: str
    lat: float
    lon: float
    start: str | None
    end: str | None
    duration_hours: float | None
    distance_km: float | None
    speed_knots: float | None
    shore_km: float | None
    high_seas: bool
    place: str
    vessel_id: str | None
    vessel_name: str | None
    flag: str | None
    vessel_type: str | None
    met_vessel: bool = Field(description="The same vessel had a recorded encounter within 24 h of loitering")
    statements: list[Statement]


class LoiteringResponse(Envelope, StatementTable):
    fetched_at: str
    start: str
    end: str
    truncated: bool
    total: int
    events: list[Loitering]
    source: str = "Global Fishing Watch events API (public-global-loitering-events), carriers and bunkers 20+ nm offshore"


# ---------- /api/sea/vessels/{id}/insights ----------
class VesselInsights(Envelope):
    fetched_at: str
    vessel_id: str
    start: str
    end: str
    iuu_listed_in_period: bool
    iuu_times_listed: int = Field(description="Times the vessel has appeared on an RFMO IUU vessel list, ever")
    fishing_events: int | None
    fishing_in_rfmo_without_known_authorisation: int | None
    fishing_in_no_take_mpas: int | None
    ais_off_events: int | None
    coverage_pct: float | None = Field(description="Share of the period with AIS positions")
    statements: list[Statement]
    source: str = "Global Fishing Watch vessel insights API"


# ---------- /api/sea/closures: fishing during seasonal bans ----------
class ClosureCell(Model):
    lat: float
    lon: float
    hours: float
    vessels: int


class ClosureSeason(Model):
    id: str
    year: int
    start: str
    end: str
    days: int
    hours_before: float
    hours_during: float
    hours_after: float
    ratio: float | None = Field(description="Fishing hours during the ban ÷ mean of the equal-length windows before and after")
    cells_during: int
    cells: list[ClosureCell]
    statements: list[Statement]


class Closure(Model):
    id: str
    country: str
    name: str
    eez: str
    window: str = Field(description="The ban each year, e.g. '1 Jun to 31 Jul'")
    scope: str
    confidence: ConfidenceLevel = Field(description="How sure we are of the rule's dates and scope")
    sources: list[str]
    seasons: list[ClosureSeason]


class ClosuresResponse(Envelope):
    fetched_at: str
    closures: list[Closure]
    source: str = "Global Fishing Watch 4Wings fishing effort (AIS) per EEZ; ban dates from official notices"
