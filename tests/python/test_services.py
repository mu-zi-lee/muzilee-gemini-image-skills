from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from muzilee_gemini_image_skills.application.artifact_store import ArtifactStore
from muzilee_gemini_image_skills.application.capability_service import CapabilityService
from muzilee_gemini_image_skills.application.setup_service import SetupService
from muzilee_gemini_image_skills.contracts.protocol_loader import load_protocol_catalog


class ServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = load_protocol_catalog()

    def test_setup_service_normalizes_model_alias(self) -> None:
        service = SetupService(self.catalog)
        payload = service.prepare_task_payload(
            {
                "type": "generate_image",
                "setup": {
                    "new_chat": False,
                    "model": "flash",
                    "reference_images": [],
                },
                "input": {"prompt": "cat", "output_mode": "auto"},
                "timeout_seconds": 30,
            }
        )
        self.assertEqual(payload["setup"]["model"], "quick")
        self.assertEqual(payload["input"]["output_mode"], "preview")

    def test_capability_service_only_requires_task_capability_for_preview_image_flow(self) -> None:
        service = CapabilityService(self.catalog)
        required = service.required_capabilities_for_payload(
            {
                "type": "generate_image",
                "setup": {"new_chat": False, "model": "pro", "reference_images": []},
                "input": {"prompt": "poster", "output_mode": "full_size"},
                "timeout_seconds": 60,
            }
        )
        self.assertEqual(required, ["feature:switch_model", "task:generate_image"])

    def test_artifact_store_persists_image_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ArtifactStore(Path(temp_dir))
            result = store.persist_worker_payload(
                task_type="generate_image",
                task_id="abc12345",
                task_payload={
                    "input": {
                        "prompt": "A cozy red cabin in snowy mountains at sunrise",
                    }
                },
                payload={
                    "image_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8lW1kAAAAASUVORK5CYII=",
                    "source": "preview",
                },
            )
            self.assertIn("file_path", result)
            self.assertEqual(result["mime_type"], "image/png")
            self.assertTrue(Path(result["file_path"]).exists())
            self.assertRegex(
                Path(result["file_path"]).name,
                r"^a_cozy_red_cabin_in_snowy_\d+_abc12345\.png$",
            )


if __name__ == "__main__":
    unittest.main()
