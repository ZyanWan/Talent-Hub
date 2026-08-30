# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


ROOT = Path(SPEC).resolve().parents[1]
hiddenimports = [
    "pdfplumber",
    "pypdf",
    "uvicorn.logging",
    "uvicorn.lifespan.on",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
]

datas = [
    (str(ROOT / "app" / "static"), "app/static"),
    (str(ROOT / "app" / "resources"), "app/resources"),
]

a = Analysis(
    [str(ROOT / "launcher.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "cv2",
        "dask",
        "duckdb",
        "fsspec",
        "grpc",
        "h5py",
        "ipykernel",
        "jedi",
        "jupyter",
        "matplotlib",
        "notebook",
        "numba",
        "numpy",
        "onnxruntime",
        "opentelemetry",
        "pandas",
        "plotly",
        "pyarrow",
        "pytest",
        "scipy",
        "seaborn",
        "sklearn",
        "sqlalchemy",
        "sympy",
        "tensorflow",
        "tkinter",
        "torch",
        "torchvision",
        "transformers",
        "zmq",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TalentHub",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="TalentHub",
)

app_icon = ROOT / "assets" / "app-icon.icns"
app = BUNDLE(
    coll,
    name="TalentHub.app",
    icon=str(app_icon) if app_icon.exists() else None,
    bundle_identifier="com.libernovo.talenthub",
)
