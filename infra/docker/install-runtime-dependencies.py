"""Install only declared production dependencies in a cacheable Docker layer."""

from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: install-runtime-dependencies.py <pyproject.toml>")

    pyproject = Path(sys.argv[1])
    metadata = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    dependencies = metadata["project"]["dependencies"]
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--no-cache-dir",
            *dependencies,
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
