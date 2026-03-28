from __future__ import annotations

import time
import unittest

from muzilee_gemini_image_skills.state.task_queue import TaskQueue
from muzilee_gemini_image_skills.state.worker_registry import WorkerRegistry


class StateTests(unittest.TestCase):
    def test_stale_worker_running_task_is_requeued(self) -> None:
        registry = WorkerRegistry(worker_timeout_seconds=1)
        queue = TaskQueue()
        registry.heartbeat(
            worker_id="worker-1",
            page_url="https://gemini.google.com/",
            ready=True,
            model="pro",
            title="Gemini",
            meta={"capabilities": ["task:send_message"]},
        )

        task = queue.create_task(
            task_type="send_message",
            payload={"type": "send_message"},
            required_capabilities=["task:send_message"],
        )
        assigned = queue.assign_next_task("worker-1", lambda queued: True)
        self.assertIsNotNone(assigned)
        registry.mark_task_assignment("worker-1", task.task_id)

        worker = registry.get("worker-1")
        self.assertIsNotNone(worker)
        worker.last_seen = time.time() - 2

        stale_task_ids = registry.expire_stale_workers()
        queue.requeue_tasks(stale_task_ids)
        self.assertEqual(queue.get(task.task_id).status, "queued")


if __name__ == "__main__":
    unittest.main()

