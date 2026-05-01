#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a flat gallery source directory from CHB-MIT teaching summaries.",
    )
    parser.add_argument("--input-root", required=True, help="Root directory with chbNN teaching summaries")
    parser.add_argument("--output-dir", required=True, help="Flat directory to populate with EDF links and gallery metadata")
    parser.add_argument("--overwrite", action="store_true", help="Recreate the output directory if it already exists")
    return parser.parse_args()


def ensure_clean_directory(path: Path, overwrite: bool) -> None:
    if path.exists():
        if not overwrite:
            raise SystemExit(f"El directorio destino ya existe: {path}. Usa --overwrite para recrearlo.")
        for child in path.iterdir():
            if child.is_dir() and not child.is_symlink():
                for nested in child.rglob("*"):
                    if nested.is_file() or nested.is_symlink():
                        nested.unlink()
                for nested in sorted(child.rglob("*"), reverse=True):
                    if nested.is_dir():
                        nested.rmdir()
                child.rmdir()
            else:
                child.unlink()
    path.mkdir(parents=True, exist_ok=True)


def collect_cases(input_root: Path) -> list[Path]:
    case_dirs = []
    for child in sorted(input_root.iterdir()):
        if not child.is_dir() or not child.name.lower().startswith("chb"):
            continue
        if (child / f"{child.name.lower()}_teaching_summary.edf").exists() and (child / f"{child.name.lower()}_teaching_summary_index.json").exists():
            case_dirs.append(child)
    if not case_dirs:
        raise SystemExit("No se encontraron teaching summaries en input-root")
    return case_dirs


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_record_entry(case_code: str, index_payload: dict[str, object], edf_name: str) -> dict[str, object]:
    gallery_metadata = index_payload.get("galleryMetadata", {}) or {}
    segments = index_payload.get("segments", []) or []
    segment_types = [segment.get("segmentType") for segment in segments if isinstance(segment, dict)]
    seizure_count = sum(1 for segment_type in segment_types if str(segment_type).startswith("seizure_"))
    duration_seconds = 0.0
    if segments and isinstance(segments[-1], dict):
        duration_seconds = float(segments[-1].get("summaryEndSec", 0) or 0)

    tags = ["teaching-summary", "chb-mit", case_code]
    if any(str(segment_type).startswith("seizure_") for segment_type in segment_types):
        tags.append("seizure")
    if any(str(segment_type) in {"preictal_like", "ictal_core_like", "postictal_like"} for segment_type in segment_types):
        tags.append("ictal-like")
    if any(str(segment_type) == "nrem_clear" for segment_type in segment_types):
        tags.append("sleep")

    return {
        "label": f"{case_code.upper()} - Teaching Summary",
        "tags": tags,
        "metadata": {
            "schemaVersion": 1,
            "originalFilename": edf_name,
            "sourceDataset": gallery_metadata.get("sourceDataset", "CHB-MIT Scalp EEG Database"),
            "sourceCaseCode": case_code,
            "durationSeconds": round(duration_seconds, 3),
            "seizureCount": seizure_count,
            "samplingRateHz": gallery_metadata.get("samplingRateHz"),
            "channelCount": gallery_metadata.get("channelCount"),
            "montage": gallery_metadata.get("montage"),
            "subject": gallery_metadata.get("subject"),
            "teachingSummaryVersion": index_payload.get("summaryVersion"),
            "teachingSegmentCount": index_payload.get("segmentCount"),
            "teachingSegmentTypes": segment_types,
            "teachingSegments": segments,
            "notes": "Resumen docente generado automáticamente desde la salida V3 de CHB-MIT.",
        },
    }


def main() -> int:
    args = parse_args()
    input_root = Path(args.input_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not input_root.exists():
        raise SystemExit(f"input-root no existe: {input_root}")

    ensure_clean_directory(output_dir, overwrite=args.overwrite)
    case_dirs = collect_cases(input_root)

    records: dict[str, dict[str, object]] = {}
    ages: list[float] = []
    sexes: set[str] = set()

    for case_dir in case_dirs:
        case_code = case_dir.name.lower()
        edf_path = case_dir / f"{case_code}_teaching_summary.edf"
        index_path = case_dir / f"{case_code}_teaching_summary_index.json"
        index_payload = read_json(index_path)

        target_edf = output_dir / edf_path.name
        if target_edf.exists() or target_edf.is_symlink():
            target_edf.unlink()
        os.symlink(edf_path, target_edf)

        gallery_metadata = index_payload.get("galleryMetadata", {}) or {}
        subject = gallery_metadata.get("subject", {}) or {}
        age = subject.get("ageYears")
        sex = subject.get("sex")
        if isinstance(age, (int, float)):
            ages.append(float(age))
        if isinstance(sex, str) and sex:
            sexes.add(sex)

        records[edf_path.name] = build_record_entry(case_code, index_payload, edf_path.name)

    metadata = {
        "title": "CHB-MIT Teaching Summaries V1",
        "description": (
            "Galería plana con un teaching summary EDF por sujeto de CHB-MIT, "
            "generado automáticamente desde la salida V3 (sueño útil, transiciones lentas, "
            "candidatos ictales intra-sujeto y crisis anotadas cuando existen)."
        ),
        "source": "CHB-MIT Scalp EEG Database / PhysioNet",
        "license": "PhysioNet Credentialed Health Data License 1.5.0",
        "visibility": "Institutional",
        "tags": ["eeg", "docencia", "chb-mit", "teaching-summary", "epilepsia", "sleep"],
        "metadata": {
            "schemaVersion": 1,
            "datasetId": "chbmit-teaching-summary",
            "datasetVersion": "v1",
            "datasetUrl": "https://physionet.org/content/chbmit/1.0.0/",
            "sourceDataset": "CHB-MIT Scalp EEG Database",
            "completeness": "complete",
            "recordImportedCount": len(case_dirs),
            "recordExpectedCount": len(case_dirs),
            "samplingRateHz": 256,
            "montage": "bipolar 10-20",
            "notes": (
                "Cada registro es un EDF resumen docente por sujeto, derivado de la salida V3. "
                "No sustituye al registro original completo."
            ),
            "summaryType": "teaching-v1",
            "caseCodes": [case_dir.name.lower() for case_dir in case_dirs],
            "subjectAgeRangeYears": {
                "min": min(ages) if ages else None,
                "max": max(ages) if ages else None,
            },
            "sexes": sorted(sexes),
        },
        "records": records,
    }

    (output_dir / "gallery-metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(json.dumps({
        "outputDir": str(output_dir),
        "edfCount": len(case_dirs),
        "metadataFile": str(output_dir / "gallery-metadata.json"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
