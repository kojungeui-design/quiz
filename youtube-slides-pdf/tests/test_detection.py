"""화면 변화 감지의 핵심 성질 검증.

과거 이 감지기는 '배경색이 통째로 바뀌는' 합성 영상으로만 확인돼서,
흰 배경에 글자만 바뀌는 실제 강의 슬라이드를 전혀 못 잡는 결함이 있었다.
(차이 0.4 vs 임계값 8.0)  같은 일이 다시 생기지 않도록 아래를 고정한다.

  - 글머리표 / 코드 / 차트 / 사진 슬라이드가 넘어가면  → 감지
  - 발표자(웹캠 오버레이)만 움직이면                  → 무시
  - 압축 잡음만 있고 내용은 같으면                    → 무시
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import youtube_to_pdf as y2p  # noqa: E402

# detect_slides 의 기본 임계값과 같은 값 (server.py 의 민감도 '보통' 도 이 값)
CHANGE_THRESHOLD = 8.0
SETTLE_THRESHOLD = 2.8

RESOLUTIONS = [(1920, 1080), (1280, 720), (854, 480)]


# ---------------------------------------------------------------------------
# 실제 강의 화면을 흉내 낸 슬라이드들
# ---------------------------------------------------------------------------
def bullets(seed: int, w: int, h: int) -> "np.ndarray":
    r = np.random.default_rng(seed)
    f = np.full((h, w, 3), (245, 245, 245), np.uint8)
    s = h / 1080
    cv2.putText(f, f"Section {seed}", (int(90 * s), int(160 * s)),
                cv2.FONT_HERSHEY_SIMPLEX, 2.2 * s, (20, 20, 20), max(1, int(5 * s)))
    for i in range(9):
        text = "- " + " ".join(
            "".join(chr(97 + c) for c in r.integers(0, 26, r.integers(3, 9)))
            for _ in range(7))
        cv2.putText(f, text, (int(110 * s), int((290 + i * 78) * s)),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1 * s, (40, 40, 40), max(1, int(3 * s)))
    return f


def code(seed: int, w: int, h: int) -> "np.ndarray":
    r = np.random.default_rng(seed + 500)
    f = np.full((h, w, 3), (30, 30, 34), np.uint8)
    s = h / 1080
    for i in range(16):
        indent = int(r.integers(0, 4)) * 40
        text = " ".join(
            "".join(chr(97 + c) for c in r.integers(0, 26, r.integers(2, 7)))
            for _ in range(r.integers(3, 8)))
        cv2.putText(f, text, (int((80 + indent) * s), int((120 + i * 58) * s)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8 * s,
                    (150, 220, 150) if i % 3 else (220, 200, 120), max(1, int(2 * s)))
    return f


def chart(seed: int, w: int, h: int) -> "np.ndarray":
    r = np.random.default_rng(seed * 31 + 7)
    f = np.full((h, w, 3), (250, 250, 248), np.uint8)
    s = h / 1080
    cv2.putText(f, f"Quarterly Results {seed}", (int(90 * s), int(140 * s)),
                cv2.FONT_HERSHEY_SIMPLEX, 2.0 * s, (20, 20, 20), max(1, int(4 * s)))
    base, top = int(h * 0.86), int(h * 0.25)
    for i in range(8):
        bar = int(r.integers(int((base - top) * 0.25), base - top))
        x = int((190 + i * 200) * s)
        cv2.rectangle(f, (x, base - bar), (x + int(140 * s), base),
                      tuple(int(v) for v in r.integers(40, 230, 3)), -1)
    cv2.line(f, (int(150 * s), base), (w - int(90 * s), base), (0, 0, 0), max(1, int(3 * s)))
    return f


def photo(seed: int, w: int, h: int) -> "np.ndarray":
    r = np.random.default_rng(seed * 17 + 3)
    top_c, bottom_c = r.integers(30, 230, 3), r.integers(30, 230, 3)
    ramp = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    f = np.repeat(top_c[None, None, :] * (1 - ramp) + bottom_c[None, None, :] * ramp,
                  w, axis=1).astype(np.uint8)
    cv2.circle(f, (int(w * r.uniform(0.3, 0.7)), int(h * r.uniform(0.4, 0.7))),
               int(h * r.uniform(0.15, 0.3)),
               tuple(int(v) for v in r.integers(20, 240, 3)), -1)
    return f


SLIDE_KINDS = [("글머리표", bullets), ("코드", code), ("차트", chart), ("사진", photo)]


def with_presenter(base: "np.ndarray", dx: int) -> "np.ndarray":
    """오른쪽 아래 웹캠 오버레이 안에서 발표자가 dx 만큼 움직인 화면."""
    f = base.copy()
    h, w = f.shape[:2]
    s = h / 1080
    x0, y0 = w - int(420 * s), h - int(320 * s)
    cv2.rectangle(f, (x0, y0), (x0 + int(380 * s), y0 + int(280 * s)), (60, 60, 70), -1)
    cv2.circle(f, (x0 + int(190 * s) + dx, y0 + int(110 * s)), int(62 * s),
               (200, 180, 160), -1)
    cv2.ellipse(f, (x0 + int(190 * s) + dx, y0 + int(250 * s)),
                (int(110 * s), int(80 * s)), 0, 180, 360, (40, 90, 160), -1)
    return f


def add_noise(img: "np.ndarray", sigma: float, seed: int) -> "np.ndarray":
    r = np.random.default_rng(seed)
    noisy = img.astype(np.int16) + r.normal(0, sigma, img.shape).astype(np.int16)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def diff(a: "np.ndarray", b: "np.ndarray") -> float:
    return y2p.signature_diff(y2p.frame_signature(a), y2p.frame_signature(b))


# ---------------------------------------------------------------------------
class DetectionTest(unittest.TestCase):
    def test_slide_changes_are_detected(self):
        """네 유형 × 세 해상도 모두에서 슬라이드 전환을 잡아야 한다."""
        for w, h in RESOLUTIONS:
            for name, make in SLIDE_KINDS:
                with self.subTest(해상도=f"{w}x{h}", 유형=name):
                    value = diff(make(1, w, h), make(2, w, h))
                    self.assertGreaterEqual(
                        value, CHANGE_THRESHOLD,
                        f"{name} 슬라이드 전환을 놓쳤다 (차이 {value:.2f})",
                    )

    def test_slide_changes_survive_compression_noise(self):
        for w, h in RESOLUTIONS:
            for name, make in SLIDE_KINDS:
                with self.subTest(해상도=f"{w}x{h}", 유형=name):
                    value = diff(add_noise(make(1, w, h), 10, 1),
                                 add_noise(make(2, w, h), 10, 2))
                    self.assertGreaterEqual(
                        value, CHANGE_THRESHOLD,
                        f"잡음이 섞인 {name} 전환을 놓쳤다 (차이 {value:.2f})",
                    )

    def test_text_only_change_is_detected(self):
        """가장 흔한 실패 사례: 흰 배경에 글자만 바뀌는 전환."""
        value = diff(bullets(1, 1920, 1080), bullets(2, 1920, 1080))
        self.assertGreaterEqual(value, CHANGE_THRESHOLD)
        # 임계값에 겨우 걸치는 게 아니라 여유 있게 넘어야 한다.
        self.assertGreater(value, CHANGE_THRESHOLD * 1.2)

    def test_presenter_movement_is_ignored(self):
        """발표자만 움직이는 화면은 '안정'으로 봐서 새 슬라이드로 잡지 않아야 한다."""
        for w, h in RESOLUTIONS:
            for name, make in SLIDE_KINDS:
                with self.subTest(해상도=f"{w}x{h}", 유형=name):
                    base = make(1, w, h)
                    shift = int(40 * h / 1080)
                    value = diff(with_presenter(base, -shift), with_presenter(base, shift))
                    self.assertLessEqual(
                        value, SETTLE_THRESHOLD,
                        f"{name}: 발표자 움직임을 슬라이드 전환으로 오해했다 "
                        f"(차이 {value:.2f})",
                    )

    def test_identical_frames_are_zero(self):
        frame = bullets(1, 1280, 720)
        self.assertAlmostEqual(diff(frame, frame), 0.0, places=6)

    def test_noise_alone_is_ignored(self):
        """내용은 그대로고 압축 잡음만 다를 때 새 슬라이드로 잡으면 안 된다."""
        for sigma in (4, 10, 16):
            with self.subTest(잡음=sigma):
                frame = bullets(1, 1920, 1080)
                value = diff(add_noise(frame, sigma, 1), add_noise(frame, sigma, 2))
                self.assertLessEqual(
                    value, SETTLE_THRESHOLD,
                    f"잡음(σ={sigma})만으로 전환이라 판단했다 (차이 {value:.2f})",
                )

    def test_shipped_defaults_match_measured_behaviour(self):
        """실제로 출고되는 기본값이 위에서 검증한 임계값과 어긋나지 않아야 한다.

        settle 기본값이 발표자 움직임 실측치보다 빡빡하면 '안정' 판정이 나지 않아
        슬라이드가 아예 캡처되지 않는다. (480p 에서 실측 2.15 → 2.0 은 위험)
        """
        args = y2p.parse_args(["https://example.invalid/v"])
        self.assertEqual(args.change_threshold, CHANGE_THRESHOLD)
        self.assertGreaterEqual(
            args.settle_threshold, CHANGE_THRESHOLD * 0.35,
            "--settle 기본값이 발표자 오버레이 실측치보다 빡빡합니다.",
        )

        worst_presenter = 0.0
        for w, h in RESOLUTIONS:
            for _, make in SLIDE_KINDS:
                base = make(1, w, h)
                shift = int(40 * h / 1080)
                worst_presenter = max(
                    worst_presenter,
                    diff(with_presenter(base, -shift), with_presenter(base, shift)),
                )
        self.assertLess(
            worst_presenter, args.settle_threshold,
            f"발표자 움직임 최대치 {worst_presenter:.2f} 가 기본 settle "
            f"{args.settle_threshold} 을 넘습니다 — 캡처가 막힙니다.",
        )

    def test_separation_margin_is_comfortable(self):
        """전환과 발표자 움직임 사이에 넉넉한 간격이 있어야 한다."""
        for w, h in RESOLUTIONS:
            with self.subTest(해상도=f"{w}x{h}"):
                base = bullets(1, w, h)
                shift = int(40 * h / 1080)
                ignore = diff(with_presenter(base, -shift), with_presenter(base, shift))
                detect = diff(bullets(1, w, h), bullets(2, w, h))
                self.assertGreater(
                    detect / max(ignore, 0.01), 4.0,
                    f"분리도가 부족하다 (감지 {detect:.2f} vs 무시 {ignore:.2f})",
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
