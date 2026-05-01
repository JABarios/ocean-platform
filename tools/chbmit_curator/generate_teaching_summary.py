#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import pyedflib

from curate_chbmit_fragments import clamp_edf_numeric, make_signal_header


SUMMARY_VERSION = "teaching-v1"

SEGMENT_SPECS = [
    ("nremClear", "nrem_clear", 1, "high"),
    ("indeterminateSlow", "indeterminate_slow", 1, "medium"),
    ("indeterminateFast", "indeterminate_fast", 1, "medium"),
    ("preictalLike", "preictal_like", 1, "high"),
    ("ictalCoreLike", "ictal_core_like", 1, "high"),
    ("postictalLike", "postictal_like", 1, "high"),
]


@dataclass
class SelectedSegment:
    order: int
    segment_type: str
    file_path: Path
    manifest_entry: dict[str, object]
    teaching_note: str
    clinical_priority: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate EDF teaching summaries from CHB-MIT V3 outputs.",
    )
    parser.add_argument(
        "--input-root",
        required=True,
        help="Root directory with V3 case folders (e.g. /Volumes/DATOS/mit-curated-v3)",
    )
    parser.add_argument(
        "--output-root",
        help="Directory where teaching summaries will be written. Defaults to input-root.",
    )
    parser.add_argument(
        "--case",
        action="append",
        dest="cases",
        help="Restrict generation to one or more cases (repeatable).",
    )
    parser.add_argument(
        "--max-seizures",
        type=int,
        default=2,
        help="Maximum number of annotated seizures to include in each teaching summary.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing teaching summary outputs.",
    )
    return parser.parse_args()


def discover_cases(input_root: Path, requested_cases: list[str] | None) -> list[str]:
    available = sorted(
        path.name.lower()
        for path in input_root.iterdir()
        if path.is_dir() and path.name.lower().startswith("chb")
    )
    if requested_cases:
        requested = [case.lower() for case in requested_cases]
        missing = [case for case in requested if case not in available]
        if missing:
            raise SystemExit(f"No se encontraron estos casos en input-root: {', '.join(missing)}")
        return [case for case in available if case in requested]
    if not available:
        raise SystemExit("No se encontraron carpetas chbNN en input-root")
    return available


def teaching_note_for(segment_type: str) -> str:
    notes = {
        "nrem_clear": "Bloque de sueño relativamente limpio y útil para referencia de fondo.",
        "indeterminate_slow": "Bloque lento o somnoliento útil como transición, sin afirmar sueño bien tipado.",
        "indeterminate_fast": "Bloque relativamente rápido o ligero, útil como contraste, sin afirmar vigilia limpia.",
        "preictal_like": "Fragmento no anotado parecido al patrón previo de crisis del propio sujeto.",
        "ictal_core_like": "Fragmento no anotado parecido al núcleo ictal de las crisis del propio sujeto.",
        "postictal_like": "Fragmento no anotado parecido a la recuperación o lentificación posterior a crisis.",
        "seizure": "Crisis anotada en el summary, conservada con ventana de contexto.",
    }
    return notes[segment_type]


def load_manifest(case_dir: Path) -> dict[str, object]:
    manifest_path = case_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"Falta manifest.json en {case_dir}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def select_segments(case_dir: Path, manifest: dict[str, object], max_seizures: int) -> list[SelectedSegment]:
    segments = manifest.get("segments", {})
    if not isinstance(segments, dict):
        raise SystemExit(f"Manifest inválido en {case_dir}: 'segments' no es un objeto")

    selected: list[SelectedSegment] = []
    order = 1

    for manifest_key, segment_type, limit, clinical_priority in SEGMENT_SPECS:
        entries = segments.get(manifest_key, [])
        if not isinstance(entries, list):
            continue
        for entry in entries[:limit]:
            relative_file = entry.get("file")
            if not isinstance(relative_file, str):
                continue
            file_path = case_dir / relative_file
            if not file_path.exists():
                raise SystemExit(f"Falta el fragmento esperado: {file_path}")
            selected.append(
                SelectedSegment(
                    order=order,
                    segment_type=segment_type,
                    file_path=file_path,
                    manifest_entry=entry,
                    teaching_note=teaching_note_for(segment_type),
                    clinical_priority=clinical_priority,
                )
            )
            order += 1

    seizure_entries = segments.get("seizures", [])
    if isinstance(seizure_entries, list):
        for idx, entry in enumerate(seizure_entries[: max(0, max_seizures)], start=1):
            relative_file = entry.get("file")
            if not isinstance(relative_file, str):
                continue
            file_path = case_dir / relative_file
            if not file_path.exists():
                raise SystemExit(f"Falta el fragmento esperado: {file_path}")
            selected.append(
                SelectedSegment(
                    order=order,
                    segment_type=f"seizure_{idx:02d}",
                    file_path=file_path,
                    manifest_entry=entry,
                    teaching_note=teaching_note_for("seizure"),
                    clinical_priority="high",
                )
            )
            order += 1

    if not selected:
        raise SystemExit(f"No se pudieron seleccionar segmentos para {case_dir.name}")
    return selected


def read_fragment(path: Path) -> tuple[list[str], list[float], list[np.ndarray], dict[str, object]]:
    with pyedflib.EdfReader(str(path)) as reader:
        labels = reader.getSignalLabels()
        sample_rates = [float(reader.getSampleFrequency(index)) for index in range(len(labels))]
        signals = [reader.readSignal(index).astype(np.float64) for index in range(len(labels))]
        signal_headers = [reader.getSignalHeader(index) for index in range(len(labels))]
        header = reader.getHeader()
    return labels, sample_rates, signals, {"signalHeaders": signal_headers, "header": header}


def resolve_common_channels(selected: list[SelectedSegment]) -> list[str]:
    common_labels: list[str] | None = None
    for selected_segment in selected:
        with pyedflib.EdfReader(str(selected_segment.file_path)) as reader:
            labels = reader.getSignalLabels()
        if common_labels is None:
            common_labels = labels
        else:
            label_set = set(labels)
            common_labels = [label for label in common_labels if label in label_set]
    if not common_labels:
        raise SystemExit("No hay canales comunes entre los fragmentos seleccionados")
    return common_labels


def concatenate_segments(
    selected: list[SelectedSegment],
    common_labels: list[str],
) -> tuple[list[dict[str, object]], list[np.ndarray], list[dict[str, object]], dict[str, object]]:
    summary_segments: list[dict[str, object]] = []
    concatenated_signals: list[np.ndarray] | None = None
    output_signal_headers: list[dict[str, object]] | None = None
    case_header: dict[str, object] | None = None
    reference_rates: list[float] | None = None
    current_time_sec = 0.0

    for selected_segment in selected:
        labels, sample_rates, signals, metadata = read_fragment(selected_segment.file_path)
        label_to_index = {label: idx for idx, label in enumerate(labels)}
        missing_labels = [label for label in common_labels if label not in label_to_index]
        if missing_labels:
            raise SystemExit(
                f"Faltan canales comunes en {selected_segment.file_path}: {', '.join(missing_labels)}"
            )
        aligned_indices = [label_to_index[label] for label in common_labels]
        aligned_rates = [sample_rates[idx] for idx in aligned_indices]
        aligned_signals = [signals[idx] for idx in aligned_indices]

        if reference_rates is None:
            reference_rates = aligned_rates
            concatenated_signals = [signal.copy() for signal in aligned_signals]
            case_header = metadata["header"]
            output_signal_headers = []
            for idx, label in enumerate(common_labels):
                signal_header = metadata["signalHeaders"][aligned_indices[idx]]
                output_signal_headers.append(
                    make_signal_header(
                        label=label,
                        signal=aligned_signals[idx],
                        sample_frequency=aligned_rates[idx],
                        prefilter=str(signal_header.get("prefilter", ""))[:80],
                        transducer=str(signal_header.get("transducer", ""))[:80],
                    )
                )
        else:
            if any(abs(left - right) > 1e-6 for left, right in zip(aligned_rates, reference_rates or [])):
                raise SystemExit(f"Frecuencias de muestreo incompatibles en {selected_segment.file_path}")
            assert concatenated_signals is not None
            for idx, signal in enumerate(aligned_signals):
                concatenated_signals[idx] = np.concatenate([concatenated_signals[idx], signal])
                assert output_signal_headers is not None
                output_signal_headers[idx]["physical_min"] = clamp_edf_numeric(
                    min(float(output_signal_headers[idx]["physical_min"]), float(np.min(concatenated_signals[idx])))
                )
                output_signal_headers[idx]["physical_max"] = clamp_edf_numeric(
                    max(float(output_signal_headers[idx]["physical_max"]), float(np.max(concatenated_signals[idx])))
                )

        duration_seconds = float(selected_segment.manifest_entry.get("durationSeconds", 0))
        if duration_seconds <= 0:
            duration_seconds = float(signals[0].size / sample_rates[0])

        summary_segments.append({
            "order": selected_segment.order,
            "segmentType": selected_segment.segment_type,
            "summaryStartSec": round(current_time_sec, 3),
            "summaryEndSec": round(current_time_sec + duration_seconds, 3),
            "sourceFile": selected_segment.manifest_entry.get("sourceFile"),
            "sourceOriginalFilename": selected_segment.manifest_entry.get("sourceOriginalFilename"),
            "sourceStartSec": selected_segment.manifest_entry.get("segmentStartSec"),
            "sourceEndSec": selected_segment.manifest_entry.get("segmentEndSec"),
            "durationSeconds": round(duration_seconds, 3),
            "selectionMethod": selected_segment.manifest_entry.get("selectionMethod"),
            "score": selected_segment.manifest_entry.get("score"),
            "teachingNote": selected_segment.teaching_note,
            "clinicalPriority": selected_segment.clinical_priority,
        })
        current_time_sec += duration_seconds

    assert concatenated_signals is not None
    assert output_signal_headers is not None
    assert case_header is not None
    return summary_segments, concatenated_signals, output_signal_headers, case_header


def write_summary_edf(
    output_path: Path,
    concatenated_signals: list[np.ndarray],
    signal_headers: list[dict[str, object]],
    case_code: str,
    summary_segments: list[dict[str, object]],
    overwrite: bool,
) -> None:
    if output_path.exists() and not overwrite:
        raise SystemExit(f"Ya existe {output_path}; usa --overwrite para reemplazarlo")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = pyedflib.EdfWriter(str(output_path), len(signal_headers), file_type=pyedflib.FILETYPE_EDFPLUS)
    try:
        writer.setHeader({
            "technician": "",
            "recording_additional": "OCEAN teaching summary",
            "patientname": case_code,
            "patient_additional": "",
            "patientcode": "",
            "equipment": "OCEAN summary",
            "admincode": "",
            "sex": "",
            "startdate": datetime.now(),
            "birthdate": "",
        })
        writer.setSignalHeaders(signal_headers)
        writer.writeSamples(concatenated_signals)
        for segment in summary_segments:
            description = f"{segment['segmentType']} | {segment.get('sourceFile', '')}"
            try:
                writer.writeAnnotation(
                    float(segment["summaryStartSec"]),
                    float(segment["durationSeconds"]),
                    description[:80],
                )
            except Exception:
                pass
    finally:
        writer.close()


def write_summary_index(
    output_path: Path,
    case_code: str,
    source_manifest_path: Path,
    manifest: dict[str, object],
    summary_segments: list[dict[str, object]],
    overwrite: bool,
) -> None:
    if output_path.exists() and not overwrite:
        raise SystemExit(f"Ya existe {output_path}; usa --overwrite para reemplazarlo")

    index_payload = {
        "caseCode": case_code,
        "summaryVersion": SUMMARY_VERSION,
        "sourceCuratorVersion": manifest.get("curatorVersion"),
        "sourceManifest": str(source_manifest_path.name),
        "segmentCount": len(summary_segments),
        "galleryMetadata": manifest.get("galleryMetadata", {}),
        "segments": summary_segments,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2), encoding="utf-8")


def generate_case(case_dir: Path, output_root: Path, max_seizures: int, overwrite: bool) -> dict[str, object]:
    manifest = load_manifest(case_dir)
    case_code = str(manifest.get("caseCode") or case_dir.name)
    selected = select_segments(case_dir, manifest, max_seizures=max_seizures)
    common_labels = resolve_common_channels(selected)
    summary_segments, concatenated_signals, signal_headers, _case_header = concatenate_segments(
        selected,
        common_labels=common_labels,
    )

    case_output_dir = output_root / case_code
    summary_edf_path = case_output_dir / f"{case_code}_teaching_summary.edf"
    summary_index_path = case_output_dir / f"{case_code}_teaching_summary_index.json"

    write_summary_edf(
        summary_edf_path,
        concatenated_signals,
        signal_headers,
        case_code=case_code,
        summary_segments=summary_segments,
        overwrite=overwrite,
    )
    write_summary_index(
        summary_index_path,
        case_code=case_code,
        source_manifest_path=case_dir / "manifest.json",
        manifest=manifest,
        summary_segments=summary_segments,
        overwrite=overwrite,
    )

    return {
        "caseCode": case_code,
        "summaryVersion": SUMMARY_VERSION,
        "segmentCount": len(summary_segments),
        "outputEdf": str(summary_edf_path),
        "outputIndex": str(summary_index_path),
    }


def main() -> int:
    args = parse_args()
    input_root = Path(args.input_root).expanduser().resolve()
    output_root = Path(args.output_root).expanduser().resolve() if args.output_root else input_root
    if not input_root.exists():
        raise SystemExit(f"input-root no existe: {input_root}")

    cases = discover_cases(input_root, args.cases)
    results: list[dict[str, object]] = []
    for case_code in cases:
        case_dir = input_root / case_code
        results.append(
            generate_case(
                case_dir=case_dir,
                output_root=output_root,
                max_seizures=args.max_seizures,
                overwrite=args.overwrite,
            )
        )

    print(json.dumps({
        "summaryVersion": SUMMARY_VERSION,
        "caseCount": len(results),
        "cases": results,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
