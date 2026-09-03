from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from app.main import _render_pdf_preview


class _FakeImage:
    def save(self, buffer, format: str) -> None:
        buffer.write(b"png")

    def close(self) -> None:
        pass


class _FakeBitmap:
    def to_pil(self) -> _FakeImage:
        return _FakeImage()

    def close(self) -> None:
        pass


class _FakePage:
    def __init__(self, render) -> None:
        self._render = render
        self.closed = False

    def render(self, *, scale: float) -> _FakeBitmap:
        return self._render()

    def close(self) -> None:
        self.closed = True


class _FakeDocument:
    def __init__(self, page: _FakePage) -> None:
        self.page = page

    def __len__(self) -> int:
        return 1

    def __getitem__(self, index: int) -> _FakePage:
        return self.page

    def close(self) -> None:
        pass


class ResumePreviewTests(unittest.TestCase):
    def test_concurrent_requests_serialize_pdfium_rendering(self) -> None:
        state = {"active": False}
        state_lock = threading.Lock()
        start_barrier = threading.Barrier(2)

        def render_bitmap() -> _FakeBitmap:
            with state_lock:
                if state["active"]:
                    raise RuntimeError("concurrent PDFium access")
                state["active"] = True
            time.sleep(0.03)
            with state_lock:
                state["active"] = False
            return _FakeBitmap()

        fake_pdfium = types.SimpleNamespace(
            PdfDocument=lambda raw: _FakeDocument(_FakePage(render_bitmap)),
        )

        def render() -> tuple[int, list[dict]]:
            start_barrier.wait()
            return _render_pdf_preview(b"pdf", 1.0)

        with patch.dict(sys.modules, {"pypdfium2": fake_pdfium}):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: render(), range(2)))

        self.assertEqual([result[0] for result in results], [1, 1])

    def test_render_failure_is_not_masked_by_cleanup(self) -> None:
        class RenderError(RuntimeError):
            pass

        def fail_render() -> _FakeBitmap:
            raise RenderError("render failed")

        page = _FakePage(fail_render)
        fake_pdfium = types.SimpleNamespace(PdfDocument=lambda raw: _FakeDocument(page))

        with patch.dict(sys.modules, {"pypdfium2": fake_pdfium}):
            with self.assertRaisesRegex(RenderError, "render failed"):
                _render_pdf_preview(b"pdf", 1.0)

        self.assertTrue(page.closed)


if __name__ == "__main__":
    unittest.main()
