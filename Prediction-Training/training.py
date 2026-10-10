"""Trains the forecast + stress models from dataset.csv and saves model.joblib.

Run:  pip install -r requirements.txt && python training.py
"""

from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.metrics import f1_score, mean_absolute_error

import features as ft

HERE = Path(__file__).parent
DATASET = HERE / "dataset.csv"
MODEL_PATH = HERE / "model.joblib"
TARGETS = ["temperature", "humidity", "precipitation"]
TEST_FRACTION = 0.2
MIN_TRAIN_ROWS = 200


def load_xy():
    raw = pd.read_csv(DATASET)
    missing = {"recorded_at", *ft.COLS} - set(raw.columns)
    if missing:
        raise SystemExit(f"dataset.csv is missing columns: {sorted(missing)}")
    df = ft.prepare(raw)

    X = ft.build_features(df)
    ahead = ft.steps(ft.HORIZON_MIN)
    Y = pd.DataFrame({t: df[t].shift(-ahead) for t in TARGETS})

    # 1 if the stress thresholds are crossed at any point in the next STRESS_WINDOW_MIN
    n = ft.steps(ft.STRESS_WINDOW_MIN)
    s = ft.stress_now(df)
    Y["stress"] = s[::-1].rolling(n, min_periods=n).max()[::-1].shift(-1)

    ok = X.notna().all(axis=1) & Y.notna().all(axis=1)
    return X[ok], Y[ok]


def main():
    X, Y = load_xy()
    if len(X) < MIN_TRAIN_ROWS:
        raise SystemExit(
            f"Only {len(X)} usable rows; collect at least {MIN_TRAIN_ROWS} ({ft.STEP_MIN}-minute steps)."
        )

    # Split by time, never shuffle: the model must be tested on data from after its training period
    cut = int(len(X) * (1 - TEST_FRACTION))
    X_train, X_test = X.iloc[:cut], X.iloc[cut:]
    print(f"{len(X)} rows: {cut} train, {len(X) - cut} test")

    models = {}
    for t in TARGETS:
        model = GradientBoostingRegressor(random_state=0).fit(X_train, Y[t].iloc[:cut])
        mae = mean_absolute_error(Y[t].iloc[cut:], model.predict(X_test))
        naive = mean_absolute_error(Y[t].iloc[cut:], X_test[t])  # "same as now"
        print(f"{t}: MAE {mae:.3f} (naive baseline {naive:.3f})")
        models[t] = model

    y_stress = Y["stress"].astype(int)
    if y_stress.iloc[:cut].nunique() < 2:
        raise SystemExit(
            "Stress label has only one class in the training part: the data never crosses the thresholds."
        )
    clf = GradientBoostingClassifier(random_state=0).fit(X_train, y_stress.iloc[:cut])
    print(
        f"stress: F1 {f1_score(y_stress.iloc[cut:], clf.predict(X_test), zero_division=0):.3f}"
    )
    models["stress"] = clf

    # Refit on everything so the saved model has seen the most recent data
    for t in TARGETS:
        models[t].fit(X, Y[t])
    models["stress"].fit(X, y_stress)

    joblib.dump(
        {
            "models": models,
            "columns": list(X.columns),
            "horizon_minutes": ft.HORIZON_MIN,
            "stress_window_minutes": ft.STRESS_WINDOW_MIN,
        },
        MODEL_PATH,
    )
    print(f"Saved {MODEL_PATH.name}")


if __name__ == "__main__":
    main()
