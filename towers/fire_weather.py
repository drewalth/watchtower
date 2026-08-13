"""The Canadian Forest Fire Weather Index (FWI) System — pure math.

A faithful translation of the equations in Van Wagner & Pickett (1985),
"Equations and FORTRAN Program for the Canadian Forest Fire Weather Index
System". No Django / DB / network here — the functions take plain numbers so the
science is unit-testable in isolation (mirrors how ``viewshed.py`` keeps the
heavy spatial logic out of the management command).

The chain, from raw noon weather to the final index:

    FFMC (fine fuel moisture) ── + wind ──▶ ISI ─┐
    DMC (duff moisture) ─┐                        ├─▶ FWI ──▶ risk score / level
    DC  (drought) ───────┴──────────────▶ BUI ───┘

FFMC/DMC/DC are recursive: each day starts from the previous day's value, so the
caller persists them and feeds them back in (see ``compute_fire_risk``).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from towers.schemas import WeatherDay

# Effective day-length factors by month (1–12) for DMC (Le) and DC (Lf), for the
# northern hemisphere — Van Wagner & Pickett (1985), tables 1 and 2.
_DMC_DAY_LENGTH = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0]
_DC_DAY_LENGTH = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]


@dataclass(frozen=True)
class FwiCodes:
    """The three recursive moisture codes carried day to day."""

    ffmc: float
    dmc: float
    dc: float


@dataclass(frozen=True)
class FwiResult:
    """A full day's computed indices."""

    ffmc: float
    dmc: float
    dc: float
    isi: float
    bui: float
    fwi: float

    @property
    def codes(self) -> FwiCodes:
        """The carry-forward subset for the next day's computation."""
        return FwiCodes(ffmc=self.ffmc, dmc=self.dmc, dc=self.dc)


# Conventional spring start-up values when no prior history exists (or after snow).
STARTUP_CODES = FwiCodes(ffmc=85.0, dmc=6.0, dc=15.0)

# Ground is treated as snow-covered (fuels saturated, fire risk ~0) at/above this.
SNOW_DEPTH_THRESHOLD_CM = 1.0


def calc_ffmc(ffmc_prev: float, temp: float, rh: float, wind: float, rain: float) -> float:
    """Fine Fuel Moisture Code — litter dryness; governs ignition + spread."""
    rh = min(rh, 100.0)
    mo = 147.2 * (101.0 - ffmc_prev) / (59.5 + ffmc_prev)

    if rain > 0.5:
        rf = rain - 0.5
        if mo > 150.0:
            mo += (
                42.5 * rf * math.exp(-100.0 / (251.0 - mo)) * (1.0 - math.exp(-6.93 / rf))
            ) + 0.0015 * (mo - 150.0) ** 2 * math.sqrt(rf)
        else:
            mo += 42.5 * rf * math.exp(-100.0 / (251.0 - mo)) * (1.0 - math.exp(-6.93 / rf))
        mo = min(mo, 250.0)

    ed = (
        0.942 * rh**0.679
        + 11.0 * math.exp((rh - 100.0) / 10.0)
        + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh))
    )

    if mo > ed:
        ko = 0.424 * (1.0 - (rh / 100.0) ** 1.7) + 0.0694 * math.sqrt(wind) * (
            1.0 - (rh / 100.0) ** 8
        )
        kd = ko * 0.581 * math.exp(0.0365 * temp)
        m = ed + (mo - ed) * 10.0**-kd
    else:
        ew = (
            0.618 * rh**0.753
            + 10.0 * math.exp((rh - 100.0) / 10.0)
            + 0.18 * (21.1 - temp) * (1.0 - math.exp(-0.115 * rh))
        )
        if mo < ew:
            kl = 0.424 * (1.0 - ((100.0 - rh) / 100.0) ** 1.7) + 0.0694 * math.sqrt(
                wind
            ) * (1.0 - ((100.0 - rh) / 100.0) ** 8)
            kw = kl * 0.581 * math.exp(0.0365 * temp)
            m = ew - (ew - mo) * 10.0**-kw
        else:
            m = mo

    return 59.5 * (250.0 - m) / (147.2 + m)


def calc_dmc(dmc_prev: float, temp: float, rh: float, rain: float, month: int) -> float:
    """Duff Moisture Code — moisture of loosely-packed organic layers (multi-day)."""
    rh = min(rh, 100.0)
    t = max(temp, -1.1)

    if rain > 1.5:
        re = 0.92 * rain - 1.27
        mo = 20.0 + math.exp(5.6348 - dmc_prev / 43.43)
        if dmc_prev <= 33.0:
            b = 100.0 / (0.5 + 0.3 * dmc_prev)
        elif dmc_prev <= 65.0:
            b = 14.0 - 1.3 * math.log(dmc_prev)
        else:
            b = 6.2 * math.log(dmc_prev) - 17.2
        mr = mo + 1000.0 * re / (48.77 + b * re)
        pr = 244.72 - 43.43 * math.log(mr - 20.0)
        dmc_prev = max(pr, 0.0)

    k = 1.894 * (t + 1.1) * (100.0 - rh) * _DMC_DAY_LENGTH[month - 1] * 1e-4
    return dmc_prev + k


def calc_dc(dc_prev: float, temp: float, rain: float, month: int) -> float:
    """Drought Code — moisture of deep, compact organic layers (seasonal)."""
    t = max(temp, -2.8)

    if rain > 2.8:
        rd = 0.83 * rain - 1.27
        qo = 800.0 * math.exp(-dc_prev / 400.0)
        qr = qo + 3.937 * rd
        dr = 400.0 * math.log(800.0 / qr)
        dc_prev = max(dr, 0.0)

    v = 0.36 * (t + 2.8) + _DC_DAY_LENGTH[month - 1]
    v = max(v, 0.0)
    return dc_prev + 0.5 * v


def calc_isi(ffmc: float, wind: float) -> float:
    """Initial Spread Index — expected fire spread rate from FFMC + wind."""
    m = 147.2 * (101.0 - ffmc) / (59.5 + ffmc)
    f_wind = math.exp(0.05039 * wind)
    f_fuel = 91.9 * math.exp(-0.1386 * m) * (1.0 + m**5.31 / 4.93e7)
    return 0.208 * f_wind * f_fuel


def calc_bui(dmc: float, dc: float) -> float:
    """Buildup Index — total fuel available to combustion from DMC + DC."""
    if dmc == 0.0 and dc == 0.0:
        return 0.0
    if dmc <= 0.4 * dc:
        bui = 0.8 * dmc * dc / (dmc + 0.4 * dc)
    else:
        bui = dmc - (1.0 - 0.8 * dc / (dmc + 0.4 * dc)) * (
            0.92 + (0.0114 * dmc) ** 1.7
        )
    return max(bui, 0.0)


def calc_fwi(isi: float, bui: float) -> float:
    """Fire Weather Index — the final combined rating of fire intensity."""
    if bui <= 80.0:
        f_duff = 0.626 * bui**0.809 + 2.0
    else:
        f_duff = 1000.0 / (25.0 + 108.64 * math.exp(-0.023 * bui))

    b = 0.1 * isi * f_duff
    if b > 1.0:
        return math.exp(2.72 * (0.434 * math.log(b)) ** 0.647)
    return b


def daily_fwi(prev: FwiCodes, weather: WeatherDay) -> FwiResult:
    """Advance the FWI system one day from ``prev`` codes given a ``WeatherDay``."""
    month = weather.date.month
    ffmc = calc_ffmc(prev.ffmc, weather.temp_c, weather.rh_pct, weather.wind_kph, weather.precip_24h_mm)
    dmc = calc_dmc(prev.dmc, weather.temp_c, weather.rh_pct, weather.precip_24h_mm, month)
    dc = calc_dc(prev.dc, weather.temp_c, weather.precip_24h_mm, month)
    isi = calc_isi(ffmc, weather.wind_kph)
    bui = calc_bui(dmc, dc)
    fwi = calc_fwi(isi, bui)
    return FwiResult(ffmc=ffmc, dmc=dmc, dc=dc, isi=isi, bui=bui, fwi=fwi)


def apply_snow(codes: FwiCodes, snow_depth_cm: float) -> FwiCodes:
    """Over-wintering: while the ground is snow-covered fuels are saturated, so we
    suspend the accumulated codes and reset to spring start-up. On bare ground the
    codes pass through unchanged."""
    if snow_depth_cm >= SNOW_DEPTH_THRESHOLD_CM:
        return STARTUP_CODES
    return codes


def is_snow_covered(snow_depth_cm: float) -> bool:
    return snow_depth_cm >= SNOW_DEPTH_THRESHOLD_CM


# Fire-danger classes. Breakpoints follow the EFFIS/EU FWI danger classes,
# collapsed to the five levels the UI renders. ``risk_score`` is a 0–100 scaling
# of FWI (capped) for an at-a-glance gauge.
_RISK_BANDS = [
    (5.0, "low"),
    (15.0, "moderate"),
    (30.0, "high"),
    (50.0, "very_high"),
]
_FWI_FULL_SCALE = 50.0  # FWI at/above this maps to a 100 score.


def to_risk(fwi: float, fuel_factor: float = 1.0) -> tuple[float, str]:
    """Map an FWI value to a (0–100 score, danger level), scaled by a per-tower
    vegetation/fuel factor (1.0 = neutral; denser fuels push risk up)."""
    adjusted = fwi * fuel_factor
    score = min(100.0, adjusted / _FWI_FULL_SCALE * 100.0)
    level = "extreme"
    for threshold, name in _RISK_BANDS:
        if adjusted < threshold:
            level = name
            break
    return score, level
