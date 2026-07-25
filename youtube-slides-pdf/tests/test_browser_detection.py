"""브라우저판(index.html) 감지 로직이 파이썬판과 같은 판단을 하는지 검증.

index.html 은 서버 없이 기기 안에서만 도는 경로라 파이썬 코드를 전혀 공유하지
않는다.  그래서 한쪽만 고치면 조용히 어긋난다 — 실제로 3채널 지문을 옮길 때
파이썬 상수(INK_FLOOR=14)를 그대로 쓰면 브라우저에서는 발표자 움직임과 압축
잡음을 전부 슬라이드 전환으로 오해했다(4.5, 48.4 → 임계값 2.8 초과).

이 테스트는 복사본이 아니라 index.html 안의 함수를 그대로 뽑아 실행한다.
Node 가 없으면 건너뛴다.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from test_detection import (  # noqa: E402
    CHANGE_THRESHOLD, SETTLE_THRESHOLD, add_noise, bullets, chart, code, photo,
    with_presenter,
)

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_HTML = os.path.join(os.path.dirname(HERE), "index.html")
HARNESS = os.path.join(HERE, "browser_detect_harness.js")

COLOR_SIZE = 32
INK_GRID = 96
EDGE = INK_GRID * 4          # index.html 의 EDGE_W/EDGE_H 와 같은 값
REGION_GRID = 64

KINDS = [("글머리표", bullets), ("코드", code), ("차트", chart), ("사진", photo)]
RESOLUTIONS = [(1920, 1080), (854, 480)]


def _rgba(img: "np.ndarray", size: int) -> bytes:
    """캔버스 drawImage 축소를 INTER_AREA 로 근사해 RGBA 바이트로."""
    small = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    rgba = np.dstack([rgb, np.full(rgb.shape[:2], 255, np.uint8)])
    return rgba.tobytes()


def _dump_side(img: "np.ndarray", directory: str, name: str) -> str:
    with open(os.path.join(directory, name), "wb") as f:
        f.write(_rgba(img, COLOR_SIZE))
        f.write(_rgba(img, EDGE))
        f.write(_rgba(img, REGION_GRID))
    return name


class BrowserDetectionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("node 가 없어 브라우저 로직을 검증할 수 없습니다.")
        cls.tmp = tempfile.mkdtemp(prefix="y2p_js_")
        cls.payload = cls._run_harness()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "tmp"):
            shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def _build_cases(cls):
        cases, index = [], [0]

        def add(label, want, a, b):
            index[0] += 1
            n = index[0]
            cases.append({
                "label": label, "want": want,
                "a": _dump_side(a, cls.tmp, f"{n}a.bin"),
                "b": _dump_side(b, cls.tmp, f"{n}b.bin"),
            })

        for w, h in RESOLUTIONS:
            shift = int(40 * h / 1080)
            for name, make in KINDS:
                first, second = make(1, w, h), make(2, w, h)
                add(f"{w}x{h} {name} 전환", "감지", first, second)
                add(f"{w}x{h} {name} 발표자만", "무시",
                    with_presenter(first, -shift), with_presenter(first, shift))
            base = bullets(1, w, h)
            add(f"{w}x{h} 같은 화면", "무시", base, base)
            for sigma in (4, 10, 16):
                add(f"{w}x{h} 잡음만 σ={sigma}", "무시",
                    add_noise(base, sigma, 1), add_noise(base, sigma, 2))
        return cases

    @classmethod
    def _run_harness(cls):
        manifest = {
            "edge": EDGE, "colorSize": COLOR_SIZE, "cases": cls._build_cases(),
        }
        manifest_path = os.path.join(cls.tmp, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f)

        proc = subprocess.run(
            ["node", HARNESS, INDEX_HTML, manifest_path],
            capture_output=True, text=True, encoding="utf-8",
        )
        if proc.returncode != 0:
            raise AssertionError(
                "브라우저 로직 추출/실행 실패:\n" + (proc.stderr or proc.stdout)
            )
        return json.loads(proc.stdout)

    # -- 검증 --------------------------------------------------------------
    def test_constants_are_browser_calibrated(self):
        """파이썬 값을 그대로 복사해 오면 브라우저에서 오검출이 난다."""
        c = self.payload["constants"]
        self.assertEqual(c["INK_GRID"], INK_GRID)
        self.assertEqual(c["REGION_GRID"], REGION_GRID)
        self.assertGreaterEqual(
            c["INK_FLOOR"], 20,
            "INK_FLOOR 가 너무 낮으면 압축 잡음을 슬라이드 전환으로 오해합니다.",
        )

    def test_slide_changes_are_detected(self):
        for r in self.payload["results"]:
            if r["want"] != "감지":
                continue
            with self.subTest(케이스=r["label"]):
                self.assertGreaterEqual(
                    r["value"], CHANGE_THRESHOLD,
                    f"브라우저판이 전환을 놓쳤다 (차이 {r['value']:.2f})",
                )

    def test_noise_and_presenter_are_ignored(self):
        for r in self.payload["results"]:
            if r["want"] != "무시":
                continue
            with self.subTest(케이스=r["label"]):
                self.assertLessEqual(
                    r["value"], SETTLE_THRESHOLD,
                    f"브라우저판이 전환으로 오해했다 (차이 {r['value']:.2f})",
                )

    def test_separation_margin(self):
        detect = [r["value"] for r in self.payload["results"] if r["want"] == "감지"]
        ignore = [r["value"] for r in self.payload["results"] if r["want"] == "무시"]
        self.assertTrue(detect and ignore)
        self.assertGreater(
            min(detect) / max(max(ignore), 0.01), 3.0,
            f"분리도 부족 (감지 최소 {min(detect):.2f} vs 무시 최대 {max(ignore):.2f})",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
