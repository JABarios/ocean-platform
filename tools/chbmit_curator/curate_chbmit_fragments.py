#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.request import urlopen

import numpy as np
import pyedflib


DEFAULT_SUMMARY_BASE_URL = "https://physionet.org/files/chbmit/1.0.0/"
CHANNEL_PREFERENCE = ["Cz", "C3", "C4", "Pz", "Fz", "O1", "O2"]
POSTERIOR_CHANNEL_PREFERENCE = ["O1", "O2", "Pz", "P3", "P4"]
FRONTAL_CHANNEL_PREFERENCE = ["Fz", "F3", "F4", "Fp1", "Fp2"]


@dataclass
class SeizureEvent:
    source_file: str
    start_sec: int
    end_sec: int


@dataclass
class FileSummary:
    filename: str
    start_time: str | None = None
    end_time: str | None = None
    duration_seconds: int | None = None
    seizure_events: list[SeizureEvent] | None = None


@dataclass
class EpochFeatures:
    start_sec: int
    end_sec: int
    delta_ratio: float
    theta_ratio: float
    alpha_ratio: float
    sigma_ratio: float
    beta_ratio: float
    spindle_ratio: float
    posterior_alpha_ratio: float
    frontal_alpha_ratio: float
    alpha_gradient: float
    spectral_entropy: float
    line_length: float
    hjorth_mobility: float
    hjorth_complexity: float
    wake_score: float
    drowsy_score: float
    nrem_score: float
    ictal_similarity: float
    preictal_similarity: float
    ictal_core_similarity: float
    postictal_similarity: float
    sleep_anchor: bool
    wake_candidate: bool
    drowsy_candidate: bool
    nrem_candidate: bool


@dataclass
class SegmentCandidate:
    source_file: str
    start_sec: int
    end_sec: int
    score: float
    kind: str
    epochs: list[EpochFeatures]


@dataclass
class CuratorFileContext:
    source_path: Path
    original_filename: str
    total_seconds: int
    epochs: list[EpochFeatures]
    blocked_intervals: list[tuple[int, int]]
    seizure_intervals: list[tuple[int, int]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Curate seizure, wake, and NREM EDF fragments from CHB-MIT reconstructed files.",
    )
    parser.add_argument("--input-dir", required=True, help="Directory with reconstructed EDF files")
    parser.add_argument("--output-dir", required=True, help="Directory where curated fragments will be written")
    parser.add_argument("--summary-file", help="Local chbNN-summary.txt file")
    parser.add_argument("--summary-url", help="Remote raw summary URL")
    parser.add_argument("--subject-info-file", help="Local SUBJECT-INFO file")
    parser.add_argument("--subject-info-url", help="Remote raw SUBJECT-INFO URL")
    parser.add_argument("--pre-seizure-seconds", type=int, default=180, help="Seconds to prepend before seizure onset")
    parser.add_argument("--post-seizure-seconds", type=int, default=180, help="Seconds to append after seizure end")
    parser.add_argument("--state-seconds", type=int, default=180, help="Target duration for wake/NREM fragments")
    parser.add_argument("--max-fast", type=int, default=1, help="Maximum indeterminate fast fragments to keep")
    parser.add_argument("--max-slow", type=int, default=1, help="Maximum indeterminate slow fragments to keep")
    parser.add_argument("--max-nrem", type=int, default=1, help="Maximum clear NREM fragments to keep")
    parser.add_argument("--max-preictal-like", type=int, default=1, help="Maximum preictal-like fragments to keep")
    parser.add_argument("--max-ictal-core-like", type=int, default=1, help="Maximum ictal-core-like fragments to keep")
    parser.add_argument("--max-postictal-like", type=int, default=1, help="Maximum postictal-like fragments to keep")
    parser.add_argument("--epoch-seconds", type=int, default=30, help="Epoch length used for heuristic scoring")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output fragments")
    return parser.parse_args()


def infer_case_code(filenames: Iterable[str]) -> str:
    stems = []
    for filename in filenames:
        match = re.match(r"(chb\d+)_\d+_reconstructed\.edf$", filename, flags=re.IGNORECASE)
        if match:
            stems.append(match.group(1).lower())
    stems = sorted(set(stems))
    if len(stems) != 1:
        raise ValueError("No se pudo inferir un único case code CHB-MIT a partir de los ficheros reconstruidos")
    return stems[0]


def read_text(path: Path | None = None, url: str | None = None) -> str:
    if path:
        return path.read_text(encoding="utf-8")
    if url:
        with urlopen(url, timeout=30) as response:
            return response.read().decode("utf-8", errors="replace")
    raise ValueError("Hace falta summary-file o summary-url")


def parse_clock(value: str | None) -> int | None:
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    hh, mm, ss = [int(part) for part in parts]
    return hh * 3600 + mm * 60 + ss


def parse_summary(summary_text: str) -> tuple[dict[str, FileSummary], dict[str, object]]:
    records: dict[str, FileSummary] = {}
    current: FileSummary | None = None
    sample_rate_match = re.search(r"Data Sampling Rate:\s*(\d+)\s*Hz", summary_text)
    sampling_rate = int(sample_rate_match.group(1)) if sample_rate_match else None
    channel_count = len(re.findall(r"^Channel\s+\d+:", summary_text, flags=re.MULTILINE)) or None

    for line in summary_text.splitlines():
        file_match = re.match(r"File Name:\s*(.+\.edf)", line)
        if file_match:
            if current:
                records[current.filename] = current
            current = FileSummary(filename=file_match.group(1).strip(), seizure_events=[])
            continue
        if not current:
            continue
        start_match = re.match(r"File Start Time:\s*(.+)$", line)
        if start_match:
            current.start_time = start_match.group(1).strip()
            continue
        end_match = re.match(r"File End Time:\s*(.+)$", line)
        if end_match:
            current.end_time = end_match.group(1).strip()
            start_seconds = parse_clock(current.start_time)
            end_seconds = parse_clock(current.end_time)
            if start_seconds is not None and end_seconds is not None:
                current.duration_seconds = max(0, end_seconds - start_seconds)
            continue
        start_seizure_match = re.match(r"Seizure Start Time:\s*(\d+)\s*seconds", line)
        if start_seizure_match:
            current.seizure_events = current.seizure_events or []
            current.seizure_events.append(
                SeizureEvent(
                    source_file=current.filename,
                    start_sec=int(start_seizure_match.group(1)),
                    end_sec=int(start_seizure_match.group(1)),
                )
            )
            continue
        end_seizure_match = re.match(r"Seizure End Time:\s*(\d+)\s*seconds", line)
        if end_seizure_match and current.seizure_events:
            current.seizure_events[-1].end_sec = int(end_seizure_match.group(1))

    if current:
        records[current.filename] = current

    metadata = {
        "samplingRateHz": sampling_rate,
        "channelCount": channel_count,
        "montage": "bipolar 10-20" if channel_count else None,
        "recordExpectedCount": len(records),
    }
    return records, metadata


def parse_subject_info(subject_text: str, case_code: str) -> dict[str, object]:
    match = re.search(rf"^\s*{case_code}\s+([FM])\s+([0-9.]+)\s*$", subject_text, flags=re.MULTILINE)
    if not match:
        return {}
    age = float(match.group(2))
    age_value = int(age) if age.is_integer() else age
    return {
        "sex": match.group(1),
        "ageYears": age_value,
    }


def choose_reference_channel(labels: list[str]) -> str:
    normalized = {label.strip(): label for label in labels}
    for preferred in CHANNEL_PREFERENCE:
        if preferred in normalized:
            return normalized[preferred]
    if labels:
        return labels[0]
    raise ValueError("No hay canales en el EDF")


def choose_named_channel(labels: list[str], preferences: list[str]) -> str | None:
    normalized = {label.strip(): label for label in labels}
    for preferred in preferences:
        if preferred in normalized:
            return normalized[preferred]
    return None


def read_signal_bundle(reader: pyedflib.EdfReader) -> tuple[dict[str, np.ndarray], float, str]:
    labels = reader.getSignalLabels()
    primary_name = choose_reference_channel(labels)
    posterior_name = choose_named_channel(labels, POSTERIOR_CHANNEL_PREFERENCE)
    frontal_name = choose_named_channel(labels, FRONTAL_CHANNEL_PREFERENCE)

    bundle: dict[str, np.ndarray] = {}
    sfreq = float(reader.getSampleFrequency(labels.index(primary_name)))
    bundle["primary"] = reader.readSignal(labels.index(primary_name)).astype(np.float64)
    if posterior_name:
        bundle["posterior"] = reader.readSignal(labels.index(posterior_name)).astype(np.float64)
    if frontal_name:
        bundle["frontal"] = reader.readSignal(labels.index(frontal_name)).astype(np.float64)
    return bundle, sfreq, primary_name


def bandpower(signal: np.ndarray, sfreq: float, low: float, high: float) -> float:
    if signal.size == 0:
        return 0.0
    centered = signal - np.mean(signal)
    window = np.hanning(centered.size)
    spectrum = np.fft.rfft(centered * window)
    freqs = np.fft.rfftfreq(centered.size, d=1.0 / sfreq)
    psd = (np.abs(spectrum) ** 2) / max(centered.size, 1)
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return 0.0
    integrate = getattr(np, "trapezoid", None)
    if integrate is None:
        integrate = np.trapz
    return float(integrate(psd[mask], freqs[mask]))


def spindle_prominence(chunk: np.ndarray, sfreq: float) -> float:
    sigma = bandpower(chunk, sfreq, 11.0, 16.0)
    flank_low = bandpower(chunk, sfreq, 8.0, 10.5)
    flank_high = bandpower(chunk, sfreq, 16.5, 20.0)
    baseline = max((flank_low + flank_high) / 2.0, 1e-6)
    return sigma / baseline


def spectral_entropy_from_chunk(chunk: np.ndarray, sfreq: float) -> float:
    centered = chunk - np.mean(chunk)
    window = np.hanning(centered.size)
    spectrum = np.fft.rfft(centered * window)
    freqs = np.fft.rfftfreq(centered.size, d=1.0 / sfreq)
    psd = (np.abs(spectrum) ** 2) / max(centered.size, 1)
    mask = (freqs >= 0.5) & (freqs < 25.0)
    selected = psd[mask]
    if selected.size == 0:
        return 0.0
    total = float(np.sum(selected))
    if total <= 0:
        return 0.0
    probs = selected / total
    probs = probs[probs > 0]
    entropy = -float(np.sum(probs * np.log2(probs)))
    return entropy / max(np.log2(selected.size), 1e-6)


def hjorth_parameters(chunk: np.ndarray) -> tuple[float, float]:
    if chunk.size < 3:
        return 0.0, 0.0
    diff1 = np.diff(chunk)
    diff2 = np.diff(diff1)
    var0 = float(np.var(chunk))
    var1 = float(np.var(diff1))
    var2 = float(np.var(diff2))
    if var0 <= 1e-12 or var1 <= 1e-12:
        return 0.0, 0.0
    mobility = math.sqrt(var1 / var0)
    complexity = math.sqrt(var2 / var1) / max(mobility, 1e-6)
    return mobility, complexity


def line_length(chunk: np.ndarray) -> float:
    if chunk.size < 2:
        return 0.0
    return float(np.mean(np.abs(np.diff(chunk))))


def coerce_signal_bundle(signal: np.ndarray | dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    if isinstance(signal, dict):
        if "primary" in signal:
            return signal
        first_key = next(iter(signal), None)
        if first_key is None:
            raise ValueError("No hay señales en el bundle")
        return {"primary": np.asarray(signal[first_key], dtype=np.float64)}
    return {"primary": np.asarray(signal, dtype=np.float64)}


def detect_sleep_anchor_runs(features: list[EpochFeatures], min_len: int = 2) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, feature in enumerate(features):
        if feature.sleep_anchor:
            if start is None:
                start = index
        else:
            if start is not None and index - start >= min_len:
                runs.append((start, index - 1))
            start = None
    if start is not None and len(features) - start >= min_len:
        runs.append((start, len(features) - 1))
    return runs


def detect_drowsy_runs(features: list[EpochFeatures], min_len: int = 2) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, feature in enumerate(features):
        if feature.drowsy_candidate:
            if start is None:
                start = index
        else:
            if start is not None and index - start >= min_len:
                runs.append((start, index - 1))
            start = None
    if start is not None and len(features) - start >= min_len:
        runs.append((start, len(features) - 1))
    return runs


def smooth_epoch_features(features: list[EpochFeatures]) -> list[EpochFeatures]:
    if not features:
        return features

    initial_wake = [feature.wake_candidate for feature in features]
    initial_nrem = [feature.nrem_candidate for feature in features]
    initial_anchor = [feature.sleep_anchor for feature in features]

    for index, feature in enumerate(features):
        neighborhood = features[max(0, index - 1): min(len(features), index + 2)]
        wake_support = sum(1 for flag in initial_wake[max(0, index - 1): min(len(features), index + 2)] if flag)
        nrem_support = sum(1 for flag in initial_nrem[max(0, index - 1): min(len(features), index + 2)] if flag)
        anchor_support = sum(1 for flag in initial_anchor[max(0, index - 1): min(len(features), index + 2)] if flag)
        mean_delta = float(np.mean([epoch.delta_ratio for epoch in neighborhood]))
        mean_theta = float(np.mean([epoch.theta_ratio for epoch in neighborhood]))
        mean_alpha = float(np.mean([epoch.alpha_ratio for epoch in neighborhood]))
        mean_sigma = float(np.mean([epoch.sigma_ratio for epoch in neighborhood]))
        mean_beta = float(np.mean([epoch.beta_ratio for epoch in neighborhood]))
        mean_gradient = float(np.mean([epoch.alpha_gradient for epoch in neighborhood]))

        if wake_support >= 2 and mean_delta < 0.24:
            feature.wake_score += 0.08 * wake_support
        if nrem_support >= 2:
            feature.nrem_score += 0.08 * nrem_support
        if anchor_support >= 2:
            feature.nrem_score += 0.06 * anchor_support
        if feature.spindle_ratio >= 1.6 and mean_sigma >= 0.07 and mean_beta < 0.10:
            feature.nrem_score += 0.18 + min(0.25, 0.08 * feature.spindle_ratio)
        if feature.posterior_alpha_ratio >= 0.14 and mean_gradient >= 0.02 and mean_delta < 0.18:
            feature.wake_score += 0.06
        if mean_alpha >= 0.10 and mean_theta >= 0.16 and mean_gradient <= 0.02:
            feature.drowsy_score += 0.14
        if mean_theta >= 0.20 and mean_beta < 0.08:
            feature.nrem_score += 0.05

        feature.sleep_anchor = (
            feature.sleep_anchor
            or anchor_support >= 2
            or feature.spindle_ratio >= 2.0
            or (mean_delta >= 0.32 and mean_beta < 0.08)
        )
        feature.drowsy_candidate = (
            feature.drowsy_score >= 0.10
            and mean_theta >= 0.15
            and mean_delta < 0.34
            and not feature.sleep_anchor
        )
        feature.wake_candidate = (
            feature.wake_score >= 0.02
            and wake_support >= 2
            and mean_delta < 0.24
            and feature.spindle_ratio < 1.8
            and (feature.posterior_alpha_ratio >= 0.10 or mean_gradient >= 0.015 or mean_beta >= 0.08)
        )
        feature.nrem_candidate = (
            feature.nrem_score >= 0.14
            and (nrem_support >= 2 or feature.spindle_ratio >= 1.8 or feature.sleep_anchor)
            and mean_beta < 0.10
            and (mean_delta >= 0.22 or mean_theta >= 0.18 or mean_sigma >= 0.07)
        )

    sleep_runs = detect_sleep_anchor_runs(features)
    if sleep_runs:
        for run_start, run_end in sleep_runs:
            drowsy_start = max(0, run_start - 3)
            for index in range(drowsy_start, run_start):
                features[index].drowsy_candidate = True
                features[index].wake_candidate = False
            for index in range(run_start, run_end + 1):
                features[index].wake_candidate = False
    else:
        for feature in features:
            if feature.drowsy_candidate and feature.theta_ratio >= 0.20:
                feature.wake_candidate = False

    return features


def epoch_feature_vector(feature: EpochFeatures) -> np.ndarray:
    return np.array([
        feature.delta_ratio,
        feature.theta_ratio,
        feature.alpha_ratio,
        feature.sigma_ratio,
        feature.beta_ratio,
        feature.spindle_ratio,
        feature.spectral_entropy,
        feature.line_length,
        feature.hjorth_mobility,
        feature.hjorth_complexity,
    ], dtype=np.float64)


def build_ictal_reference(epochs: list[EpochFeatures], seizure_intervals: list[tuple[int, int]]) -> np.ndarray | None:
    ictal_epochs = [
        epoch_feature_vector(epoch)
        for epoch in epochs
        if any(intervals_overlap(epoch.start_sec, epoch.end_sec, start_sec, end_sec) for start_sec, end_sec in seizure_intervals)
    ]
    if not ictal_epochs:
        return None
    return np.mean(np.vstack(ictal_epochs), axis=0)


def annotate_ictal_similarity(epochs: list[EpochFeatures], ictal_reference: np.ndarray | None) -> None:
    if ictal_reference is None:
        return
    scale = np.maximum(np.abs(ictal_reference), 0.05)
    for epoch in epochs:
        vector = epoch_feature_vector(epoch)
        relative_distance = float(np.mean(np.abs(vector - ictal_reference) / scale))
        epoch.ictal_similarity = 1.0 / (1.0 + relative_distance)


def build_phase_reference(
    file_contexts: list[CuratorFileContext],
    phase: str,
    pre_seconds: int,
    post_seconds: int,
) -> np.ndarray | None:
    phase_epochs: list[np.ndarray] = []
    for context in file_contexts:
        for seizure_start, seizure_end in context.seizure_intervals:
            if phase == "preictal":
                phase_start = max(0, seizure_start - pre_seconds)
                phase_end = seizure_start
            elif phase == "ictal_core":
                phase_start = seizure_start
                phase_end = min(seizure_end, seizure_start + max(30, min(60, seizure_end - seizure_start or 30)))
            elif phase == "postictal":
                phase_start = seizure_end
                phase_end = min(context.total_seconds, seizure_end + post_seconds)
            else:
                raise ValueError(f"Fase no soportada: {phase}")
            if phase_end <= phase_start:
                continue
            phase_epochs.extend(
                epoch_feature_vector(epoch)
                for epoch in context.epochs
                if intervals_overlap(epoch.start_sec, epoch.end_sec, phase_start, phase_end)
            )
    if not phase_epochs:
        return None
    return np.mean(np.vstack(phase_epochs), axis=0)


def annotate_phase_similarities(
    epochs: list[EpochFeatures],
    preictal_reference: np.ndarray | None,
    ictal_core_reference: np.ndarray | None,
    postictal_reference: np.ndarray | None,
) -> None:
    references = {
        "preictal_similarity": preictal_reference,
        "ictal_core_similarity": ictal_core_reference,
        "postictal_similarity": postictal_reference,
    }
    scales = {
        key: (np.maximum(np.abs(reference), 0.05) if reference is not None else None)
        for key, reference in references.items()
    }
    for epoch in epochs:
        vector = epoch_feature_vector(epoch)
        for field_name, reference in references.items():
            if reference is None:
                continue
            scale = scales[field_name]
            assert scale is not None
            relative_distance = float(np.mean(np.abs(vector - reference) / scale))
            setattr(epoch, field_name, 1.0 / (1.0 + relative_distance))
        epoch.ictal_similarity = max(
            epoch.ictal_similarity,
            epoch.preictal_similarity,
            epoch.ictal_core_similarity,
            epoch.postictal_similarity,
        )


def compute_epoch_features(signal: np.ndarray | dict[str, np.ndarray], sfreq: float, epoch_seconds: int) -> list[EpochFeatures]:
    signal_bundle = coerce_signal_bundle(signal)
    primary_signal = signal_bundle["primary"]
    epoch_samples = int(epoch_seconds * sfreq)
    if epoch_samples <= 0:
        raise ValueError("epoch_seconds inválido")
    features: list[EpochFeatures] = []
    for start in range(0, primary_signal.size - epoch_samples + 1, epoch_samples):
        end = start + epoch_samples
        chunk = primary_signal[start:end]
        posterior_chunk = signal_bundle.get("posterior", primary_signal)[start:end]
        frontal_chunk = signal_bundle.get("frontal", primary_signal)[start:end]
        total = bandpower(chunk, sfreq, 0.5, 25.0) or 1e-6
        delta = bandpower(chunk, sfreq, 0.5, 4.0) / total
        theta = bandpower(chunk, sfreq, 4.0, 8.0) / total
        alpha = bandpower(chunk, sfreq, 8.0, 12.0) / total
        sigma = bandpower(chunk, sfreq, 11.0, 16.0) / total
        beta = bandpower(chunk, sfreq, 15.0, 25.0) / total
        spindle_ratio = spindle_prominence(chunk, sfreq)
        posterior_total = bandpower(posterior_chunk, sfreq, 0.5, 25.0) or 1e-6
        frontal_total = bandpower(frontal_chunk, sfreq, 0.5, 25.0) or 1e-6
        posterior_alpha = bandpower(posterior_chunk, sfreq, 8.0, 12.0) / posterior_total
        frontal_alpha = bandpower(frontal_chunk, sfreq, 8.0, 12.0) / frontal_total
        alpha_gradient = posterior_alpha - frontal_alpha
        entropy = spectral_entropy_from_chunk(chunk, sfreq)
        ll = line_length(chunk)
        hjorth_mobility, hjorth_complexity = hjorth_parameters(chunk)
        wake_score = (
            0.9 * posterior_alpha
            + 0.5 * alpha
            + 0.35 * max(alpha_gradient, 0.0)
            + 0.15 * beta
            + 0.12 * entropy
            + 0.05 * hjorth_mobility
            - (0.8 * delta + 0.2 * theta + 0.25 * sigma)
        )
        drowsy_score = (
            0.55 * theta
            + 0.35 * max(alpha, posterior_alpha)
            + 0.15 * sigma
            + 0.06 * entropy
            - 0.20 * delta
            - 0.10 * max(alpha_gradient, 0.0)
        )
        nrem_score = (
            0.8 * delta
            + 0.35 * theta
            + 0.25 * sigma
            + 0.04 * ll
            - 0.5 * alpha
            - 0.45 * beta
            - 0.10 * entropy
        )
        if spindle_ratio >= 1.6:
            nrem_score += min(0.3, 0.08 * spindle_ratio)
        sleep_anchor = spindle_ratio >= 1.8 or sigma >= 0.07 or delta >= 0.34
        features.append(EpochFeatures(
            start_sec=int(start / sfreq),
            end_sec=int(end / sfreq),
            delta_ratio=delta,
            theta_ratio=theta,
            alpha_ratio=alpha,
            sigma_ratio=sigma,
            beta_ratio=beta,
            spindle_ratio=spindle_ratio,
            posterior_alpha_ratio=posterior_alpha,
            frontal_alpha_ratio=frontal_alpha,
            alpha_gradient=alpha_gradient,
            spectral_entropy=entropy,
            line_length=ll,
            hjorth_mobility=hjorth_mobility,
            hjorth_complexity=hjorth_complexity,
            wake_score=wake_score,
            drowsy_score=drowsy_score,
            nrem_score=nrem_score,
            ictal_similarity=0.0,
            preictal_similarity=0.0,
            ictal_core_similarity=0.0,
            postictal_similarity=0.0,
            sleep_anchor=sleep_anchor,
            wake_candidate=(
                (posterior_alpha >= 0.11 or alpha_gradient >= 0.02 or beta >= 0.09)
                and delta < 0.24
                and spindle_ratio < 1.8
            ),
            drowsy_candidate=(
                theta >= 0.15
                and delta < 0.32
                and alpha >= 0.06
                and alpha_gradient < 0.03
                and spindle_ratio < 1.8
            ),
            nrem_candidate=(delta >= 0.28 and beta < 0.09 and alpha < 0.18) or sleep_anchor,
        ))
    return smooth_epoch_features(features)


def intervals_overlap(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    return max(start_a, start_b) < min(end_a, end_b)


def score_wake_window(window: list[EpochFeatures], closeness_bonus: float = 0.0) -> float:
    mean_wake = float(np.mean([epoch.wake_score for epoch in window]))
    mean_beta = float(np.mean([epoch.beta_ratio for epoch in window]))
    mean_delta = float(np.mean([epoch.delta_ratio for epoch in window]))
    mean_theta = float(np.mean([epoch.theta_ratio for epoch in window]))
    mean_posterior_alpha = float(np.mean([epoch.posterior_alpha_ratio for epoch in window]))
    mean_gradient = float(np.mean([epoch.alpha_gradient for epoch in window]))
    mean_spindle = float(np.mean([epoch.spindle_ratio for epoch in window]))

    eyes_closed = mean_posterior_alpha >= 0.10 and mean_gradient >= 0.015
    eyes_open = mean_beta >= 0.085 and mean_delta < 0.18 and mean_spindle < 1.6

    if not (eyes_closed or eyes_open):
        return float("-inf")

    return (
        mean_wake
        + 0.45 * mean_posterior_alpha
        + 0.30 * max(mean_gradient, 0.0)
        + 0.28 * mean_beta
        - 0.65 * mean_delta
        - 0.20 * mean_theta
        - 0.18 * max(mean_spindle - 1.2, 0.0)
        + closeness_bonus
    )


def detect_first_sleep_transition(epochs: list[EpochFeatures]) -> tuple[int | None, int | None]:
    sleep_runs = detect_sleep_anchor_runs(epochs)
    drowsy_runs = detect_drowsy_runs(epochs)
    if not sleep_runs:
        return None, None
    first_sleep_start = sleep_runs[0][0]
    drowsy_run = next((run for run in drowsy_runs if run[1] < first_sleep_start and run[1] >= first_sleep_start - 4), None)
    return first_sleep_start, (drowsy_run[0] if drowsy_run else None)


def select_transition_wake_candidates(
    source_file: str,
    epochs: list[EpochFeatures],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
) -> list[SegmentCandidate]:
    if not epochs:
        return []
    epoch_length = max(1, epochs[0].end_sec - epochs[0].start_sec)
    needed_epochs = max(1, math.ceil(target_seconds / epoch_length))
    first_sleep_start, drowsy_start = detect_first_sleep_transition(epochs)
    if first_sleep_start is not None:
        wake_end_limit = (drowsy_start - 1) if drowsy_start is not None else max(0, first_sleep_start - 3)
        wake_start_limit = max(0, wake_end_limit - max(12, needed_epochs * 5))
        candidate_indices = range(wake_start_limit, max(wake_start_limit, wake_end_limit - needed_epochs + 2))
    else:
        wake_end_limit = len(epochs) - 1
        candidate_indices = range(0, len(epochs) - needed_epochs + 1)

    candidates: list[SegmentCandidate] = []
    for idx in candidate_indices:
        window = epochs[idx: idx + needed_epochs]
        if len(window) < needed_epochs:
            continue
        start_sec = window[0].start_sec
        end_sec = window[-1].end_sec
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        if any(epoch.sleep_anchor or epoch.nrem_candidate for epoch in window):
            continue
        if sum(1 for epoch in window if epoch.drowsy_candidate) > 1:
            continue
        closeness_bonus = 0.0
        if first_sleep_start is not None:
            distance_epochs = max(0, wake_end_limit - (idx + needed_epochs - 1))
            closeness_bonus = max(0.0, 0.12 - 0.01 * distance_epochs)
        score = score_wake_window(window, closeness_bonus=closeness_bonus)
        if not np.isfinite(score):
            continue
        candidates.append(SegmentCandidate(
            source_file=source_file,
            start_sec=start_sec,
            end_sec=end_sec,
            score=float(score),
            kind="wake",
            epochs=window,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def score_fast_window(window: list[EpochFeatures], closeness_bonus: float = 0.0) -> float:
    mean_beta = float(np.mean([epoch.beta_ratio for epoch in window]))
    mean_alpha = float(np.mean([epoch.alpha_ratio for epoch in window]))
    mean_posterior_alpha = float(np.mean([epoch.posterior_alpha_ratio for epoch in window]))
    mean_gradient = float(np.mean([epoch.alpha_gradient for epoch in window]))
    mean_delta = float(np.mean([epoch.delta_ratio for epoch in window]))
    mean_theta = float(np.mean([epoch.theta_ratio for epoch in window]))
    mean_sigma = float(np.mean([epoch.sigma_ratio for epoch in window]))
    mean_spindle = float(np.mean([epoch.spindle_ratio for epoch in window]))
    mean_drowsy = float(np.mean([epoch.drowsy_score for epoch in window]))
    mean_wake = float(np.mean([epoch.wake_score for epoch in window]))
    mean_entropy = float(np.mean([epoch.spectral_entropy for epoch in window]))
    mean_ictal = float(np.mean([epoch.ictal_similarity for epoch in window]))
    return (
        0.40 * mean_beta
        + 0.25 * mean_alpha
        + 0.25 * mean_posterior_alpha
        + 0.20 * max(mean_gradient, 0.0)
        + 0.15 * mean_drowsy
        + 0.10 * mean_wake
        + 0.10 * mean_entropy
        - 0.45 * mean_delta
        - 0.18 * mean_theta
        - 0.10 * mean_sigma
        - 0.10 * max(mean_spindle - 1.2, 0.0)
        - 0.55 * mean_ictal
        + closeness_bonus
    )


def select_indeterminate_fast_candidates(
    source_file: str,
    epochs: list[EpochFeatures],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
) -> list[SegmentCandidate]:
    if not epochs:
        return []
    epoch_length = max(1, epochs[0].end_sec - epochs[0].start_sec)
    needed_epochs = max(1, math.ceil(target_seconds / epoch_length))
    first_sleep_start, drowsy_start = detect_first_sleep_transition(epochs)
    if first_sleep_start is not None:
        fast_end_limit = (drowsy_start - 1) if drowsy_start is not None else max(0, first_sleep_start - 1)
        fast_start_limit = max(0, fast_end_limit - max(16, needed_epochs * 6))
        candidate_indices = range(fast_start_limit, max(fast_start_limit, fast_end_limit - needed_epochs + 2))
    else:
        fast_end_limit = len(epochs) - 1
        candidate_indices = range(0, len(epochs) - needed_epochs + 1)

    candidates: list[SegmentCandidate] = []
    for idx in candidate_indices:
        window = epochs[idx: idx + needed_epochs]
        if len(window) < needed_epochs:
            continue
        start_sec = window[0].start_sec
        end_sec = window[-1].end_sec
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        if any(epoch.nrem_candidate or epoch.sleep_anchor for epoch in window):
            continue
        closeness_bonus = 0.0
        if first_sleep_start is not None:
            distance_epochs = max(0, fast_end_limit - (idx + needed_epochs - 1))
            closeness_bonus = max(0.0, 0.08 - 0.006 * distance_epochs)
        score = score_fast_window(window, closeness_bonus)
        if not np.isfinite(score):
            continue
        mean_ictal = float(np.mean([epoch.ictal_similarity for epoch in window]))
        if mean_ictal >= 0.62:
            continue
        candidates.append(SegmentCandidate(
            source_file=source_file,
            start_sec=start_sec,
            end_sec=end_sec,
            score=float(score),
            kind="indeterminate_fast",
            epochs=window,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def score_slow_window(window: list[EpochFeatures]) -> float:
    mean_delta = float(np.mean([epoch.delta_ratio for epoch in window]))
    mean_theta = float(np.mean([epoch.theta_ratio for epoch in window]))
    mean_sigma = float(np.mean([epoch.sigma_ratio for epoch in window]))
    mean_spindle = float(np.mean([epoch.spindle_ratio for epoch in window]))
    mean_beta = float(np.mean([epoch.beta_ratio for epoch in window]))
    mean_nrem = float(np.mean([epoch.nrem_score for epoch in window]))
    mean_anchor = float(np.mean([1.0 if epoch.sleep_anchor else 0.0 for epoch in window]))
    mean_entropy = float(np.mean([epoch.spectral_entropy for epoch in window]))
    mean_ictal = float(np.mean([epoch.ictal_similarity for epoch in window]))
    return (
        0.45 * mean_delta
        + 0.25 * mean_theta
        + 0.10 * mean_sigma
        + 0.08 * mean_spindle
        + 0.15 * mean_anchor
        + 0.10 * mean_nrem
        + 0.04 * mean_entropy
        - 0.12 * mean_beta
        - 0.35 * mean_ictal
    )


def score_phase_like_window(window: list[EpochFeatures], kind: str) -> float:
    if kind == "preictal_like":
        dominant = float(np.mean([epoch.preictal_similarity for epoch in window]))
        alternate = float(np.mean([epoch.postictal_similarity for epoch in window]))
        background = float(np.mean([epoch.ictal_core_similarity for epoch in window]))
        beta = float(np.mean([epoch.beta_ratio for epoch in window]))
        entropy = float(np.mean([epoch.spectral_entropy for epoch in window]))
        return 1.8 * dominant + 0.06 * beta + 0.04 * entropy - 0.25 * alternate - 0.45 * background
    if kind == "ictal_core_like":
        dominant = float(np.mean([epoch.ictal_core_similarity for epoch in window]))
        alternate = float(np.mean([max(epoch.preictal_similarity, epoch.postictal_similarity) for epoch in window]))
        entropy = float(np.mean([epoch.spectral_entropy for epoch in window]))
        return 2.2 * dominant - 0.60 * alternate - 0.10 * entropy
    if kind == "postictal_like":
        dominant = float(np.mean([epoch.postictal_similarity for epoch in window]))
        alternate = float(np.mean([epoch.preictal_similarity for epoch in window]))
        delta = float(np.mean([epoch.delta_ratio for epoch in window]))
        entropy = float(np.mean([epoch.spectral_entropy for epoch in window]))
        return 1.9 * dominant + 0.10 * delta - 0.08 * entropy - 0.25 * alternate
    raise ValueError(f"Kind no soportado: {kind}")


def select_phase_like_candidates(
    source_file: str,
    epochs: list[EpochFeatures],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
    kind: str,
) -> list[SegmentCandidate]:
    if not epochs:
        return []
    epoch_length = max(1, epochs[0].end_sec - epochs[0].start_sec)
    if kind == "ictal_core_like":
        target_seconds = min(target_seconds, max(epoch_length * 2, 60))
    needed_epochs = max(1, math.ceil(target_seconds / epoch_length))
    candidates: list[SegmentCandidate] = []
    for idx in range(0, len(epochs) - needed_epochs + 1):
        window = epochs[idx: idx + needed_epochs]
        start_sec = window[0].start_sec
        end_sec = window[-1].end_sec
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        score = score_phase_like_window(window, kind)
        if not np.isfinite(score):
            continue
        if kind == "preictal_like":
            dominant = float(np.mean([epoch.preictal_similarity for epoch in window]))
            competing = max(
                float(np.mean([epoch.ictal_core_similarity for epoch in window])),
                float(np.mean([epoch.postictal_similarity for epoch in window])),
            )
        elif kind == "ictal_core_like":
            dominant = float(np.mean([epoch.ictal_core_similarity for epoch in window]))
            competing = max(
                float(np.mean([epoch.preictal_similarity for epoch in window])),
                float(np.mean([epoch.postictal_similarity for epoch in window])),
            )
        else:
            dominant = float(np.mean([epoch.postictal_similarity for epoch in window]))
            competing = max(
                float(np.mean([epoch.preictal_similarity for epoch in window])),
                float(np.mean([epoch.ictal_core_similarity for epoch in window])),
            )
        if dominant < 0.18:
            continue
        if dominant < competing + 0.02:
            continue
        candidates.append(SegmentCandidate(
            source_file=source_file,
            start_sec=start_sec,
            end_sec=end_sec,
            score=float(score),
            kind=kind,
            epochs=window,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def select_indeterminate_slow_candidates(
    source_file: str,
    epochs: list[EpochFeatures],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
) -> list[SegmentCandidate]:
    if not epochs:
        return []
    epoch_length = max(1, epochs[0].end_sec - epochs[0].start_sec)
    needed_epochs = max(1, math.ceil(target_seconds / epoch_length))
    candidates: list[SegmentCandidate] = []
    for idx in range(0, len(epochs) - needed_epochs + 1):
        window = epochs[idx: idx + needed_epochs]
        start_sec = window[0].start_sec
        end_sec = window[-1].end_sec
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        if any(epoch.nrem_candidate for epoch in window):
            continue
        slow_votes = sum(1 for epoch in window if epoch.drowsy_candidate or epoch.delta_ratio >= 0.24 or epoch.theta_ratio >= 0.18)
        if slow_votes < max(2, needed_epochs // 2):
            continue
        score = score_slow_window(window)
        mean_ictal = float(np.mean([epoch.ictal_similarity for epoch in window]))
        if mean_ictal >= 0.72:
            continue
        candidates.append(SegmentCandidate(
            source_file=source_file,
            start_sec=start_sec,
            end_sec=end_sec,
            score=float(score),
            kind="indeterminate_slow",
            epochs=window,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def select_state_candidates(
    source_file: str,
    epochs: list[EpochFeatures],
    blocked_intervals: list[tuple[int, int]],
    target_seconds: int,
    kind: str,
) -> list[SegmentCandidate]:
    if kind == "wake":
        return select_transition_wake_candidates(
            source_file=source_file,
            epochs=epochs,
            blocked_intervals=blocked_intervals,
            target_seconds=target_seconds,
        )
    if kind == "indeterminate_fast":
        return select_indeterminate_fast_candidates(
            source_file=source_file,
            epochs=epochs,
            blocked_intervals=blocked_intervals,
            target_seconds=target_seconds,
        )
    if kind == "indeterminate_slow":
        return select_indeterminate_slow_candidates(
            source_file=source_file,
            epochs=epochs,
            blocked_intervals=blocked_intervals,
            target_seconds=target_seconds,
        )
    if kind in {"preictal_like", "ictal_core_like", "postictal_like"}:
        return select_phase_like_candidates(
            source_file=source_file,
            epochs=epochs,
            blocked_intervals=blocked_intervals,
            target_seconds=target_seconds,
            kind=kind,
        )
    needed_epochs = max(1, math.ceil(target_seconds / max(1, epochs[0].end_sec - epochs[0].start_sec))) if epochs else 1
    candidates: list[SegmentCandidate] = []
    for idx in range(0, len(epochs) - needed_epochs + 1):
        window = epochs[idx: idx + needed_epochs]
        start_sec = window[0].start_sec
        end_sec = window[-1].end_sec
        if any(intervals_overlap(start_sec, end_sec, block_start, block_end) for block_start, block_end in blocked_intervals):
            continue
        if kind == "wake":
            if not all(epoch.wake_candidate for epoch in window):
                continue
            score = float(np.mean([epoch.wake_score for epoch in window]))
        else:
            if not all(epoch.nrem_candidate for epoch in window):
                continue
            score = float(np.mean([epoch.nrem_score for epoch in window]))
            score -= 0.25 * float(np.mean([epoch.ictal_similarity for epoch in window]))
        candidates.append(SegmentCandidate(
            source_file=source_file,
            start_sec=start_sec,
            end_sec=end_sec,
            score=score,
            kind=kind,
            epochs=window,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def safe_label(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", text)


def clamp_edf_numeric(value: float) -> float:
    magnitude = max(abs(value), 1.0)
    if magnitude >= 10_000:
        return float(int(value))
    if magnitude >= 1_000:
        return round(value, 1)
    if magnitude >= 100:
        return round(value, 3)
    if magnitude >= 10:
        return round(value, 4)
    return round(value, 5)


def make_signal_header(label: str, signal: np.ndarray, sample_frequency: float, prefilter: str, transducer: str) -> dict:
    physical_min = float(np.min(signal))
    physical_max = float(np.max(signal))
    if math.isclose(physical_min, physical_max):
        physical_min -= 1.0
        physical_max += 1.0
    return {
        "label": label[:16],
        "dimension": "uV",
        "sample_frequency": sample_frequency,
        "physical_min": clamp_edf_numeric(physical_min),
        "physical_max": clamp_edf_numeric(physical_max),
        "digital_min": -32768,
        "digital_max": 32767,
        "transducer": transducer[:80],
        "prefilter": prefilter[:80],
    }


def write_fragment_edf(source_path: Path, output_path: Path, start_sec: int, end_sec: int, note: str) -> None:
    with pyedflib.EdfReader(str(source_path)) as reader:
        labels = reader.getSignalLabels()
        sample_rates = [float(reader.getSampleFrequency(index)) for index in range(len(labels))]
        sample_rate = sample_rates[0]
        start_sample = int(start_sec * sample_rate)
        sample_count = int((end_sec - start_sec) * sample_rate)

        signals_to_write: list[np.ndarray] = []
        signal_headers: list[dict] = []
        for index, label in enumerate(labels):
            signal = reader.readSignal(index, start=start_sample, n=sample_count).astype(np.float64)
            signals_to_write.append(signal)
            signal_headers.append(
                make_signal_header(
                    label=label,
                    signal=signal,
                    sample_frequency=sample_rates[index],
                    prefilter=note,
                    transducer="OCEAN CHB-MIT curator",
                )
            )

        header = {
            "technician": "",
            "recording_additional": note,
            "patientname": "anonymous",
            "patient_additional": "",
            "patientcode": "",
            "equipment": "OCEAN CHB-MIT curator",
            "admincode": "",
            "sex": "",
            "startdate": reader.getStartdatetime(),
            "birthdate": "",
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = pyedflib.EdfWriter(str(output_path), len(signal_headers), file_type=pyedflib.FILETYPE_EDFPLUS)
    try:
        writer.setHeader(header)
        writer.setSignalHeaders(signal_headers)
        writer.writeSamples(signals_to_write)
    finally:
        writer.close()


def build_manifest(
    case_code: str,
    gallery_metadata: dict[str, object],
    seizures: list[dict[str, object]],
    nrem_segments: list[dict[str, object]],
    fast_segments: list[dict[str, object]],
    slow_segments: list[dict[str, object]],
    preictal_like_segments: list[dict[str, object]] | None = None,
    ictal_core_like_segments: list[dict[str, object]] | None = None,
    postictal_like_segments: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "caseCode": case_code,
        "sourceDataset": "CHB-MIT Scalp EEG Database",
        "galleryMetadata": gallery_metadata,
        "segments": {
            "seizures": seizures,
            "nremClear": nrem_segments,
            "indeterminateFast": fast_segments,
            "indeterminateSlow": slow_segments,
            "preictalLike": preictal_like_segments or [],
            "ictalCoreLike": ictal_core_like_segments or [],
            "postictalLike": postictal_like_segments or [],
        },
    }


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    edf_files = sorted(input_dir.glob("chb*_reconstructed.edf"))
    if not edf_files:
        raise SystemExit("No se encontraron EDFs reconstruidos en input-dir")

    case_code = infer_case_code([path.name for path in edf_files])
    summary_url = args.summary_url or f"{DEFAULT_SUMMARY_BASE_URL}{case_code}/{case_code}-summary.txt"
    subject_url = args.subject_info_url or f"{DEFAULT_SUMMARY_BASE_URL}SUBJECT-INFO"
    summary_text = read_text(Path(args.summary_file).expanduser() if args.summary_file else None, summary_url)
    subject_text = read_text(Path(args.subject_info_file).expanduser() if args.subject_info_file else None, subject_url)

    summary_map, summary_metadata = parse_summary(summary_text)
    subject_metadata = parse_subject_info(subject_text, case_code)

    gallery_metadata = {
        "caseCode": case_code,
        "recordImportedCount": len(edf_files),
        "recordExpectedCount": summary_metadata.get("recordExpectedCount"),
        "samplingRateHz": summary_metadata.get("samplingRateHz"),
        "channelCount": summary_metadata.get("channelCount"),
        "montage": summary_metadata.get("montage"),
        "subject": subject_metadata,
    }

    case_output = output_dir / case_code
    seizures_dir = case_output / "seizures"
    fast_dir = case_output / "indeterminate_fast"
    slow_dir = case_output / "indeterminate_slow"
    nrem_dir = case_output / "nrem_clear"
    preictal_like_dir = case_output / "preictal_like"
    ictal_core_like_dir = case_output / "ictal_core_like"
    postictal_like_dir = case_output / "postictal_like"
    seizures_dir.mkdir(parents=True, exist_ok=True)
    fast_dir.mkdir(parents=True, exist_ok=True)
    slow_dir.mkdir(parents=True, exist_ok=True)
    nrem_dir.mkdir(parents=True, exist_ok=True)
    preictal_like_dir.mkdir(parents=True, exist_ok=True)
    ictal_core_like_dir.mkdir(parents=True, exist_ok=True)
    postictal_like_dir.mkdir(parents=True, exist_ok=True)

    seizure_manifest: list[dict[str, object]] = []
    fast_candidates: list[SegmentCandidate] = []
    slow_candidates: list[SegmentCandidate] = []
    nrem_candidates: list[SegmentCandidate] = []
    preictal_like_candidates: list[SegmentCandidate] = []
    ictal_core_like_candidates: list[SegmentCandidate] = []
    postictal_like_candidates: list[SegmentCandidate] = []
    file_contexts: list[CuratorFileContext] = []

    for source_path in edf_files:
        original_filename = source_path.name.replace("_reconstructed", "")
        summary = summary_map.get(original_filename)
        if not summary:
            continue

        with pyedflib.EdfReader(str(source_path)) as reader:
            signal_bundle, sfreq, _channel_name = read_signal_bundle(reader)
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
                write_fragment_edf(
                    source_path,
                    output_path,
                    start_sec,
                    end_sec,
                    note="curated seizure fragment (-3min/+3min)",
                )
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

        fast_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="indeterminate_fast",
            )
        )
        slow_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="indeterminate_slow",
            )
        )
        nrem_candidates.extend(
            select_state_candidates(
                source_file=context.source_path.name,
                epochs=context.epochs,
                blocked_intervals=context.blocked_intervals,
                target_seconds=args.state_seconds,
                kind="nrem",
            )
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

    def materialize_state_segments(
        kind: str,
        candidates: list[SegmentCandidate],
        limit: int,
        target_dir: Path,
    ) -> list[dict[str, object]]:
        manifest_items: list[dict[str, object]] = []
        selected: list[tuple[str, int, int]] = []
        for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
            if len(manifest_items) >= limit:
                break
            if any(
                previous_file == candidate.source_file and intervals_overlap(candidate.start_sec, candidate.end_sec, previous_start, previous_end)
                for previous_file, previous_start, previous_end in selected
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
                    note=f"curated {kind} fragment (heuristic high-confidence)",
                )
            selected.append((candidate.source_file, candidate.start_sec, candidate.end_sec))
            manifest_items.append({
                "type": kind,
                "file": str(output_path.relative_to(case_output)),
                "sourceFile": candidate.source_file,
                "segmentStartSec": candidate.start_sec,
                "segmentEndSec": candidate.end_sec,
                "durationSeconds": candidate.end_sec - candidate.start_sec,
                "selectionMethod": "spectral-heuristic-high-confidence",
                "score": round(candidate.score, 4),
                "epochCount": len(candidate.epochs),
                "ictalSimilarity": round(float(np.mean([epoch.ictal_similarity for epoch in candidate.epochs])), 4),
                "preictalSimilarity": round(float(np.mean([epoch.preictal_similarity for epoch in candidate.epochs])), 4),
                "ictalCoreSimilarity": round(float(np.mean([epoch.ictal_core_similarity for epoch in candidate.epochs])), 4),
                "postictalSimilarity": round(float(np.mean([epoch.postictal_similarity for epoch in candidate.epochs])), 4),
            })
        return manifest_items

    fast_manifest = materialize_state_segments("indeterminate_fast", fast_candidates, args.max_fast, fast_dir)
    slow_manifest = materialize_state_segments("indeterminate_slow", slow_candidates, args.max_slow, slow_dir)
    nrem_manifest = materialize_state_segments("nrem_clear", nrem_candidates, args.max_nrem, nrem_dir)
    preictal_like_manifest = materialize_state_segments("preictal_like", preictal_like_candidates, args.max_preictal_like, preictal_like_dir)
    ictal_core_like_manifest = materialize_state_segments("ictal_core_like", ictal_core_like_candidates, args.max_ictal_core_like, ictal_core_like_dir)
    postictal_like_manifest = materialize_state_segments("postictal_like", postictal_like_candidates, args.max_postictal_like, postictal_like_dir)

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
    manifest_path = case_output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({
        "caseCode": case_code,
        "inputFiles": len(edf_files),
        "seizureFragments": len(seizure_manifest),
        "fastFragments": len(fast_manifest),
        "slowFragments": len(slow_manifest),
        "nremFragments": len(nrem_manifest),
        "preictalLikeFragments": len(preictal_like_manifest),
        "ictalCoreLikeFragments": len(ictal_core_like_manifest),
        "postictalLikeFragments": len(postictal_like_manifest),
        "outputDir": str(case_output),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
