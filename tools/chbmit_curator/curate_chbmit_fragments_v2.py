#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import pyedflib

from curate_chbmit_fragments import (
    CHANNEL_PREFERENCE,
    CuratorFileContext,
    DEFAULT_SUMMARY_BASE_URL,
    FileSummary,
    SegmentCandidate,
    annotate_ictal_similarity,
    annotate_phase_similarities,
    build_manifest,
    build_ictal_reference,
    build_phase_reference,
    choose_reference_channel,
    compute_epoch_features,
    infer_case_code,
    intervals_overlap,
    parse_subject_info,
    parse_summary,
    read_signal_bundle,
    read_text,
    safe_label,
    select_state_candidates,
    write_fragment_edf,
)

CURATOR_VERSION = "v2"
CURATOR_FAMILY = "heuristic+yasa+subject-ictal-split"
CURATOR_DESCRIPTION = "Curate CHB-MIT fragments using YASA + heuristic comparison."

STAGE_TO_INT = {
    "UNS": 0,
    "N3": 1,
    "N2": 2,
    "N1": 3,
    "REM": 4,
    "REM_LIKE": 4,
    "WAKE": 5,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=f"{CURATOR_DESCRIPTION} (version {CURATOR_VERSION})",
    )
    parser.add_argument("--input-dir", required=True, help="Directory with reconstructed EDF files")
    parser.add_argument("--output-dir", required=True, help="Directory where curated fragments will be written")
    parser.add_argument("--case-code", help="Override inferred CHB-MIT case code (e.g. chb17)")
    parser.add_argument("--summary-file", help="Local chbNN-summary.txt file")
    parser.add_argument("--summary-url", help="Remote raw summary URL")
    parser.add_argument("--subject-info-file", help="Local SUBJECT-INFO file")
    parser.add_argument("--subject-info-url", help="Remote raw SUBJECT-INFO URL")
    parser.add_argument("--pre-seizure-seconds", type=int, default=180, help="Seconds to prepend before seizure onset")
    parser.add_argument("--post-seizure-seconds", type=int, default=180, help="Seconds to append after seizure end")
    parser.add_argument("--state-seconds", type=int, default=180, help="Target duration for curated state fragments")
    parser.add_argument("--max-fast", type=int, default=1, help="Maximum indeterminate fast fragments to keep")
    parser.add_argument("--max-slow", type=int, default=1, help="Maximum indeterminate slow fragments to keep")
    parser.add_argument("--max-nrem", type=int, default=1, help="Maximum clear NREM fragments to keep")
    parser.add_argument("--max-preictal-like", type=int, default=1, help="Maximum preictal-like fragments to keep")
    parser.add_argument("--max-ictal-core-like", type=int, default=1, help="Maximum ictal-core-like fragments to keep")
    parser.add_argument("--max-postictal-like", type=int, default=1, help="Maximum postictal-like fragments to keep")
    parser.add_argument("--epoch-seconds", type=int, default=30, help="Epoch length used for staging")
    parser.add_argument("--yasa-confidence", type=float, default=0.80, help="Minimum YASA confidence to accept wake/NREM epochs")
    parser.add_argument(
        "--ictal-exclude-threshold",
        type=float,
        default=0.78,
        help="Mark epochs as ictal-like for clean-fragment selection if their similarity reaches this threshold",
    )
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output fragments")
    return parser.parse_args()


def load_optional_staging_dependencies():
    try:
        import matplotlib.pyplot as plt
        import mne
        import pandas as pd
        import yasa
    except ModuleNotFoundError as exc:
        missing = exc.name or "dependencia opcional"
        raise SystemExit(
            "Faltan dependencias para la versión 2 del curador "
            f"({missing}). Instala primero:\n"
            "  pip install -r requirements-v2.txt"
        ) from exc
    return plt, mne, pd, yasa


def normalize_yasa_stage(stage: str) -> str:
    stage = stage.upper()
    if stage == "WAKE":
        return "WAKE"
    if stage in {"N1", "N2", "N3"}:
        return stage
    if stage == "REM":
        return "REM"
    return "UNS"


def stage_to_broad(stage: str) -> str:
    stage = stage.upper()
    if stage == "WAKE":
        return "WAKE"
    if stage in {"N1", "N2", "N3"}:
        return "NREM"
    if stage in {"REM", "REM_LIKE"}:
        return "REM"
    return "UNS"


def compose_stage_label(vigilance_stage: str, epileptiform_flag: str) -> str:
    base = str(vigilance_stage).lower()
    if epileptiform_flag == "ICTAL_ANNOTATED":
        return f"{base}_ictal_annotated"
    if epileptiform_flag == "ICTAL_LIKE":
        return f"{base}_ictal_like"
    return f"{base}_normal"


def centered_triangular_mean(values: np.ndarray, window: int = 15) -> np.ndarray:
    if values.size == 0:
        return values
    half = window // 2
    weights = np.arange(1, half + 2, dtype=np.float64)
    if window % 2 == 0:
        tri = np.concatenate([weights, weights[::-1]])
    else:
        tri = np.concatenate([weights, weights[-2::-1]])
    output = np.zeros_like(values, dtype=np.float64)
    for idx in range(values.size):
        start = max(0, idx - half)
        end = min(values.size, idx + half + 1)
        left_trim = half - (idx - start)
        right_trim = half - (end - idx - 1)
        local_weights = tri[left_trim: len(tri) - right_trim]
        output[idx] = float(np.sum(values[start:end] * local_weights) / np.sum(local_weights))
    return output


def trailing_mean(values: np.ndarray, window: int = 4) -> np.ndarray:
    if values.size == 0:
        return values
    output = np.zeros_like(values, dtype=np.float64)
    for idx in range(values.size):
        start = max(0, idx - window + 1)
        output[idx] = float(np.mean(values[start: idx + 1]))
    return output


def robust_scale_array(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    q05 = float(np.quantile(values, 0.05))
    q95 = float(np.quantile(values, 0.95))
    median = float(np.median(values))
    scale = max(q95 - q05, 1e-6)
    return (values - median) / scale


def heuristic_stage_labels(features: list[object]) -> tuple[list[dict[str, object]], list]:
    if not features:
        return [], features

    delta = np.array([feat.delta_ratio for feat in features], dtype=np.float64)
    theta = np.array([feat.theta_ratio for feat in features], dtype=np.float64)
    sigma = np.array([feat.sigma_ratio for feat in features], dtype=np.float64)
    beta = np.array([feat.beta_ratio for feat in features], dtype=np.float64)
    spindle = np.array([feat.spindle_ratio for feat in features], dtype=np.float64)
    posterior_alpha = np.array([feat.posterior_alpha_ratio for feat in features], dtype=np.float64)
    alpha_gradient = np.array([feat.alpha_gradient for feat in features], dtype=np.float64)
    entropy = np.array([feat.spectral_entropy for feat in features], dtype=np.float64)
    complexity = np.array([feat.hjorth_complexity for feat in features], dtype=np.float64)
    wake_score_raw = np.array([feat.wake_score for feat in features], dtype=np.float64)
    nrem_score_raw = np.array([feat.nrem_score for feat in features], dtype=np.float64)

    delta_c = centered_triangular_mean(delta, window=15)
    theta_c = centered_triangular_mean(theta, window=15)
    sigma_c = centered_triangular_mean(sigma, window=15)
    beta_c = centered_triangular_mean(beta, window=15)
    spindle_c = centered_triangular_mean(spindle, window=15)
    entropy_c = centered_triangular_mean(entropy, window=15)
    complexity_c = centered_triangular_mean(complexity, window=15)
    alpha_c = centered_triangular_mean(posterior_alpha, window=15)
    gradient_c = centered_triangular_mean(alpha_gradient, window=15)

    delta_p = trailing_mean(delta, window=4)
    sigma_p = trailing_mean(sigma, window=4)
    beta_p = trailing_mean(beta, window=4)
    spindle_p = trailing_mean(spindle, window=4)
    theta_p = trailing_mean(theta, window=4)
    wake_p = trailing_mean(wake_score_raw, window=4)
    nrem_p = trailing_mean(nrem_score_raw, window=4)

    delta_c_norm = robust_scale_array(delta_c)
    sigma_c_norm = robust_scale_array(sigma_c)
    beta_c_norm = robust_scale_array(beta_c)
    spindle_c_norm = robust_scale_array(spindle_c)
    alpha_c_norm = robust_scale_array(alpha_c)
    gradient_c_norm = robust_scale_array(gradient_c)
    wake_c_norm = robust_scale_array(centered_triangular_mean(wake_score_raw, window=15))
    nrem_c_norm = robust_scale_array(centered_triangular_mean(nrem_score_raw, window=15))
    wake_p_norm = robust_scale_array(wake_p)
    nrem_p_norm = robust_scale_array(nrem_p)

    likely_sleep_mask = np.array(
        [feat.nrem_candidate or feat.sleep_anchor or feat.nrem_score > feat.wake_score for feat in features],
        dtype=bool,
    )
    if np.any(likely_sleep_mask):
        sleep_delta = delta_c[likely_sleep_mask]
        sleep_sigma = sigma_c[likely_sleep_mask]
        sleep_entropy = entropy_c[likely_sleep_mask]
    else:
        sleep_delta = delta_c
        sleep_sigma = sigma_c
        sleep_entropy = entropy_c

    n3_delta_threshold = max(0.34, float(np.quantile(sleep_delta, 0.70)))
    n3_delta_peak_threshold = max(0.38, float(np.quantile(sleep_delta, 0.82)))
    n2_sigma_threshold = max(0.055, float(np.quantile(sleep_sigma, 0.45)))
    n3_entropy_threshold = min(0.88, float(np.quantile(sleep_entropy, 0.55)))

    rows: list[dict[str, object]] = []
    for epoch_index, feat in enumerate(features):
        neighborhood = features[max(0, epoch_index - 2): min(len(features), epoch_index + 3)]
        sleep_neighbors = sum(1 for epoch in neighborhood if epoch.nrem_candidate or epoch.sleep_anchor)
        wake_neighbors = sum(1 for epoch in neighborhood if epoch.wake_candidate)
        mean_delta = float(delta_c[epoch_index])
        mean_theta = float(theta_c[epoch_index])
        mean_sigma = float(sigma_c[epoch_index])
        mean_beta = float(beta_c[epoch_index])
        mean_spindle = float(spindle_c[epoch_index])
        mean_entropy = float(entropy_c[epoch_index])
        mean_complexity = float(complexity_c[epoch_index])
        mean_gradient = float(gradient_c[epoch_index])
        mean_posterior_alpha = float(alpha_c[epoch_index])
        past_delta = float(delta_p[epoch_index])
        past_sigma = float(sigma_p[epoch_index])
        past_beta = float(beta_p[epoch_index])
        past_spindle = float(spindle_p[epoch_index])
        past_theta = float(theta_p[epoch_index])
        wake_context = (
            1.10 * float(wake_c_norm[epoch_index])
            + 0.45 * float(wake_p_norm[epoch_index])
            + 0.30 * float(beta_c_norm[epoch_index])
            + 0.30 * float(alpha_c_norm[epoch_index])
            + 0.18 * float(gradient_c_norm[epoch_index])
            - 0.55 * float(delta_c_norm[epoch_index])
            - 0.25 * float(sigma_c_norm[epoch_index])
            - 0.18 * float(spindle_c_norm[epoch_index])
        )
        sleep_context = (
            1.05 * float(nrem_c_norm[epoch_index])
            + 0.45 * float(nrem_p_norm[epoch_index])
            + 0.38 * float(delta_c_norm[epoch_index])
            + 0.24 * float(sigma_c_norm[epoch_index])
            + 0.12 * float(spindle_c_norm[epoch_index])
            - 0.20 * float(beta_c_norm[epoch_index])
            - 0.18 * float(alpha_c_norm[epoch_index])
        )

        wake_likelihood = (
            1.2 * feat.posterior_alpha_ratio
            + 0.9 * feat.beta_ratio
            + 0.8 * max(feat.alpha_gradient, 0.0)
            + 0.2 * feat.alpha_ratio
            - 1.1 * feat.delta_ratio
            - 0.45 * feat.sigma_ratio
            - 0.20 * max(feat.spindle_ratio - 1.0, 0.0)
        )
        sleep_likelihood = (
            1.1 * feat.delta_ratio
            + 0.55 * feat.theta_ratio
            + 0.80 * feat.sigma_ratio
            + 0.18 * min(feat.spindle_ratio, 3.0)
            - 0.45 * feat.beta_ratio
            - 0.30 * max(feat.alpha_gradient, 0.0)
        )
        n2_likelihood = (
            0.35 * feat.delta_ratio
            + 0.55 * feat.theta_ratio
            + 1.15 * feat.sigma_ratio
            + 0.22 * min(feat.spindle_ratio, 3.0)
            + 0.42 * mean_sigma
            + 0.10 * mean_spindle
            + 0.18 * past_sigma
            + 0.08 * past_spindle
            - 0.30 * feat.beta_ratio
            - 0.18 * max(feat.alpha_gradient, 0.0)
            - 0.14 * feat.posterior_alpha_ratio
        )
        n3_likelihood = (
            1.10 * feat.delta_ratio
            + 1.15 * mean_delta
            + 0.55 * past_delta
            + 0.10 * feat.theta_ratio
            + 0.16 * max(sleep_neighbors - 1, 0)
            - 0.38 * feat.beta_ratio
            - 0.16 * mean_sigma
            - 0.22 * feat.posterior_alpha_ratio
            - 0.16 * feat.spectral_entropy
            - 0.10 * mean_entropy
            - 0.10 * feat.hjorth_complexity
            - 0.05 * mean_complexity
        )
        rem_like_likelihood = (
            0.75 * feat.theta_ratio
            + 0.28 * mean_theta
            + 0.10 * past_theta
            + 0.35 * feat.beta_ratio
            + 0.16 * feat.spectral_entropy
            + 0.08 * mean_entropy
            + 0.05 * mean_complexity
            - 0.90 * feat.delta_ratio
            - 0.55 * feat.sigma_ratio
            - 0.12 * min(feat.spindle_ratio, 3.0)
            - 0.18 * feat.posterior_alpha_ratio
            - 0.10 * max(mean_gradient, 0.0)
        )
        wake_margin = wake_likelihood - sleep_likelihood
        sleep_margin = sleep_likelihood - wake_likelihood
        n3_margin = n3_likelihood - max(n2_likelihood, wake_likelihood, rem_like_likelihood)
        n2_margin = n2_likelihood - max(n3_likelihood, wake_likelihood, rem_like_likelihood)
        rem_margin = rem_like_likelihood - max(n2_likelihood, n3_likelihood, wake_likelihood)
        strong_n3 = (
            (
                feat.nrem_candidate
                or feat.sleep_anchor
                or sleep_margin > 0.08
                or sleep_context > 0.15
                or (sleep_neighbors >= 2 and mean_delta >= 0.24 and past_beta < 0.09)
            )
            and feat.delta_ratio >= n3_delta_peak_threshold
            and mean_delta >= n3_delta_threshold
            and past_delta >= max(0.28, n3_delta_threshold - 0.02)
            and feat.beta_ratio < 0.08
            and past_beta < 0.085
            and mean_posterior_alpha < 0.12
            and mean_entropy <= n3_entropy_threshold
            and sleep_neighbors >= 3
            and n3_margin > 0.04
        )
        likely_sleep = (
            feat.nrem_candidate
            or feat.sleep_anchor
            or sleep_margin > 0.08
            or sleep_context > 0.15
            or (sleep_neighbors >= 2 and mean_delta >= 0.24 and past_beta < 0.09)
        )
        stable_n2 = (
            likely_sleep
            and not strong_n3
            and (
                feat.sigma_ratio >= n2_sigma_threshold
                or feat.spindle_ratio >= 1.45
                or mean_sigma >= n2_sigma_threshold
                or mean_spindle >= 1.35
                or past_sigma >= n2_sigma_threshold
            )
        )
        strong_wake = (
            not strong_n3
            and not stable_n2
            and wake_context > max(0.0, sleep_context - 0.10)
            and (
                mean_delta < max(0.24, n3_delta_threshold - 0.08)
                or float(delta_c_norm[epoch_index]) < -0.10
            )
            and mean_sigma < max(0.07, n2_sigma_threshold + 0.01)
            and mean_spindle < 1.45
            and (
                feat.posterior_alpha_ratio >= 0.08
                or mean_posterior_alpha >= 0.085
                or feat.beta_ratio >= 0.075
                or past_beta >= 0.075
                or float(wake_c_norm[epoch_index]) > 0.10
            )
        )
        rescue_wake = (
            not strong_n3
            and not stable_n2
            and not likely_sleep
            and wake_neighbors >= 1
            and mean_sigma < 0.065
            and mean_spindle < 1.35
            and wake_context > -0.05
        )

        if strong_wake or rescue_wake or (feat.wake_candidate and (not feat.nrem_candidate or wake_margin >= -0.05)):
            stage = "WAKE"
            confidence = min(0.99, max(0.5, 0.60 + max(wake_margin, wake_context)))
        elif strong_n3:
            stage = "N3"
            confidence = min(0.99, max(0.5, 0.60 + n3_margin))
        elif stable_n2 and n2_margin > -0.08:
            stage = "N2"
            confidence = min(0.99, max(0.5, 0.60 + max(n2_margin, 0.0)))
        elif likely_sleep and (not feat.wake_candidate or sleep_margin > 0.08):
            stage = "N3" if strong_n3 else "N2"
            confidence = min(0.99, max(0.5, 0.62 + sleep_margin))
        elif (
            feat.delta_ratio < 0.22
            and feat.sigma_ratio < 0.08
            and (feat.posterior_alpha_ratio >= 0.10 or feat.beta_ratio >= 0.085 or feat.alpha_gradient >= 0.015)
            and wake_margin > 0.02
        ):
            stage = "WAKE"
            confidence = min(0.9, max(0.5, 0.58 + wake_margin))
        elif (
            feat.theta_ratio >= 0.16
            and feat.delta_ratio < 0.22
            and feat.sigma_ratio < 0.06
            and feat.posterior_alpha_ratio < 0.10
            and feat.beta_ratio < 0.11
            and wake_neighbors <= 1
            and sleep_neighbors >= 1
            and rem_margin > 0.04
        ):
            stage = "REM_LIKE"
            confidence = min(0.92, max(0.5, 0.56 + rem_margin))
        else:
            stage = "UNS"
            confidence = 0.0
        rows.append({
            "epochIndex": epoch_index,
            "stage": stage,
            "vigilanceStage": stage,
            "broadStage": stage_to_broad(stage),
            "epileptiformFlag": "NORMAL",
            "compositeStage": compose_stage_label(stage, "NORMAL"),
            "confidence": round(float(confidence), 4),
            "startSec": feat.start_sec,
            "endSec": feat.end_sec,
            "wakeScore": round(float(feat.wake_score), 4),
            "nremScore": round(float(feat.nrem_score), 4),
            "ictalSimilarity": round(float(feat.ictal_similarity), 4),
            "preictalSimilarity": round(float(feat.preictal_similarity), 4),
            "ictalCoreSimilarity": round(float(feat.ictal_core_similarity), 4),
            "postictalSimilarity": round(float(feat.postictal_similarity), 4),
            "epileptiformSimilarity": round(
                float(
                    max(
                        feat.ictal_core_similarity,
                        0.85 * feat.preictal_similarity,
                        0.85 * feat.postictal_similarity,
                    )
                ),
                4,
            ),
        })
    return rows, features


def run_yasa_staging(source_path: Path, channel_name: str, subject_metadata: dict[str, object]) -> list[dict[str, object]]:
    _plt, mne, pd, yasa = load_optional_staging_dependencies()
    raw = mne.io.read_raw_edf(str(source_path), preload=True, verbose="ERROR", include=[channel_name])
    metadata = {}
    if subject_metadata.get("ageYears") is not None:
        metadata["age"] = subject_metadata["ageYears"]
    if subject_metadata.get("sex") is not None:
        metadata["male"] = str(subject_metadata["sex"]).upper() == "M"
    sls = yasa.SleepStaging(raw, eeg_name=channel_name, metadata=metadata or None)
    hyp = sls.predict()
    proba = hyp.proba
    rows: list[dict[str, object]] = []
    for epoch_index, stage in enumerate(list(hyp.hypno)):
        confidence = float(proba.iloc[epoch_index].max()) if proba is not None else 0.0
        normalized_stage = normalize_yasa_stage(str(stage))
        rows.append({
            "epochIndex": epoch_index,
            "stage": normalized_stage,
            "vigilanceStage": normalized_stage,
            "broadStage": stage_to_broad(normalized_stage),
            "epileptiformFlag": "NORMAL",
            "compositeStage": compose_stage_label(normalized_stage, "NORMAL"),
            "stageDetailed": str(stage),
            "confidence": round(confidence, 4),
        })
    return rows


def annotate_epileptiform_epochs(
    heuristic_rows: list[dict[str, object]],
    yasa_rows: list[dict[str, object]],
    blocked_intervals: list[tuple[int, int]],
    ictal_exclude_threshold: float,
) -> None:
    for heuristic_row, yasa_row in zip(heuristic_rows, yasa_rows):
        start_sec = int(heuristic_row["startSec"])
        end_sec = int(heuristic_row["endSec"])
        is_annotated_or_surrounding_seizure = any(
            intervals_overlap(start_sec, end_sec, block_start, block_end)
            for block_start, block_end in blocked_intervals
        )
        is_ictal_like = float(heuristic_row.get("epileptiformSimilarity", 0.0)) >= ictal_exclude_threshold
        epileptiform_flag = "NORMAL"
        if is_annotated_or_surrounding_seizure:
            epileptiform_flag = "ICTAL_ANNOTATED"
        elif is_ictal_like:
            epileptiform_flag = "ICTAL_LIKE"

        heuristic_row["epileptiformFlag"] = epileptiform_flag
        heuristic_row["compositeStage"] = compose_stage_label(str(heuristic_row["stage"]), epileptiform_flag)
        yasa_row["epileptiformFlag"] = epileptiform_flag
        yasa_row["compositeStage"] = compose_stage_label(str(yasa_row["stage"]), epileptiform_flag)


def row_is_clean_for_selection(row: dict[str, object]) -> bool:
    return str(row.get("epileptiformFlag", "NORMAL")) == "NORMAL"


def choose_consensus_segments(
    source_file: str,
    heuristic_rows: list[dict[str, object]],
    yasa_rows: list[dict[str, object]],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
    kind: str,
    epoch_seconds: int,
    min_confidence: float,
) -> list[dict[str, object]]:
    needed_epochs = max(1, target_seconds // epoch_seconds)
    candidates: list[dict[str, object]] = []
    for idx in range(0, len(heuristic_rows) - needed_epochs + 1):
        heuristic_window = heuristic_rows[idx: idx + needed_epochs]
        yasa_window = yasa_rows[idx: idx + needed_epochs]
        start_sec = int(heuristic_window[0]["startSec"])
        end_sec = int(heuristic_window[-1]["endSec"])
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        if any(not row_is_clean_for_selection(h) or not row_is_clean_for_selection(y) for h, y in zip(heuristic_window, yasa_window)):
            continue
        if not all(h["broadStage"] == kind.upper() for h in heuristic_window):
            continue
        if not all(y["broadStage"] == kind.upper() for y in yasa_window):
            continue
        confidence = float(np.mean([float(y["confidence"]) for y in yasa_window]))
        if confidence < min_confidence:
            continue
        mean_ictal = float(np.mean([float(h["ictalSimilarity"]) for h in heuristic_window]))
        if mean_ictal >= 0.70:
            continue
        score = confidence + float(np.mean([float(h["confidence"]) for h in heuristic_window])) * 0.25 - 0.25 * mean_ictal
        candidates.append({
            "sourceFile": source_file,
            "segmentStartSec": start_sec,
            "segmentEndSec": end_sec,
            "durationSeconds": end_sec - start_sec,
            "yasaConfidence": round(confidence, 4),
            "ictalSimilarity": round(mean_ictal, 4),
            "selectionMethod": "heuristic+yasa-consensus",
            "score": round(score, 4),
        })
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates


def write_hypnogram_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def plot_compare(path: Path, heuristic_all: list[dict[str, object]], yasa_all: list[dict[str, object]]) -> None:
    plt, _mne, _pd, _yasa = load_optional_staging_dependencies()
    path.parent.mkdir(parents=True, exist_ok=True)
    x = np.arange(len(heuristic_all))
    heuristic_y = np.array([STAGE_TO_INT.get(str(row["stage"]), 0) for row in heuristic_all])
    yasa_y = np.array([STAGE_TO_INT.get(str(row["stage"]), 0) for row in yasa_all])
    fig, axes = plt.subplots(2, 1, figsize=(16, 6), sharex=True)
    axes[0].step(x, heuristic_y, where="post", color="#0f766e")
    axes[0].set_title("Hipnograma heurístico")
    axes[1].step(x, yasa_y, where="post", color="#1d4ed8")
    axes[1].set_title("Hipnograma YASA (WAKE/N1/N2/N3/REM)")
    for axis in axes:
        axis.set_yticks([0, 1, 2, 3, 4, 5], ["UNS", "N3", "N2", "N1", "REM", "WAKE"])
        axis.grid(True, axis="y", alpha=0.2)
    axes[1].set_xlabel("Epochs de 30 s concatenados")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def main() -> int:
    args = parse_args()
    load_optional_staging_dependencies()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    edf_files = sorted(input_dir.glob("chb*_reconstructed.edf"))
    if not edf_files:
        raise SystemExit("No se encontraron EDFs reconstruidos en input-dir")

    case_code = (args.case_code or "").strip().lower() or infer_case_code([path.name for path in edf_files])
    summary_url = args.summary_url or f"{DEFAULT_SUMMARY_BASE_URL}{case_code}/{case_code}-summary.txt"
    subject_url = args.subject_info_url or f"{DEFAULT_SUMMARY_BASE_URL}SUBJECT-INFO"
    summary_text = read_text(Path(args.summary_file).expanduser() if args.summary_file else None, summary_url)
    subject_text = read_text(Path(args.subject_info_file).expanduser() if args.subject_info_file else None, subject_url)
    summary_map, summary_metadata = parse_summary(summary_text)
    subject_metadata = parse_subject_info(subject_text, case_code)

    case_output = output_dir / case_code
    seizures_dir = case_output / "seizures"
    fast_dir = case_output / "indeterminate_fast"
    slow_dir = case_output / "indeterminate_slow"
    nrem_dir = case_output / "nrem_clear"
    preictal_like_dir = case_output / "preictal_like"
    ictal_core_like_dir = case_output / "ictal_core_like"
    postictal_like_dir = case_output / "postictal_like"
    hypnogram_dir = case_output / "hypnograms"
    for directory in [
        seizures_dir,
        fast_dir,
        slow_dir,
        nrem_dir,
        preictal_like_dir,
        ictal_core_like_dir,
        postictal_like_dir,
        hypnogram_dir,
    ]:
        directory.mkdir(parents=True, exist_ok=True)

    gallery_metadata = {
        "caseCode": case_code,
        "recordImportedCount": len(edf_files),
        "recordExpectedCount": summary_metadata.get("recordExpectedCount"),
        "samplingRateHz": summary_metadata.get("samplingRateHz"),
        "channelCount": summary_metadata.get("channelCount"),
        "montage": summary_metadata.get("montage"),
        "subject": subject_metadata,
        "stagingMethod": CURATOR_FAMILY,
        "curatorVersion": CURATOR_VERSION,
    }

    seizure_manifest: list[dict[str, object]] = []
    fast_candidates: list[dict[str, object]] = []
    slow_candidates: list[dict[str, object]] = []
    nrem_consensus: list[dict[str, object]] = []
    preictal_like_candidates: list[SegmentCandidate] = []
    ictal_core_like_candidates: list[SegmentCandidate] = []
    postictal_like_candidates: list[SegmentCandidate] = []
    heuristic_all: list[dict[str, object]] = []
    yasa_all: list[dict[str, object]] = []
    file_contexts: list[CuratorFileContext] = []
    channel_names_by_file: dict[str, str] = {}

    for source_path in edf_files:
        original_filename = source_path.name.replace("_reconstructed", "")
        summary: FileSummary | None = summary_map.get(original_filename)
        if not summary:
            continue

        with pyedflib.EdfReader(str(source_path)) as reader:
            signal_bundle, sfreq, channel_name = read_signal_bundle(reader)
            total_seconds = int(signal_bundle["primary"].size / sfreq)

        blocked_intervals: list[tuple[int, int]] = []
        seizure_intervals: list[tuple[int, int]] = []
        for seizure_index, seizure in enumerate(summary.seizure_events or [], start=1):
            start_sec = max(0, seizure.start_sec - args.pre_seizure_seconds)
            end_sec = min(total_seconds, seizure.end_sec + args.post_seizure_seconds)
            blocked_intervals.append((start_sec, end_sec))
            seizure_intervals.append((seizure.start_sec, seizure.end_sec))
            output_name = f"{safe_label(case_code)}_{safe_label(source_path.stem)}_sz{seizure_index:02d}_{start_sec:05d}-{end_sec:05d}.edf"
            output_path = seizures_dir / output_name
            if args.overwrite or not output_path.exists():
                write_fragment_edf(source_path, output_path, start_sec, end_sec, "curated seizure fragment (-3min/+3min)")
            seizure_manifest.append({
                "type": "seizure",
                "file": str(output_path.relative_to(case_output)),
                "sourceFile": source_path.name,
                "sourceOriginalFilename": original_filename,
                "segmentStartSec": start_sec,
                "segmentEndSec": end_sec,
                "seizureStartSec": seizure.start_sec,
                "seizureEndSec": seizure.end_sec,
                "durationSeconds": end_sec - start_sec,
                "selectionMethod": "summary-annotation",
            })

        epochs = compute_epoch_features(signal_bundle, sfreq, args.epoch_seconds)
        file_contexts.append(CuratorFileContext(
            source_path=source_path,
            original_filename=original_filename,
            total_seconds=total_seconds,
            epochs=epochs,
            blocked_intervals=blocked_intervals,
            seizure_intervals=seizure_intervals,
        ))
        channel_names_by_file[source_path.name] = channel_name

    preictal_reference = build_phase_reference(file_contexts, "preictal", args.pre_seizure_seconds, args.post_seizure_seconds)
    ictal_core_reference = build_phase_reference(file_contexts, "ictal_core", args.pre_seizure_seconds, args.post_seizure_seconds)
    postictal_reference = build_phase_reference(file_contexts, "postictal", args.pre_seizure_seconds, args.post_seizure_seconds)

    for context in file_contexts:
        ictal_reference = build_ictal_reference(context.epochs, context.seizure_intervals)
        annotate_ictal_similarity(context.epochs, ictal_reference)
        annotate_phase_similarities(
            context.epochs,
            preictal_reference=preictal_reference,
            ictal_core_reference=ictal_core_reference,
            postictal_reference=postictal_reference,
        )

        heuristic_rows, _features = heuristic_stage_labels(context.epochs)
        yasa_rows = run_yasa_staging(
            context.source_path,
            channel_names_by_file[context.source_path.name],
            subject_metadata,
        )

        for row in heuristic_rows:
            row["sourceFile"] = context.source_path.name
        for idx, row in enumerate(yasa_rows):
            row["sourceFile"] = context.source_path.name
            row["startSec"] = heuristic_rows[idx]["startSec"]
            row["endSec"] = heuristic_rows[idx]["endSec"]

        annotate_epileptiform_epochs(
            heuristic_rows,
            yasa_rows,
            context.blocked_intervals,
            args.ictal_exclude_threshold,
        )

        preictal_like_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="preictal_like",
            )
        )
        ictal_core_like_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="ictal_core_like",
            )
        )
        postictal_like_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="postictal_like",
            )
        )

        heuristic_all.extend(heuristic_rows)
        yasa_all.extend(yasa_rows)

        # Fast indeterminate: trust YASA WAKE only when heuristic does not see sleep and confidence is high.
        needed_epochs = max(1, args.state_seconds // args.epoch_seconds)
        for idx in range(0, len(heuristic_rows) - needed_epochs + 1):
            heuristic_window = heuristic_rows[idx: idx + needed_epochs]
            yasa_window = yasa_rows[idx: idx + needed_epochs]
            start_sec = int(heuristic_window[0]["startSec"])
            end_sec = int(heuristic_window[-1]["endSec"])
            if any(
                intervals_overlap(start_sec, end_sec, block_start, block_end)
                for block_start, block_end in context.blocked_intervals
            ):
                continue
            if any(not row_is_clean_for_selection(h) or not row_is_clean_for_selection(y) for h, y in zip(heuristic_window, yasa_window)):
                continue
            if not all(y["broadStage"] == "WAKE" for y in yasa_window):
                continue
            if any(h["broadStage"] in {"NREM", "REM"} for h in heuristic_window):
                continue
            confidence = float(np.mean([float(y["confidence"]) for y in yasa_window]))
            if confidence < max(0.75, args.yasa_confidence - 0.05):
                continue
            mean_ictal = float(np.mean([float(h["ictalSimilarity"]) for h in heuristic_window]))
            if mean_ictal >= 0.60:
                continue
            fast_candidates.append({
                "sourceFile": context.source_path.name,
                "segmentStartSec": start_sec,
                "segmentEndSec": end_sec,
                "durationSeconds": end_sec - start_sec,
                "yasaConfidence": round(confidence, 4),
                "ictalSimilarity": round(mean_ictal, 4),
                "selectionMethod": "yasa-wake-high-confidence",
                "score": round(confidence + float(np.mean([float(h["wakeScore"]) for h in heuristic_window])) * 0.1 - 0.30 * mean_ictal, 4),
            })

        # Slow indeterminate: heuristic UNS with YASA sleep-ish tendency but no strong consensus.
        for idx in range(0, len(heuristic_rows) - needed_epochs + 1):
            heuristic_window = heuristic_rows[idx: idx + needed_epochs]
            yasa_window = yasa_rows[idx: idx + needed_epochs]
            start_sec = int(heuristic_window[0]["startSec"])
            end_sec = int(heuristic_window[-1]["endSec"])
            if any(
                intervals_overlap(start_sec, end_sec, block_start, block_end)
                for block_start, block_end in context.blocked_intervals
            ):
                continue
            if any(not row_is_clean_for_selection(h) or not row_is_clean_for_selection(y) for h, y in zip(heuristic_window, yasa_window)):
                continue
            if any(h["broadStage"] == "NREM" for h in heuristic_window):
                continue
            slow_votes = sum(1 for h in heuristic_window if float(h["nremScore"]) > float(h["wakeScore"]))
            yasa_sleep_votes = sum(1 for y in yasa_window if y["broadStage"] in {"NREM", "REM"})
            if slow_votes < max(2, needed_epochs // 2):
                continue
            if yasa_sleep_votes < max(2, needed_epochs // 2):
                continue
            confidence = float(np.mean([float(y["confidence"]) for y in yasa_window if y["broadStage"] in {"NREM", "REM"}] or [0.0]))
            mean_ictal = float(np.mean([float(h["ictalSimilarity"]) for h in heuristic_window]))
            if mean_ictal >= 0.72:
                continue
            slow_candidates.append({
                "sourceFile": context.source_path.name,
                "segmentStartSec": start_sec,
                "segmentEndSec": end_sec,
                "durationSeconds": end_sec - start_sec,
                "yasaConfidence": round(confidence, 4),
                "ictalSimilarity": round(mean_ictal, 4),
                "selectionMethod": "heuristic-slow-plus-yasa-sleepish",
                "score": round(confidence + float(np.mean([float(h["nremScore"]) for h in heuristic_window])) * 0.15 - 0.20 * mean_ictal, 4),
            })

        nrem_consensus.extend(
            choose_consensus_segments(
                source_file=context.source_path.name,
                heuristic_rows=heuristic_rows,
                yasa_rows=yasa_rows,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="nrem",
                epoch_seconds=args.epoch_seconds,
                min_confidence=args.yasa_confidence,
            )
        )

    def materialize(kind: str, candidates: list[dict[str, object]], limit: int, target_dir: Path) -> list[dict[str, object]]:
        manifest_items: list[dict[str, object]] = []
        used: list[tuple[str, int, int]] = []
        for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
            if len(manifest_items) >= limit:
                break
            if any(
                prev_file == candidate["sourceFile"] and intervals_overlap(candidate["segmentStartSec"], candidate["segmentEndSec"], prev_start, prev_end)
                for prev_file, prev_start, prev_end in used
            ):
                continue
            source_path = input_dir / str(candidate["sourceFile"])
            output_name = (
                f"{safe_label(case_code)}_{safe_label(Path(str(candidate['sourceFile'])).stem)}_"
                f"{kind}_{int(candidate['segmentStartSec']):05d}-{int(candidate['segmentEndSec']):05d}.edf"
            )
            output_path = target_dir / output_name
            if args.overwrite or not output_path.exists():
                write_fragment_edf(
                    source_path,
                    output_path,
                    int(candidate["segmentStartSec"]),
                    int(candidate["segmentEndSec"]),
                    f"curated {kind} fragment (heuristic + YASA consensus)",
                )
            used.append((str(candidate["sourceFile"]), int(candidate["segmentStartSec"]), int(candidate["segmentEndSec"])))
            manifest_items.append({
                "type": kind,
                "file": str(output_path.relative_to(case_output)),
                **candidate,
            })
        return manifest_items

    def materialize_phase_like(kind: str, candidates: list[SegmentCandidate], limit: int, target_dir: Path) -> list[dict[str, object]]:
        manifest_items: list[dict[str, object]] = []
        used: list[tuple[str, int, int]] = []
        for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
            if len(manifest_items) >= limit:
                break
            if any(
                prev_file == candidate.source_file and intervals_overlap(candidate.start_sec, candidate.end_sec, prev_start, prev_end)
                for prev_file, prev_start, prev_end in used
            ):
                continue
            source_path = input_dir / candidate.source_file
            output_name = (
                f"{safe_label(case_code)}_{safe_label(Path(candidate.source_file).stem)}_"
                f"{kind}_{candidate.start_sec:05d}-{candidate.end_sec:05d}.edf"
            )
            output_path = target_dir / output_name
            if args.overwrite or not output_path.exists():
                write_fragment_edf(
                    source_path,
                    output_path,
                    candidate.start_sec,
                    candidate.end_sec,
                    f"curated {kind} fragment (subject-specific ictal similarity)",
                )
            used.append((candidate.source_file, candidate.start_sec, candidate.end_sec))
            manifest_items.append({
                "type": kind,
                "file": str(output_path.relative_to(case_output)),
                "sourceFile": candidate.source_file,
                "segmentStartSec": candidate.start_sec,
                "segmentEndSec": candidate.end_sec,
                "durationSeconds": candidate.end_sec - candidate.start_sec,
                "selectionMethod": "subject-specific-ictal-similarity",
                "score": round(float(candidate.score), 4),
                "epochCount": len(candidate.epochs),
                "ictalSimilarity": round(float(np.mean([epoch.ictal_similarity for epoch in candidate.epochs])), 4),
                "preictalSimilarity": round(float(np.mean([epoch.preictal_similarity for epoch in candidate.epochs])), 4),
                "ictalCoreSimilarity": round(float(np.mean([epoch.ictal_core_similarity for epoch in candidate.epochs])), 4),
                "postictalSimilarity": round(float(np.mean([epoch.postictal_similarity for epoch in candidate.epochs])), 4),
            })
        return manifest_items

    fast_manifest = materialize("indeterminate_fast", fast_candidates, args.max_fast, fast_dir)
    slow_manifest = materialize("indeterminate_slow", slow_candidates, args.max_slow, slow_dir)
    nrem_manifest = materialize("nrem_clear", nrem_consensus, args.max_nrem, nrem_dir)
    preictal_like_manifest = materialize_phase_like("preictal_like", preictal_like_candidates, args.max_preictal_like, preictal_like_dir)
    ictal_core_like_manifest = materialize_phase_like("ictal_core_like", ictal_core_like_candidates, args.max_ictal_core_like, ictal_core_like_dir)
    postictal_like_manifest = materialize_phase_like("postictal_like", postictal_like_candidates, args.max_postictal_like, postictal_like_dir)

    write_hypnogram_csv(hypnogram_dir / f"{case_code}_heuristic_hypnogram.csv", heuristic_all)
    write_hypnogram_csv(hypnogram_dir / f"{case_code}_yasa_hypnogram.csv", yasa_all)
    plot_compare(hypnogram_dir / f"{case_code}_hypnogram_compare.png", heuristic_all, yasa_all)

    agreement_rows = [
        (h["broadStage"], y["broadStage"])
        for h, y in zip(heuristic_all, yasa_all)
        if (h["broadStage"] != "UNS" or y["broadStage"] != "UNS")
    ]
    agreement = (
        sum(1 for h_stage, y_stage in agreement_rows if h_stage == y_stage) / len(agreement_rows)
        if agreement_rows else 0.0
    )
    detailed_rows = [
        (str(h["stage"]), str(y["stage"]))
        for h, y in zip(heuristic_all, yasa_all)
        if (h["stage"] != "UNS" or y["stage"] != "UNS")
    ]
    detailed_agreement = (
        sum(
            1
            for h_stage, y_stage in detailed_rows
            if h_stage == y_stage or (h_stage == "REM_LIKE" and y_stage == "REM")
        ) / len(detailed_rows)
        if detailed_rows else 0.0
    )
    sleep_depth_rows = [
        (str(h["stage"]), str(y["stage"]))
        for h, y in zip(heuristic_all, yasa_all)
        if h["stage"] in {"N2", "N3"} and y["stage"] in {"N2", "N3"}
    ]
    sleep_depth_agreement = (
        sum(1 for h_stage, y_stage in sleep_depth_rows if h_stage == y_stage) / len(sleep_depth_rows)
        if sleep_depth_rows else 0.0
    )

    manifest = build_manifest(
        case_code,
        gallery_metadata,
        seizure_manifest,
        nrem_manifest,
        fast_manifest,
        slow_manifest,
        preictal_like_segments=preictal_like_manifest,
        ictal_core_like_segments=ictal_core_like_manifest,
        postictal_like_segments=postictal_like_manifest,
    )
    manifest["hypnograms"] = {
        "heuristicCsv": str((hypnogram_dir / f"{case_code}_heuristic_hypnogram.csv").relative_to(case_output)),
        "yasaCsv": str((hypnogram_dir / f"{case_code}_yasa_hypnogram.csv").relative_to(case_output)),
        "comparePlot": str((hypnogram_dir / f"{case_code}_hypnogram_compare.png").relative_to(case_output)),
        "agreement": round(float(agreement), 4),
        "agreementBroad": round(float(agreement), 4),
        "agreementDetailed": round(float(detailed_agreement), 4),
        "sleepDepthAgreement": round(float(sleep_depth_agreement), 4),
    }
    manifest["curatorVersion"] = CURATOR_VERSION
    manifest["stagingMethod"] = CURATOR_FAMILY
    manifest["subjectSpecificIctalDetector"] = {
        "enabled": True,
        "referenceSource": "annotated seizures from same child",
        "fragments": {
            "preictalLike": len(preictal_like_manifest),
            "ictalCoreLike": len(ictal_core_like_manifest),
            "postictalLike": len(postictal_like_manifest),
        },
    }
    manifest_path = case_output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "caseCode": case_code,
        "curatorVersion": CURATOR_VERSION,
        "inputFiles": len(edf_files),
        "seizureFragments": len(seizure_manifest),
        "fastFragments": len(fast_manifest),
        "slowFragments": len(slow_manifest),
        "nremFragments": len(nrem_manifest),
        "preictalLikeFragments": len(preictal_like_manifest),
        "ictalCoreLikeFragments": len(ictal_core_like_manifest),
        "postictalLikeFragments": len(postictal_like_manifest),
        "agreement": round(float(agreement), 4),
        "outputDir": str(case_output),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
