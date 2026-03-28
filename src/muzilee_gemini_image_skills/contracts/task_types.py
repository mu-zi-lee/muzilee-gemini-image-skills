from __future__ import annotations


TASK_SEND_MESSAGE = "send_message"
TASK_GENERATE_IMAGE = "generate_image"
TASK_NEW_CHAT = "new_chat"
TASK_SWITCH_MODEL = "switch_model"
TASK_UPLOAD_REFERENCE_IMAGES = "upload_reference_images"
TASK_DOWNLOAD_LATEST_IMAGE = "download_latest_image"

TASK_TYPES = frozenset(
    {
        TASK_SEND_MESSAGE,
        TASK_GENERATE_IMAGE,
        TASK_NEW_CHAT,
        TASK_SWITCH_MODEL,
        TASK_UPLOAD_REFERENCE_IMAGES,
        TASK_DOWNLOAD_LATEST_IMAGE,
    }
)

OUTPUT_MODE_PREVIEW = "preview"
OUTPUT_MODE_FULL_SIZE = "full_size"
OUTPUT_MODE_AUTO = "auto"

OUTPUT_MODES = frozenset(
    {
        OUTPUT_MODE_PREVIEW,
        OUTPUT_MODE_FULL_SIZE,
        OUTPUT_MODE_AUTO,
    }
)

