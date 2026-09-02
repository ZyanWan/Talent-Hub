#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

VERSION="$(python - <<'PY'
import re
from pathlib import Path
content = Path('app/__init__.py').read_text(encoding='utf-8')
match = re.search(r'__version__\s*=\s*"([^"]+)"', content)
if not match:
    raise SystemExit('Unable to read __version__ from app/__init__.py')
print(match.group(1))
PY
)"

if ! python -c "import PyInstaller" >/dev/null 2>&1; then
  echo "PyInstaller is missing. Run: python -m pip install -r requirements-build.txt" >&2
  exit 1
fi

RELEASE_ROOT="release/$VERSION"
MACOS_ROOT="$RELEASE_ROOT/macos"
ZIP_PATH="$MACOS_ROOT/TalentHub-macOS-$VERSION.zip"

if [[ -e "$ZIP_PATH" ]]; then
  echo "Release artifact already exists; refusing to overwrite: $ZIP_PATH" >&2
  exit 1
fi

(cd "$ROOT/frontend" && npm ci && npm run build)

python -X utf8 -m PyInstaller --clean --noconfirm packaging/talent_hub_macos.spec

APP_PATH="dist/TalentHub.app"
EXECUTABLE="$APP_PATH/Contents/MacOS/TalentHub"
if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Build artifact not found: $EXECUTABLE" >&2
  exit 1
fi

python -X utf8 packaging/generate_notices.py --output "$APP_PATH/Contents/Resources"

bash scripts/verify_macos_release.sh "$EXECUTABLE"

mkdir -p "$MACOS_ROOT"
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

echo "macOS app: $APP_PATH"
echo "macOS zip: $ZIP_PATH"
