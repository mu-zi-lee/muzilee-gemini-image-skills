from __future__ import annotations

import unittest

from muzilee_gemini_image_skills.contracts.task_models import TaskValidationError, parse_task_envelope


class TaskEnvelopeTests(unittest.TestCase):
    def test_generate_image_defaults_to_auto_mode(self) -> None:
        envelope = parse_task_envelope(
            {
                "type": "generate_image",
                "setup": {},
                "input": {"prompt": "sunset"},
            },
            default_timeout=180,
        )
        self.assertEqual(envelope.task_input["output_mode"], "auto")
        self.assertEqual(envelope.timeout_seconds, 180)

    def test_missing_message_raises_validation_error(self) -> None:
        with self.assertRaises(TaskValidationError):
            parse_task_envelope(
                {
                    "type": "send_message",
                    "setup": {},
                    "input": {},
                    "timeout_seconds": 60,
                },
                default_timeout=180,
            )


if __name__ == "__main__":
    unittest.main()
