from __future__ import annotations

import argparse
import importlib.metadata as metadata
import re
import shutil
from collections import deque
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


ROOT = Path(__file__).resolve().parents[1]
LICENSE_NAME_RE = re.compile(r"^(license|licence|copying|notice|copyright)([._-].*)?$", re.I)


def direct_requirements() -> list[Requirement]:
    requirements: list[Requirement] = []
    for raw_line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line and not line.startswith(("#", "-")):
            requirements.append(Requirement(line))
    return requirements


def dependency_distributions() -> list[metadata.Distribution]:
    queue = deque(direct_requirements())
    seen: set[str] = set()
    distributions: list[metadata.Distribution] = []
    while queue:
        requirement = queue.popleft()
        if requirement.marker and not requirement.marker.evaluate():
            continue
        normalized = canonicalize_name(requirement.name)
        if normalized in seen:
            continue
        seen.add(normalized)
        try:
            distribution = metadata.distribution(requirement.name)
        except metadata.PackageNotFoundError as exc:
            raise RuntimeError(f"Missing distribution required for notices: {requirement.name}") from exc
        distributions.append(distribution)
        for dependency in distribution.requires or []:
            parsed = Requirement(dependency)
            if not parsed.marker or parsed.marker.evaluate():
                queue.append(parsed)
    return sorted(distributions, key=lambda item: canonicalize_name(item.metadata["Name"]))


def license_expression(distribution: metadata.Distribution) -> str:
    value = distribution.metadata.get("License-Expression") or distribution.metadata.get("License")
    if value and len(value.strip()) < 200:
        return " ".join(value.split())
    classifiers = distribution.metadata.get_all("Classifier") or []
    licenses = [item.rsplit("::", 1)[-1].strip() for item in classifiers if "License ::" in item]
    return ", ".join(licenses) or "See bundled license file"


def project_url(distribution: metadata.Distribution) -> str:
    for entry in distribution.metadata.get_all("Project-URL") or []:
        if "," in entry:
            label, url = entry.split(",", 1)
            if label.strip().casefold() in {"homepage", "repository", "source"}:
                return url.strip()
    return distribution.metadata.get("Home-page", "")


def copy_license_files(distribution: metadata.Distribution, destination: Path) -> list[str]:
    copied: list[str] = []
    package_name = canonicalize_name(distribution.metadata["Name"])
    for relative in distribution.files or []:
        if not LICENSE_NAME_RE.match(Path(relative).name):
            continue
        source = Path(distribution.locate_file(relative))
        if not source.is_file() or source.stat().st_size > 2 * 1024 * 1024:
            continue
        target_name = f"{package_name}--{Path(relative).name}"
        target = destination / target_name
        if target.exists():
            continue
        shutil.copyfile(source, target)
        copied.append(target_name)
    return copied


def generate(output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    licenses_dir = output_dir / "THIRD_PARTY_LICENSES"
    licenses_dir.mkdir(exist_ok=True)
    lines = [
        "Talent Hub - Third-Party Notices",
        "",
        "The following packages are bundled directly or transitively.",
        "Full license and notice files supplied by distributions are in THIRD_PARTY_LICENSES.",
        "",
    ]
    for distribution in dependency_distributions():
        name = distribution.metadata["Name"]
        version = distribution.version
        copied = copy_license_files(distribution, licenses_dir)
        lines.append(f"- {name} {version}")
        lines.append(f"  License: {license_expression(distribution)}")
        url = project_url(distribution)
        if url:
            lines.append(f"  Project: {url}")
        if copied:
            lines.append(f"  Files: {', '.join(copied)}")
        lines.append("")
    notice_path = output_dir / "THIRD_PARTY_NOTICES.txt"
    notice_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return notice_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate third-party package notices.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(generate(args.output.resolve()))


if __name__ == "__main__":
    main()
