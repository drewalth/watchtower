"""Pydantic validation boundary: third-party payloads must match our world view.

These are pure (no DB / no network) — they exercise the schemas directly.
"""
import copy
from datetime import date

import pytest
from pydantic import ValidationError

from towers.schemas import FirmsRow, OpenMeteoResponse

# A faithful Open-Meteo daily payload (shape verified against the live API):
# parallel arrays keyed by date, snow depth in METRES.
VALID_OPEN_METEO = {
    "latitude": 37.74,
    "longitude": -119.55,
    "daily": {
        "time": ["2026-06-11", "2026-06-12", "2026-06-13"],
        "temperature_2m_max": [27.3, 27.3, 26.7],
        "relative_humidity_2m_min": [22, 24, 31],
        "wind_speed_10m_max": [20.7, 18.9, 19.7],
        "precipitation_sum": [0.0, 0.0, 1.4],
        "snow_depth_max": [0.0, 0.0, 0.12],
    },
}


def test_valid_payload_parses_to_weather_days():
    parsed = OpenMeteoResponse.model_validate(VALID_OPEN_METEO)
    days = parsed.to_weather_days()

    assert len(days) == 3
    first, last = days[0], days[-1]
    assert first.date == date(2026, 6, 11)
    assert first.temp_c == 27.3
    assert first.rh_pct == 22
    assert first.wind_kph == 20.7
    assert first.precip_24h_mm == 0.0
    # snow depth converted metres -> centimetres for the domain DTO.
    assert first.snow_depth_cm == 0.0
    assert last.snow_depth_cm == 12.0
    assert last.precip_24h_mm == 1.4


def test_missing_daily_field_is_rejected():
    payload = copy.deepcopy(VALID_OPEN_METEO)
    del payload["daily"]["wind_speed_10m_max"]
    with pytest.raises(ValidationError):
        OpenMeteoResponse.model_validate(payload)


def test_null_where_number_expected_is_rejected():
    payload = copy.deepcopy(VALID_OPEN_METEO)
    payload["daily"]["temperature_2m_max"][1] = None
    with pytest.raises(ValidationError):
        OpenMeteoResponse.model_validate(payload)


def test_mismatched_array_length_is_rejected():
    payload = copy.deepcopy(VALID_OPEN_METEO)
    payload["daily"]["precipitation_sum"] = [0.0, 0.0]  # one short
    with pytest.raises(ValidationError):
        OpenMeteoResponse.model_validate(payload)


def test_firms_row_parses_and_coerces_nan_to_none():
    row = FirmsRow.model_validate(
        {
            "latitude": 38.1,
            "longitude": -120.1,
            "acq_date": "2026-06-13",
            "acq_time": 118,
            "confidence": "n",
            "frp": float("nan"),
            "bright_ti4": 300.5,
        }
    )
    assert row.latitude == 38.1
    assert row.frp is None  # NaN normalised to None
    assert row.bright_ti4 == 300.5
    # acq_time zero-padded to HHMM for the external_uid / timestamp parse.
    assert row.acq_time_hhmm == "0118"


def test_firms_row_missing_required_field_is_rejected():
    with pytest.raises(ValidationError):
        FirmsRow.model_validate({"longitude": -120.1, "acq_date": "2026-06-13"})
