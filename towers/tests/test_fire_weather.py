"""Pure Canadian FWI System math — validated against the canonical reference.

The reference vector is the worked example from Van Wagner & Pickett (1985),
"Equations and FORTRAN Program for the Canadian Forest Fire Weather Index
System", reproduced across independent implementations (cffdrs, pyfwi):

    inputs : temp=17 °C, rh=42 %, wind=25 km/h, rain=0 mm, month=4 (April),
             previous FFMC=85, DMC=6, DC=15
    outputs: FFMC=87.6928, DMC=8.5450, DC=19.0140,
             ISI=10.8536, BUI=8.4904, FWI=10.0962

These are pure (no DB / no network).
"""

from datetime import date

import pytest

from towers.fire_weather import (
    STARTUP_CODES,
    FwiCodes,
    apply_snow,
    calc_bui,
    calc_dc,
    calc_dmc,
    calc_ffmc,
    calc_fwi,
    calc_isi,
    daily_fwi,
    to_risk,
)
from towers.schemas import WeatherDay

APRIL = 4
TOL = dict(abs=0.01)


def test_calc_ffmc_reference():
    assert calc_ffmc(85, temp=17, rh=42, wind=25, rain=0) == pytest.approx(87.6928, **TOL)


def test_calc_dmc_reference():
    assert calc_dmc(6, temp=17, rh=42, rain=0, month=APRIL) == pytest.approx(8.5450, **TOL)


def test_calc_dc_reference():
    assert calc_dc(15, temp=17, rain=0, month=APRIL) == pytest.approx(19.0140, **TOL)


def test_calc_isi_reference():
    assert calc_isi(87.6928, wind=25) == pytest.approx(10.8536, **TOL)


def test_calc_bui_reference():
    assert calc_bui(8.5450, 19.0140) == pytest.approx(8.4904, **TOL)


def test_calc_fwi_reference():
    assert calc_fwi(10.8536, 8.4904) == pytest.approx(10.0962, **TOL)


def test_daily_fwi_reproduces_full_reference_vector():
    weather = WeatherDay(
        date=date(2024, APRIL, 15),
        temp_c=17,
        rh_pct=42,
        wind_kph=25,
        precip_24h_mm=0,
        snow_depth_cm=0,
    )
    result = daily_fwi(FwiCodes(ffmc=85, dmc=6, dc=15), weather)

    assert result.ffmc == pytest.approx(87.6928, **TOL)
    assert result.dmc == pytest.approx(8.5450, **TOL)
    assert result.dc == pytest.approx(19.0140, **TOL)
    assert result.isi == pytest.approx(10.8536, **TOL)
    assert result.bui == pytest.approx(8.4904, **TOL)
    assert result.fwi == pytest.approx(10.0962, **TOL)


def test_heavy_rain_lowers_ffmc_below_dry_day():
    dry = calc_ffmc(85, temp=17, rh=42, wind=25, rain=0)
    wet = calc_ffmc(85, temp=17, rh=42, wind=25, rain=10)
    assert wet < dry


def test_apply_snow_resets_to_startup_when_snow_covered():
    dry_codes = FwiCodes(ffmc=90, dmc=40, dc=300)
    assert apply_snow(dry_codes, snow_depth_cm=15) == STARTUP_CODES
    # Bare ground leaves the accumulated codes untouched.
    assert apply_snow(dry_codes, snow_depth_cm=0) == dry_codes


@pytest.mark.parametrize(
    "fwi,expected_level",
    [
        (0.0, "low"),
        (8.0, "moderate"),
        (20.0, "high"),
        (40.0, "very_high"),
        (60.0, "extreme"),
    ],
)
def test_to_risk_levels(fwi, expected_level):
    score, level = to_risk(fwi)
    assert level == expected_level
    assert 0.0 <= score <= 100.0


def test_to_risk_score_is_capped_at_100():
    score, level = to_risk(500.0)
    assert score == 100.0
    assert level == "extreme"


def test_fuel_factor_raises_risk():
    base, _ = to_risk(10.0, fuel_factor=1.0)
    boosted, _ = to_risk(10.0, fuel_factor=1.5)
    assert boosted > base
