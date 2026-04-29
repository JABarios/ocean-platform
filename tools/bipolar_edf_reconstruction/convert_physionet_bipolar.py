#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.request import urlopen, urlretrieve

import numpy as np
import pyedflib


STANDARD_CHANNEL_ORDER = [
    "Fp1", "Fp2",
    "F7", "F3", "Fz", "F4", "F8",
    "T3", "C3", "Cz", "C4", "T4",
    "T5", "P3", "Pz", "P4", "T6",
    "O1", "O2",
    "A1", "A2",
]

AUXILIARY_NAMES = {
    "ECG", "EKG", "VNS", "EMG", "EOG", "RESP", "PLETH", "SAO2", "SPO2",
}

CHANNEL_ALIASES = {
    "T7": "T3",
    "T8": "T4",
    "P7": "T5",
    "P8": "T6",
}

DISPLAY_LABELS = {
    "FP1": "Fp1",
    "FP2": "Fp2",
    "F7": "F7",
    "F3": "F3",
    "FZ": "Fz",
    "F4": "F4",
    "F8": "F8",
    "T3": "T3",
    "C3": "C3",
    "CZ": "Cz",
    "C4": "C4",
    "T4": "T4",
    "T5": "T5",
    "P3": "P3",
    "PZ": "Pz",
    "P4": "P4",
    "T6": "T6",
    "O1": "O1",
    "O2": "O2",
    "A1": "A1",
    "A2": "A2",
    "FT9": "FT9",
    "FT10": "FT10",
}


@dataclass
class BipolarEdge:
    index: int
    original_label: str
    source: str
    target: str


@dataclass
class ConversionResult:
    source_file: str
    output_file: str
    status: str
    bipolar_pairs: int
    reconstructed_nodes: int
    passthrough_channels: int
    rms_error_uv: float | None
    notes: str = ""


class EdfLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href and href.lower().endswith(".edf"):
            self.links.append(href)


def canonicalize_label(label: str) -> str:
    value = label.strip()
    if not value:
        return value

    value = re.sub(r"^EEG[\s:_-]*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value).strip()
    upper = value.upper()
    if upper in CHANNEL_ALIASES:
        upper = CHANNEL_ALIASES[upper]
    return upper


def display_label(label: str) -> str:
    canonical = canonicalize_label(label)
    return DISPLAY_LABELS.get(canonical, canonical)


def is_auxiliary_label(label: str) -> bool:
    upper = canonicalize_label(label).upper()
    return upper in AUXILIARY_NAMES or any(upper.startswith(f"{name} ") for name in AUXILIARY_NAMES)


def parse_bipolar_label(label: str) -> tuple[str, str] | None:
    cleaned = canonicalize_label(label)
    if cleaned == "-" or "-" not in cleaned:
        return None

    parts = [part.strip() for part in re.split(r"\s*-\s*", cleaned, maxsplit=1)]
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    if is_auxiliary_label(parts[0]) or is_auxiliary_label(parts[1]):
        return None
    return parts[0], parts[1]


def sort_nodes(nodes: Iterable[str]) -> list[str]:
    node_list = list(nodes)
    rank = {canonicalize_label(name): idx for idx, name in enumerate(STANDARD_CHANNEL_ORDER)}
    return sorted(node_list, key=lambda item: (rank.get(item, 10_000), item))


def fetch_edf_links(index_url: str) -> list[str]:
    with urlopen(index_url) as response:
        html = response.read().decode("utf-8", errors="replace")
    parser = EdfLinkParser()
    parser.feed(html)
    return [rewrite_physionet_download_url(urljoin(index_url, href)) for href in parser.links]


def rewrite_physionet_download_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc != "physionet.org":
        return url

    path = parsed.path
    marker = "/content/"
    if marker not in path:
        return url
    return url.replace("/content/", "/files/", 1)


def is_real_edf_file(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 256:
        return False
    with path.open("rb") as fh:
        head = fh.read(8)
    return head == b"0       "


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


def download_files(urls: list[str], destination: Path) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []
    for url in urls:
        filename = Path(urlparse(url).path).name
        target = destination / filename
        if target.exists() and not is_real_edf_file(target):
            print(f"[refresh]  {filename} (cached file is not a real EDF)")
            target.unlink()
        if not target.exists():
            print(f"[download] {filename}")
            urlretrieve(url, target)
        else:
            print(f"[cache]    {filename}")
        downloaded.append(target)
    return downloaded


def build_bipolar_graph(labels: list[str]) -> tuple[list[BipolarEdge], list[int], list[str]]:
    edges: list[BipolarEdge] = []
    passthrough_indices: list[int] = []
    nodes: set[str] = set()

    for index, label in enumerate(labels):
        parsed = parse_bipolar_label(label)
        if parsed is None:
            if canonicalize_label(label) != "-":
                passthrough_indices.append(index)
            continue
        source, target = parsed
        edges.append(BipolarEdge(index=index, original_label=label, source=source, target=target))
        nodes.add(source)
        nodes.add(target)

    return edges, passthrough_indices, sort_nodes(nodes)


def reconstruct_nodes(reader: pyedflib.EdfReader, edges: list[BipolarEdge], nodes: list[str]) -> tuple[np.ndarray, float]:
    node_count = len(nodes)
    if node_count < 2 or len(edges) < node_count - 1:
        raise ValueError("No hay suficientes ecuaciones bipolares para reconstruir los nodos")

    node_index = {name: idx for idx, name in enumerate(nodes)}
    reference_node = nodes[-1]

    matrix = np.zeros((len(edges), node_count - 1), dtype=float)
    observed = []
    for row, edge in enumerate(edges):
        if edge.source != reference_node:
            matrix[row, node_index[edge.source]] = 1.0
        if edge.target != reference_node:
            matrix[row, node_index[edge.target]] = -1.0
        observed.append(reader.readSignal(edge.index))

    observed_matrix = np.vstack(observed)
    solved, *_ = np.linalg.lstsq(matrix, observed_matrix, rcond=None)

    reconstructed = np.zeros((node_count, observed_matrix.shape[1]), dtype=float)
    reconstructed[:-1, :] = solved
    reconstructed -= reconstructed.mean(axis=0, keepdims=True)

    predicted = np.zeros_like(observed_matrix)
    for row, edge in enumerate(edges):
        predicted[row, :] = (
            reconstructed[node_index[edge.source], :]
            - reconstructed[node_index[edge.target], :]
        )

    rms_error = float(np.sqrt(np.mean((predicted - observed_matrix) ** 2)))
    return reconstructed, rms_error


def make_signal_header(label: str, signal: np.ndarray, sample_frequency: float, prefilter: str, transducer: str) -> dict:
    physical_min = float(np.min(signal))
    physical_max = float(np.max(signal))
    if math.isclose(physical_min, physical_max):
        physical_min -= 1.0
        physical_max += 1.0

    physical_min = clamp_edf_numeric(physical_min)
    physical_max = clamp_edf_numeric(physical_max)

    return {
        "label": display_label(label)[:16],
        "dimension": "uV",
        "sample_frequency": sample_frequency,
        "physical_min": physical_min,
        "physical_max": physical_max,
        "digital_min": -32768,
        "digital_max": 32767,
        "transducer": transducer[:80],
        "prefilter": prefilter[:80],
    }


def write_reconstructed_edf(
    output_path: Path,
    reader: pyedflib.EdfReader,
    nodes: list[str],
    reconstructed: np.ndarray,
    passthrough_indices: list[int],
) -> None:
    signal_headers: list[dict] = []
    signals_to_write: list[np.ndarray] = []

    base_sample_frequency = float(reader.getSampleFrequency(0))

    for idx, node_name in enumerate(nodes):
        signal = reconstructed[idx, :].astype(np.float64)
        signal_headers.append(
            make_signal_header(
                label=node_name,
                signal=signal,
                sample_frequency=base_sample_frequency,
                prefilter="reconstructed from bipolar montage",
                transducer="OCEAN bipolar converter",
            )
        )
        signals_to_write.append(signal)

    for index in passthrough_indices:
        label = display_label(reader.getLabel(index))
        if label == "-":
            continue
        signal = reader.readSignal(index).astype(np.float64)
        signal_headers.append(
            make_signal_header(
                label=label or f"AUX{index}",
                signal=signal,
                sample_frequency=float(reader.getSampleFrequency(index)),
                prefilter="passthrough auxiliary channel",
                transducer="original auxiliary channel",
            )
        )
        signals_to_write.append(signal)

    header = {
        "technician": "",
        "recording_additional": "Reconstructed from bipolar montage",
        "patientname": "anonymous",
        "patient_additional": "",
        "patientcode": "",
        "equipment": "OCEAN bipolar converter",
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


def convert_single_file(source_path: Path, output_dir: Path, overwrite: bool) -> ConversionResult:
    output_path = output_dir / f"{source_path.stem}_reconstructed.edf"
    if output_path.exists() and not overwrite:
        return ConversionResult(
            source_file=source_path.name,
            output_file=output_path.name,
            status="skipped",
            bipolar_pairs=0,
            reconstructed_nodes=0,
            passthrough_channels=0,
            rms_error_uv=None,
            notes="output already exists",
        )

    with pyedflib.EdfReader(str(source_path)) as reader:
        labels = reader.getSignalLabels()
        edges, passthrough_indices, nodes = build_bipolar_graph(labels)
        if not edges:
            raise ValueError("No se detectaron canales bipolares en el EDF")

        reconstructed, rms_error = reconstruct_nodes(reader, edges, nodes)
        write_reconstructed_edf(
            output_path=output_path,
            reader=reader,
            nodes=nodes,
            reconstructed=reconstructed,
            passthrough_indices=passthrough_indices,
        )

    return ConversionResult(
        source_file=source_path.name,
        output_file=output_path.name,
        status="ok",
        bipolar_pairs=len(edges),
        reconstructed_nodes=len(nodes),
        passthrough_channels=len(passthrough_indices),
        rms_error_uv=rms_error,
    )


def write_report(output_dir: Path, results: list[ConversionResult]) -> None:
    report_path = output_dir / "conversion_report.csv"
    output_dir.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "source_file",
                "output_file",
                "status",
                "bipolar_pairs",
                "reconstructed_nodes",
                "passthrough_channels",
                "rms_error_uv",
                "notes",
            ],
        )
        writer.writeheader()
        for result in results:
            writer.writerow({
                "source_file": result.source_file,
                "output_file": result.output_file,
                "status": result.status,
                "bipolar_pairs": result.bipolar_pairs,
                "reconstructed_nodes": result.reconstructed_nodes,
                "passthrough_channels": result.passthrough_channels,
                "rms_error_uv": "" if result.rms_error_uv is None else f"{result.rms_error_uv:.6f}",
                "notes": result.notes,
            })


def collect_local_edfs(download_dir: Path) -> list[Path]:
    return sorted(download_dir.glob("*.edf"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and reconstruct bipolar EDF files into electrode-wise EDFs compatible with OCEAN/KAPPA.",
    )
    parser.add_argument("--source-url", help="Directory URL with .edf links (e.g. PhysioNet case folder)")
    parser.add_argument("--download-dir", required=True, help="Local directory for cached source EDF files")
    parser.add_argument("--output-dir", required=True, help="Directory for reconstructed EDF output files")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of EDF files to process")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite already converted EDF files")
    parser.add_argument("--skip-download", action="store_true", help="Use only EDFs already present in download-dir")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    download_dir = Path(args.download_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if args.skip_download:
        source_files = collect_local_edfs(download_dir)
    else:
        if not args.source_url:
            print("error: --source-url es obligatorio salvo con --skip-download", file=sys.stderr)
            return 2
        urls = fetch_edf_links(args.source_url)
        if not urls:
            print("error: no se encontraron enlaces .edf en la URL indicada", file=sys.stderr)
            return 2
        source_files = download_files(urls, download_dir)

    if args.limit and args.limit > 0:
        source_files = source_files[: args.limit]

    if not source_files:
        print("No hay archivos EDF para procesar.", file=sys.stderr)
        return 1

    print(f"Procesando {len(source_files)} archivos…")
    results: list[ConversionResult] = []

    for source_path in source_files:
        print(f"[convert]  {source_path.name}")
        try:
            result = convert_single_file(source_path, output_dir, overwrite=args.overwrite)
        except Exception as exc:  # noqa: BLE001
            result = ConversionResult(
                source_file=source_path.name,
                output_file=f"{source_path.stem}_reconstructed.edf",
                status="error",
                bipolar_pairs=0,
                reconstructed_nodes=0,
                passthrough_channels=0,
                rms_error_uv=None,
                notes=str(exc),
            )
            print(f"           error: {exc}", file=sys.stderr)
        results.append(result)

    write_report(output_dir, results)

    ok = sum(1 for item in results if item.status == "ok")
    skipped = sum(1 for item in results if item.status == "skipped")
    failed = sum(1 for item in results if item.status == "error")

    print()
    print(f"OK: {ok}  skipped: {skipped}  errors: {failed}")
    print(f"Reporte: {output_dir / 'conversion_report.csv'}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
