"""server.py 의 작업 흐름 검증 (Flask 테스트 클라이언트, 네트워크 없음).

실제 다운로드 대신 합성 영상을 쓰도록 y2p.download_video 를 바꿔치기해서,
접수 → SSE 진행 보고 → PDF 다운로드까지 한 바퀴를 확인한다.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import youtube_to_pdf as y2p  # noqa: E402

try:
    import server  # noqa: E402
except ImportError as exc:  # Flask 미설치 환경
    raise unittest.SkipTest(f"server 를 불러올 수 없습니다: {exc}")

from test_pipeline import make_video, pdf_page_count  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="y2p_srv_")
        cls.video = os.path.join(cls.tmp, "lecture.mp4")
        make_video(cls.video)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.client = server.app.test_client()
        self._real_download = y2p.download_video
        video = self.video
        y2p.download_video = lambda *a, **kw: y2p.Download(path=video)
        self.addCleanup(setattr, y2p, "download_video", self._real_download)

    def run_job(self, **payload):
        body = {"url": "https://example.invalid/v", "interval": 1.0}
        body.update(payload)
        created = self.client.post("/api/jobs", json=body)
        self.assertEqual(created.status_code, 200)
        job_id = created.get_json()["id"]

        events = []
        stream = self.client.get(f"/api/jobs/{job_id}/stream")
        current = None
        for raw in stream.response:
            for line in raw.decode("utf-8").splitlines():
                if line.startswith("event: "):
                    current = line[7:]
                elif line.startswith("data: ") and current:
                    events.append((current, line[6:]))
        return job_id, events

    def test_size_modes_are_mapped(self):
        self.assertEqual(server.size_mode_settings("light")[2], 5.0)
        self.assertIsNone(server.size_mode_settings("sharp")[2])
        # 모르는 값은 조용히 기본값으로
        self.assertEqual(
            server.size_mode_settings("헛소리"), server.SIZE_MODES["normal"]
        )

    def test_full_job_produces_downloadable_pdf(self):
        job_id, events = self.run_job(size_mode="normal")

        kinds = [k for k, _ in events]
        self.assertNotIn("error", kinds, f"작업이 실패했다: {events}")
        self.assertIn("done", kinds)
        self.assertIn("progress", kinds)

        done = json.loads(next(v for k, v in events if k == "done"))
        self.assertEqual(done["count"], 5)
        self.assertIn("mb", done, "완료 이벤트에 용량이 없다")

        pdf = self.client.get(f"/api/jobs/{job_id}/pdf")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.mimetype, "application/pdf")
        self.assertTrue(pdf.data.startswith(b"%PDF-"))

        out = os.path.join(self.tmp, f"{job_id}.pdf")
        with open(out, "wb") as f:
            f.write(pdf.data)
        self.assertEqual(pdf_page_count(out), 5)

    def test_light_mode_is_smaller_than_sharp(self):
        sizes = {}
        for mode in ("light", "sharp"):
            job_id, events = self.run_job(size_mode=mode)
            self.assertNotIn("error", [k for k, _ in events])
            sizes[mode] = len(self.client.get(f"/api/jobs/{job_id}/pdf").data)
        self.assertLess(sizes["light"], sizes["sharp"])

    def test_missing_url_is_rejected(self):
        response = self.client.post("/api/jobs", json={"url": "  "})
        self.assertEqual(response.status_code, 400)

    def test_download_failure_is_reported_as_error_event(self):
        def boom(*a, **kw):
            raise RuntimeError("영상 다운로드가 180초 동안 전혀 진행되지 않아 중단했습니다.")

        y2p.download_video = boom
        _, events = self.run_job()
        errors = [v for k, v in events if k == "error"]
        self.assertTrue(errors, "실패가 error 이벤트로 전달되지 않았다")
        self.assertIn("전혀 진행되지 않아", errors[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
