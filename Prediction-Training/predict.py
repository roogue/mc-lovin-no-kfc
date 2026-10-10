"""Loads model.joblib and predicts from recent readings. The backend imports predict()."""

from pathlib import Path

import joblib
import pandas as pd

import features as ft

MODEL_PATH = Path(__file__).parent / "model.joblib"
_bundle = None


def load():
    global _bundle
    if _bundle is None:
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


def predict(readings):
    """readings: list of {recorded_at, temperature, humidity, pressure, precipitation}, oldest first.

    Needs about 6 hours of history; returns {"ready": False, ...} until then.
    """
    df = ft.prepare(pd.DataFrame(readings))
    X = ft.build_features(df).tail(1)
    if len(df) < ft.MIN_ROWS or X.isna().any(axis=None):
        return {"ready": False, "needed_minutes": ft.MIN_ROWS * ft.STEP_MIN}

    bundle = load()
    X = X[bundle["columns"]]
    m = bundle["models"]
    return {
        "ready": True,
        "horizon_minutes": bundle["horizon_minutes"],
        "temperature": float(m["temperature"].predict(X)[0]),
        "humidity": float(m["humidity"].predict(X)[0]),
        "precipitation": max(0.0, float(m["precipitation"].predict(X)[0])),
        "stress_probability": float(m["stress"].predict_proba(X)[0][1]),
        "stress_window_minutes": bundle["stress_window_minutes"],
    }
