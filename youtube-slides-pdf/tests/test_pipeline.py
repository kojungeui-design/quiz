"""합성 영상으로 전체 흐름(감지 → 시각 오프셋 → PDF 용량)을 검증한다.

네트워크·yt-dlp 없이 돌아간다.  cv2 로 '슬라이드 5장이 4초마다 바뀌는' 영상을
직접 만들어 넣고, 나온 PDF 를 다시 열어 확인한다.

실행:  python -m unittest discover -s tests
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import youtube_to_pdf as y2p  # noqa: E402

SLIDE_COLORS = [
    (30, 30, 200), (30, 200, 30), (200, 30, 30), (200, 200, 30), (30, 200, 200),
]
FPS = 10
SECONDS_PER_SLIDE = 4


def make_video(path: str, width: int = 1280, height: int = 720) -> float:
    """색이 뚜렷이 다른 슬라이드 5장이 4초마다 넘어가는 영상을 만든다."""
    writer = cv2.VideoWriter(
        path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (width, height)
    )
    if not writer.isOpened():
        raise unittest.SkipTest("이 환경의 OpenCV 로는 mp4 를 쓸 수 없습니다.")
    for index, color in enumerate(SLIDE_COLORS):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :] = color
        # 슬라이드마다 다른 도형을 넣어 색 말고도 구조가 달라지게 한다.
        cv2.rectangle(
            frame, (100, 100 + index * 40), (500 + index * 80, 400), (255, 255, 255), -1
        )
        for _ in range(FPS * SECONDS_PER_SLIDE):
            writer.write(frame)
    writer.release()
    return len(SLIDE_COLORS) * SECONDS_PER_SLIDE


def pdf_page_count(path: str) -> int:
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(b"%PDF-"):
        raise AssertionError("PDF 헤더가 없습니다 — 유효한 PDF 가 아닙니다.")
    match = re.search(rb"/Type\s*/Pages.*?/Count\s+(\d+)", data, re.S)
    if match:
        return int(match.group(1))
    return len(re.findall(rb"/Type\s*/Page[^s]", data))


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="y2p_pipe_")
        cls.video = os.path.join(cls.tmp, "lecture.mp4")
        cls.duration = make_video(cls.video)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="y2p_work_", dir=self.tmp)

    # -- 감지 정확도 -------------------------------------------------------
    def test_detects_every_slide_once(self):
        slides = y2p.detect_slides(self.video, self.work, interval=1.0)
        self.assertEqual(
            len(slides), len(SLIDE_COLORS),
            f"슬라이드 {len(SLIDE_COLORS)}장을 기대했는데 {len(slides)}장 감지됨",
        )
        # 시각이 단조 증가하고, 대략 4초 간격이어야 한다.
        times = [s.time_sec for s in slides]
        self.assertEqual(times, sorted(times))
        for earlier, later in zip(times, times[1:]):
            self.assertGreaterEqual(later - earlier, SECONDS_PER_SLIDE - 1.5)

    # -- 구간 다운로드 시각 오프셋 ------------------------------------------
    def test_time_offset_shifts_timestamps_to_original(self):
        """구간 다운로드로 잘린 파일이어도 시각은 원본 기준이어야 한다."""
        plain = y2p.detect_slides(self.video, self.work, interval=1.0)
        shifted = y2p.detect_slides(
            self.video, tempfile.mkdtemp(dir=self.tmp),
            interval=1.0, time_offset=120.0,
        )
        self.assertEqual(len(plain), len(shifted))
        for before, after in zip(plain, shifted):
            self.assertAlmostEqual(after.time_sec, before.time_sec + 120.0, places=3)

    def test_generate_computes_offset_for_sectioned_download(self):
        """generate() 가 구간 다운로드 결과에 맞춰 분석 구간·오프셋을 다시 잡는가."""
        calls = {}
        fake = y2p.Download(path=self.video, time_offset=120.0, sectioned=True)
        real_detect = y2p.detect_slides

        def spy(video_path, workdir, **kwargs):
            calls.update(kwargs)
            return real_detect(video_path, workdir, **kwargs)

        out = os.path.join(self.work, "out.pdf")
        original_download, original_detect = y2p.download_video, y2p.detect_slides
        y2p.download_video = lambda *a, **kw: fake
        y2p.detect_slides = spy
        try:
            y2p.generate("https://example.invalid/v", out, self.work,
                         start=120, end=300)
        finally:
            y2p.download_video, y2p.detect_slides = original_download, original_detect

        self.assertEqual(calls["start"], 0.0, "잘린 파일은 0초부터 봐야 한다")
        self.assertEqual(calls["end"], 180.0, "분석 길이는 end-start 여야 한다")
        self.assertEqual(calls["time_offset"], 120.0)

    def test_generate_keeps_original_range_without_sections(self):
        """구간 다운로드를 안 썼으면 기존 동작 그대로여야 한다(회귀 금지)."""
        calls = {}
        fake = y2p.Download(path=self.video, time_offset=0.0, sectioned=False)
        real_detect = y2p.detect_slides

        def spy(video_path, workdir, **kwargs):
            calls.update(kwargs)
            return real_detect(video_path, workdir, **kwargs)

        out = os.path.join(self.work, "out2.pdf")
        original_download, original_detect = y2p.download_video, y2p.detect_slides
        y2p.download_video = lambda *a, **kw: fake
        y2p.detect_slides = spy
        try:
            y2p.generate("https://example.invalid/v", out, self.work,
                         start=5, end=15)
        finally:
            y2p.download_video, y2p.detect_slides = original_download, original_detect

        self.assertEqual(calls["start"], 5)
        self.assertEqual(calls["end"], 15)
        self.assertEqual(calls["time_offset"], 0.0)

    # -- PDF 용량 ----------------------------------------------------------
    def test_pdf_is_valid_and_has_one_page_per_slide(self):
        out = os.path.join(self.work, "slides.pdf")
        slides = y2p.generate(
            self.video, out, self.work, is_local=True, interval=1.0,
        )
        self.assertEqual(pdf_page_count(out), len(slides))

    def test_width_and_quality_reduce_size(self):
        """폭·화질을 낮추면 PDF 가 실제로 더 가벼워져야 한다."""
        big_dir = tempfile.mkdtemp(dir=self.tmp)
        small_dir = tempfile.mkdtemp(dir=self.tmp)
        big = os.path.join(big_dir, "big.pdf")
        small = os.path.join(small_dir, "small.pdf")

        y2p.generate(self.video, big, big_dir, is_local=True, interval=1.0,
                     max_width=1600, quality=92)
        y2p.generate(self.video, small, small_dir, is_local=True, interval=1.0,
                     max_width=900, quality=55)

        self.assertLess(os.path.getsize(small), os.path.getsize(big))
        self.assertEqual(pdf_page_count(small), pdf_page_count(big))

    def test_max_mb_shrinks_until_under_target(self):
        """목표 용량을 주면 그 이하로 줄여서 다시 만들어야 한다."""
        work = tempfile.mkdtemp(dir=self.tmp)
        baseline = os.path.join(work, "baseline.pdf")
        slides = y2p.generate(self.video, baseline, work, is_local=True,
                              interval=1.0, max_width=1600, quality=92)
        baseline_mb = os.path.getsize(baseline) / (1024 * 1024)

        target = baseline_mb * 0.5          # 확실히 줄여야만 맞출 수 있는 목표
        capped = os.path.join(work, "capped.pdf")
        y2p.build_pdf(slides, capped, max_mb=target)

        capped_mb = os.path.getsize(capped) / (1024 * 1024)
        self.assertLess(capped_mb, baseline_mb)
        self.assertLessEqual(capped_mb, target,
                             f"목표 {target:.2f}MB 를 못 맞췄다 ({capped_mb:.2f}MB)")
        self.assertEqual(pdf_page_count(capped), len(slides))

    def test_max_mb_leaves_small_pdf_alone(self):
        """이미 목표보다 작으면 손대지 않아야 한다(불필요한 화질 저하 금지)."""
        work = tempfile.mkdtemp(dir=self.tmp)
        out = os.path.join(work, "a.pdf")
        slides = y2p.generate(self.video, out, work, is_local=True, interval=1.0)
        before = os.path.getsize(out)

        y2p.build_pdf(slides, out, max_mb=500)   # 넉넉한 목표
        self.assertEqual(os.path.getsize(out), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
