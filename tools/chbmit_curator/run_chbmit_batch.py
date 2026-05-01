#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run CHB-MIT reconstruction and curation for all chbNN cases in a local dataset tree.",
    )
    parser.add_argument(
        "--dataset-root",
        required=True,
        help="Root directory containing CHB-MIT case folders (e.g. /Volumes/DATOS/chb-mit)",
    )
    parser.add_argument(
        "--reconstructed-root",
        required=True,
        help="Base directory where *_reconstructed.edf outputs will be written per case",
    )
    parser.add_argument(
        "--curated-root",
        required=True,
        help="Base directory where curated fragments will be written per case",
    )
    parser.add_argument(
        "--version",
        choices=["v1", "v2", "v3"],
        default="v2",
        help="Curator version to run after reconstruction",
    )
    parser.add_argument(
        "--case",
        action="append",
        dest="cases",
        help="Restrict execution to one or more cases (repeatable, e.g. --case chb01 --case chb02)",
    )
    parser.add_argument("--limit-cases", type=int, default=0, help="Process only the first N discovered cases")
    parser.add_argument("--skip-reconstruct", action="store_true", help="Assume reconstructed EDFs already exist")
    parser.add_argument("--skip-curate", action="store_true", help="Only run reconstruction")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing outputs")
    parser.add_argument("--dry-run", action="store_true", help="Print planned commands without running them")
    parser.add_argument("--python-bin", default=sys.executable, help="Python executable used to invoke the tools")
    return parser.parse_args()


def discover_cases(dataset_root: Path, requested_cases: list[str] | None, limit_cases: int) -> list[str]:
    available = sorted(
        path.name.lower()
        for path in dataset_root.iterdir()
        if path.is_dir() and path.name.lower().startswith("chb") and not path.name.startswith("._")
    )
    if requested_cases:
        requested = [case.lower() for case in requested_cases]
        missing = [case for case in requested if case not in available]
        if missing:
            raise SystemExit(f"No se encontraron estos casos bajo dataset-root: {', '.join(missing)}")
        cases = [case for case in available if case in requested]
    else:
        cases = available
    if limit_cases > 0:
        cases = cases[:limit_cases]
    if not cases:
        raise SystemExit("No se encontraron carpetas chbNN para procesar")
    return cases


def run_command(command: list[str], dry_run: bool) -> int:
    printable = " ".join(str(part) for part in command)
    print(f"$ {printable}")
    if dry_run:
        return 0
    completed = subprocess.run(command, check=False)
    return int(completed.returncode)


def main() -> int:
    args = parse_args()
    dataset_root = Path(args.dataset_root).expanduser().resolve()
    reconstructed_root = Path(args.reconstructed_root).expanduser().resolve()
    curated_root = Path(args.curated_root).expanduser().resolve()

    if not dataset_root.exists():
        raise SystemExit(f"dataset-root no existe: {dataset_root}")

    tools_dir = Path(__file__).resolve().parent
    repo_tools_dir = tools_dir.parent
    reconstruct_script = repo_tools_dir / "bipolar_edf_reconstruction" / "convert_physionet_bipolar.py"
    if args.version == "v1":
        curator_script = tools_dir / "curate_chbmit_fragments.py"
    elif args.version == "v2":
        curator_script = tools_dir / "curate_chbmit_fragments_v2.py"
    else:
        curator_script = tools_dir / "curate_chbmit_fragments_v3.py"
    subject_info_file = dataset_root / "SUBJECT-INFO"

    cases = discover_cases(dataset_root, args.cases, args.limit_cases)
    reconstructed_root.mkdir(parents=True, exist_ok=True)
    curated_root.mkdir(parents=True, exist_ok=True)

    summary: list[dict[str, object]] = []
    failures = 0

    for case_code in cases:
        case_input = dataset_root / case_code
        case_summary = case_input / f"{case_code}-summary.txt"
        case_reconstructed = reconstructed_root / case_code
        case_record: dict[str, object] = {
            "caseCode": case_code,
            "inputDir": str(case_input),
            "reconstructedDir": str(case_reconstructed),
            "curatedRoot": str(curated_root),
            "reconstructed": None,
            "curated": None,
        }

        if not case_summary.exists():
            case_record["error"] = f"Falta summary local: {case_summary}"
            summary.append(case_record)
            failures += 1
            continue

        if not args.skip_reconstruct:
            reconstruct_command = [
                args.python_bin,
                str(reconstruct_script),
                "--download-dir",
                str(case_input),
                "--output-dir",
                str(case_reconstructed),
                "--skip-download",
            ]
            if args.overwrite:
                reconstruct_command.append("--overwrite")
            reconstruct_status = run_command(reconstruct_command, dry_run=args.dry_run)
            case_record["reconstructed"] = "ok" if reconstruct_status == 0 else f"error:{reconstruct_status}"
            if reconstruct_status != 0:
                summary.append(case_record)
                failures += 1
                continue

        if not args.skip_curate:
            curate_command = [
                args.python_bin,
                str(curator_script),
                "--input-dir",
                str(case_reconstructed),
                "--output-dir",
                str(curated_root),
                "--summary-file",
                str(case_summary),
                "--subject-info-file",
                str(subject_info_file),
            ]
            if args.overwrite:
                curate_command.append("--overwrite")
            curate_status = run_command(curate_command, dry_run=args.dry_run)
            case_record["curated"] = "ok" if curate_status == 0 else f"error:{curate_status}"
            if curate_status != 0:
                failures += 1

        summary.append(case_record)

    print()
    print(json.dumps({
        "datasetRoot": str(dataset_root),
        "reconstructedRoot": str(reconstructed_root),
        "curatedRoot": str(curated_root),
        "version": args.version,
        "caseCount": len(cases),
        "failures": failures,
        "dryRun": args.dry_run,
        "cases": summary,
    }, ensure_ascii=False, indent=2))

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
