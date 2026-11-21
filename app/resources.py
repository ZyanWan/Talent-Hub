"""打包运行时资源定位：源码目录与 PyInstaller 资源目录的统一入口。"""

from __future__ import annotations

import sys
from pathlib import Path


def resource_root() -> Path:
    """返回应用根目录：打包运行时为 _MEIPASS，源码运行时为仓库根目录。"""
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) if bundled else Path(__file__).resolve().parents[1]


def read_reference(name: str) -> str:
    """读取 app/resources/references 下的参考文件；文件不存在时返回空串。"""
    path = resource_root() / "app" / "resources" / "references" / name
    return path.read_text(encoding="utf-8") if path.exists() else ""
