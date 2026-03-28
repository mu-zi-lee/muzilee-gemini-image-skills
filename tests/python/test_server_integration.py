from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

from muzilee_gemini_image_skills.config import Config
from muzilee_gemini_image_skills.contracts.protocol_loader import load_protocol_catalog
from muzilee_gemini_image_skills.server.app import build_app, create_http_server


class ServerIntegrationTests(unittest.TestCase):
    def _post_json(self, base_url: str, path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _get_json(self, base_url: str, path: str) -> dict:
        with urllib.request.urlopen(f"{base_url}{path}", timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def test_worker_round_trip(self) -> None:
        catalog = load_protocol_catalog()
        with tempfile.TemporaryDirectory() as temp_dir:
            config = Config(
                host="127.0.0.1",
                port=0,
                output_dir=Path(temp_dir) / "outputs",
                protocol_path=Path(__file__).resolve().parents[2] / "protocol" / "catalog.json",
            )
            app = build_app(config=config, catalog=catalog)
            server = create_http_server(app)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_address[1]}"

            capabilities = list(catalog["capabilities"]["tasks"].values()) + [
                catalog["capabilities"]["features"]["new_chat"],
                catalog["capabilities"]["features"]["switch_model"],
                catalog["capabilities"]["features"]["upload_reference_images"],
                catalog["capabilities"]["features"]["download_full_size"],
            ]

            heartbeat = self._post_json(
                base_url,
                "/api/worker/heartbeat",
                {
                    "worker_id": "worker-1",
                    "page_url": "https://gemini.google.com/app",
                    "ready": True,
                    "model": "Gemini Pro",
                    "title": "Gemini",
                    "meta": {"capabilities": capabilities, "bridge_ready": True},
                },
            )
            self.assertTrue(heartbeat["ok"])

            result_holder: dict = {}

            def run_agent() -> None:
                result_holder["agent"] = self._post_json(
                    base_url,
                    "/agent/tasks/execute",
                    {
                        "type": "send_message",
                        "setup": {},
                        "input": {"message": "hello"},
                        "timeout_seconds": 3,
                    },
                )

            agent_thread = threading.Thread(target=run_agent, daemon=True)
            agent_thread.start()

            time.sleep(0.2)
            next_task = self._get_json(base_url, "/api/worker/tasks/next?worker_id=worker-1")
            self.assertTrue(next_task["ok"])
            self.assertEqual(next_task["task"]["type"], "send_message")

            task_id = next_task["task"]["id"]
            worker_result = self._post_json(
                base_url,
                f"/api/worker/tasks/{task_id}/result",
                {
                    "worker_id": "worker-1",
                    "ok": True,
                    "payload": {"text": "done"},
                },
            )
            self.assertTrue(worker_result["ok"])

            agent_thread.join(timeout=3)
            self.assertTrue(result_holder["agent"]["ok"])
            self.assertEqual(result_holder["agent"]["result"]["text"], "done")

            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()

