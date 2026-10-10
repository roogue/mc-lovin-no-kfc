"""Feature engineering shared by training.py and predict.py (must stay identical for both)."""

import pandas as pd

COLS = ["temperature", "humidity", "pressure", "precipitation"]
STEP_MIN = 10  # readings are resampled to this interval
LAG_MIN = [10, 30, 60, 120, 180, 360]
HORIZON_MIN = 60  # how far ahead temperature / humidity / precipitation are predicted
STRESS_WINDOW_MIN = 180  # "stress" = threshold crossed at any point in this window
# Same thresholds as RULES.stressTemp / stressHumidity in Frontend/alert.js
STRESS_TEMP = 33
STRESS_HUMIDITY = 85

PRESSURE_TREND_MIN = 180
MIN_ROWS = max(LAG_MIN + [PRESSURE_TREND_MIN]) // STEP_MIN + 1


def steps(minutes):
    return minutes // STEP_MIN


def prepare(df):
    """Sort by time and resample to a fixed step so lags mean the same thing at any logging rate."""
    df = df.copy()
    df["recorded_at"] = pd.to_datetime(df["recorded_at"])
    df = df.set_index("recorded_at").sort_index()
    df = df[COLS].apply(pd.to_numeric, errors="coerce")
    df = df.resample(f"{STEP_MIN}min").mean()
    # Fill short gaps only (up to 30 min); longer gaps stay empty and are dropped later
    return df.interpolate(limit=3)


def build_features(df):
    f = pd.DataFrame(index=df.index)
    for c in COLS:
        f[c] = df[c]
        for m in LAG_MIN:
            f[f"{c}_lag{m}"] = df[c].shift(steps(m))
    f["pressure_trend"] = df["pressure"] - df["pressure"].shift(
        steps(PRESSURE_TREND_MIN)
    )
    f["hour"] = df.index.hour
    return f


def stress_now(df):
    return (
        (df["temperature"] >= STRESS_TEMP) | (df["humidity"] >= STRESS_HUMIDITY)
    ).astype(int)
