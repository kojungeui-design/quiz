"""download_video 의 진행률·타임아웃·구간 다운로드 동작 검증.

네트워크 없이 돌아간다.  진짜 yt-dlp 대신 '가짜 yt-dlp'(진행률 라인을 흉내 내는
파이썬 스크립트)를 YTDLP_BIN 으로 물려서 확인한다.

실행:  python -m unittest discover -s tests
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import youtube_to_pdf as y2p  # noqa: E402


def make_fake_ytdlp(tmpdir: str, body: str) -> str:
    """body 를 실행하는 가짜 yt-dlp 를 만들고 YTDLP_BIN 용 JSON 값을 돌려준다.

    .cmd 래퍼를 쓰면 cmd.exe 가 `video.%(ext)s` 같은 인자의 `%` 를 다시 해석해
    깨지므로, 파이썬을 직접 실행하는 인자 배열로 넘긴다.
    """
    script = os.path.join(tmpdir, "fake_ytdlp.py")
    with open(script, "w", encoding="utf-8") as f:
        f.write(textwrap.dedent(body))
    return json.dumps([sys.executable, "-u", script])


# 가짜 yt-dlp 가 남긴 실제 호출 인자를 읽어 온다.
_RECORD_ARGV = """
    import os, sys
    args = sys.argv[1:]
    d = os.path.dirname(args[args.index("-o") + 1])
    with open(os.path.join(d, "argv.txt"), "w", encoding="utf-8") as f:
        f.write("\\n".join(args))
    open(os.path.join(d, "video.mp4"), "wb").close()
"""


def read_argv(tmpdir: str) -> str:
    with open(os.path.join(tmpdir, "argv.txt"), encoding="utf-8") as f:
        return f.read()


def pretend_ffmpeg_exists():
    """ffmpeg 이 깔려 있지 않은 곳에서도 구간 다운로드 경로를 시험하기 위한 패치."""
    real = shutil.which

    def fake(name, *a, **kw):
        return r"C:\fake\ffmpeg.exe" if name == "ffmpeg" else real(name, *a, **kw)

    return mock.patch.object(y2p.shutil, "which", side_effect=fake)


def pretend_no_ffmpeg():
    real = shutil.which

    def fake(name, *a, **kw):
        return None if name == "ffmpeg" else real(name, *a, **kw)

    return mock.patch.object(y2p.shutil, "which", side_effect=fake)


class DownloadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="y2p_test_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self._saved = {
            k: os.environ.get(k)
            for k in ("YTDLP_BIN", "YTDLP_STALL_TIMEOUT", "YTDLP_TIMEOUT",
                      "YTDLP_NO_SECTIONS")
        }
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    # -- (a) 정상 진행 -----------------------------------------------------
    def test_progress_is_parsed_and_reported(self):
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, """
            import os, sys
            # -o 뒤의 출력 템플릿에서 작업 폴더를 얻어 결과 파일을 만든다.
            args = sys.argv[1:]
            out = args[args.index("-o") + 1]
            for pct in (0.0, 12.5, 47.3, 100.0):
                print(f"__DLPROG__|  {pct}%|1.42MiB/s|00:03")
            open(os.path.join(os.path.dirname(out), "video.mp4"), "wb").close()
            print("[download] 100% of 10.00MiB in 00:03")
        """)
        seen = []
        result = y2p.download_video(
            "https://example.invalid/v", self.tmp,
            progress=lambda frac, text, count: seen.append((frac, text)),
        )

        self.assertTrue(result.path.endswith("video.mp4"))
        self.assertFalse(result.sectioned)
        self.assertEqual(result.time_offset, 0.0)
        self.assertTrue(seen, "progress 콜백이 한 번도 호출되지 않았다")
        self.assertTrue(all(t.startswith("다운로드 중") for _, t in seen))
        self.assertAlmostEqual(seen[-1][0], 1.0)          # 100% 로 닫혔는가
        self.assertTrue(any("47.3%" in t for _, t in seen))
        self.assertTrue(any("1.42MiB/s" in t for _, t in seen))

    def test_part_files_are_ignored(self):
        """미완성 조각(.part)을 결과로 잘못 집지 않아야 한다."""
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, """
            import os, sys
            args = sys.argv[1:]
            d = os.path.dirname(args[args.index("-o") + 1])
            open(os.path.join(d, "video.mp4.part"), "wb").close()
            open(os.path.join(d, "video.mp4"), "wb").close()
        """)
        result = y2p.download_video("https://example.invalid/v", self.tmp)
        self.assertTrue(result.path.endswith("video.mp4"))

    # -- (b) 정체(stall) ---------------------------------------------------
    def test_stall_timeout_kills_process(self):
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, """
            import time
            print("__DLPROG__|  1.0%|10KiB/s|99:99")
            time.sleep(120)          # 이후 아무 출력도 하지 않는다 = 정체
        """)
        os.environ["YTDLP_STALL_TIMEOUT"] = "3"

        began = time.monotonic()
        with self.assertRaises(RuntimeError) as ctx:
            y2p.download_video("https://example.invalid/v", self.tmp)
        took = time.monotonic() - began

        message = str(ctx.exception)
        self.assertIn("전혀 진행되지 않아", message)
        self.assertIn("YTDLP_COOKIES", message)     # 다음 행동을 안내하는가
        self.assertLess(took, 30, "정체 타임아웃이 제때 끊지 못했다")

    # -- (c) 실패 종료코드 -------------------------------------------------
    def test_failure_includes_stderr_and_cookie_hint(self):
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, """
            import sys
            print("ERROR: Sign in to confirm you're not a bot")
            sys.exit(1)
        """)
        with self.assertRaises(RuntimeError) as ctx:
            y2p.download_video("https://example.invalid/v", self.tmp)

        message = str(ctx.exception)
        self.assertIn("영상 다운로드 실패", message)
        self.assertIn("Sign in to confirm", message)
        self.assertIn("YTDLP_COOKIES", message)

    # -- 구간 다운로드 -----------------------------------------------------
    def test_section_spec(self):
        self.assertIsNone(y2p._section_spec(0, None))
        self.assertIsNone(y2p._section_spec(0, 0))
        self.assertEqual(y2p._section_spec(120, 300), "*120.000-300.000")
        self.assertEqual(y2p._section_spec(120, None), "*120.000-inf")
        self.assertEqual(y2p._section_spec(0, 300), "*0.000-300.000")

    def test_sections_applied_when_ffmpeg_present(self):
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, _RECORD_ARGV)
        with pretend_ffmpeg_exists():
            result = y2p.download_video(
                "https://example.invalid/v", self.tmp, start=120, end=300,
            )
        argv = read_argv(self.tmp)

        self.assertIn("--download-sections", argv)
        self.assertIn("*120.000-300.000", argv)
        self.assertIn("--force-keyframes-at-cuts", argv)
        self.assertTrue(result.sectioned)
        self.assertEqual(result.time_offset, 120)

    def test_sections_skipped_without_ffmpeg(self):
        """ffmpeg 이 없으면 구간 다운로드 대신 전체를 받아야 한다(회귀 금지)."""
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, _RECORD_ARGV)
        with pretend_no_ffmpeg():
            result = y2p.download_video(
                "https://example.invalid/v", self.tmp, start=120, end=300,
            )
        argv = read_argv(self.tmp)
        self.assertNotIn("--download-sections", argv)
        self.assertFalse(result.sectioned)
        self.assertEqual(result.time_offset, 0.0)

    def test_sections_disabled_by_env(self):
        os.environ["YTDLP_NO_SECTIONS"] = "1"
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, _RECORD_ARGV)
        with pretend_ffmpeg_exists():
            result = y2p.download_video(
                "https://example.invalid/v", self.tmp, start=120, end=300,
            )
        argv = read_argv(self.tmp)
        self.assertNotIn("--download-sections", argv)
        self.assertFalse(result.sectioned)

    def test_socket_timeout_always_passed(self):
        os.environ["YTDLP_BIN"] = make_fake_ytdlp(self.tmp, _RECORD_ARGV)
        y2p.download_video("https://example.invalid/v", self.tmp)
        argv = read_argv(self.tmp)
        self.assertIn("--socket-timeout", argv)
        self.assertIn("--newline", argv)
        self.assertIn("__DLPROG__", argv)


class ParseTest(unittest.TestCase):
    def test_parse_dlprog(self):
        self.assertIsNone(y2p._parse_dlprog("[download] 12% of 3MiB"))
        pct, speed, eta = y2p._parse_dlprog("__DLPROG__|  37.2%|1.42MiB/s|03:12")
        self.assertAlmostEqual(pct, 37.2)
        self.assertEqual(speed, "1.42MiB/s")
        self.assertEqual(eta, "03:12")

    def test_parse_dlprog_unknown_size(self):
        """크기를 모르는 스트림은 퍼센트가 N/A 로 온다 — 죽지 않아야 한다."""
        pct, speed, eta = y2p._parse_dlprog("__DLPROG__|N/A|Unknown speed|Unknown")
        self.assertIsNone(pct)
        self.assertEqual(speed, "Unknown speed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
