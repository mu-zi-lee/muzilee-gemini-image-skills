from __future__ import annotations

import argparse
import json
import sys

from .commands import (
    execute_task,
    make_chat_new_payload,
    make_chat_send_payload,
    make_image_download_latest_payload,
    make_image_generate_payload,
    make_image_upload_reference_payload,
    make_model_set_payload,
    read_worker_state,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Muzilee Gemini Image Skills CLI")
    top = parser.add_subparsers(dest="domain", required=True)
    model_choices = ["pro", "quick", "fast", "flash", "think", "thinking"]
    output_modes = ["preview", "full_size", "auto"]

    chat = top.add_parser("chat", help="Chat tasks")
    chat_commands = chat.add_subparsers(dest="chat_command", required=True)

    chat_send = chat_commands.add_parser("send", help="Send a text message to Gemini")
    chat_send.add_argument("message")
    chat_send.add_argument("--timeout", type=int, default=180)
    chat_send.add_argument("--model", choices=model_choices)
    chat_send.add_argument("--new-chat", action="store_true")
    chat_send.add_argument("--ref", dest="reference_images", action="append", default=[])

    chat_new = chat_commands.add_parser("new", help="Open a new Gemini chat")
    chat_new.add_argument("--timeout", type=int, default=30)

    model = top.add_parser("model", help="Model tasks")
    model_commands = model.add_subparsers(dest="model_command", required=True)
    model_set = model_commands.add_parser("set", help="Switch the Gemini model")
    model_set.add_argument("model", choices=model_choices)
    model_set.add_argument("--timeout", type=int, default=30)

    image = top.add_parser("image", help="Image tasks")
    image_commands = image.add_subparsers(dest="image_command", required=True)

    image_generate = image_commands.add_parser("generate", help="Generate an image")
    image_generate.add_argument("prompt")
    image_generate.add_argument("--timeout", type=int, default=180)
    image_generate.add_argument(
        "--output-mode",
        choices=output_modes,
        default="preview",
        help="Preview-only mode. `auto` and `full_size` are accepted for compatibility but treated as `preview`.",
    )
    image_generate.add_argument("--model", choices=model_choices)
    image_generate.add_argument("--new-chat", action="store_true")
    image_generate.add_argument("--ref", dest="reference_images", action="append", default=[])

    image_upload = image_commands.add_parser("upload-ref", help="Upload reference images")
    image_upload.add_argument("images", nargs="+")
    image_upload.add_argument("--timeout", type=int, default=60)

    image_download = image_commands.add_parser("download-latest", help="Save the latest generated preview image")
    image_download.add_argument("--timeout", type=int, default=60)

    worker = top.add_parser("worker", help="Worker tasks")
    worker_commands = worker.add_subparsers(dest="worker_command", required=True)
    worker_commands.add_parser("state", help="Inspect worker state")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.domain == "chat" and args.chat_command == "send":
        result = execute_task(
            make_chat_send_payload(
                message=args.message,
                timeout_seconds=args.timeout,
                model=args.model,
                new_chat=bool(args.new_chat),
                reference_images=args.reference_images,
            )
        )
    elif args.domain == "chat" and args.chat_command == "new":
        result = execute_task(make_chat_new_payload(timeout_seconds=args.timeout))
    elif args.domain == "model" and args.model_command == "set":
        result = execute_task(make_model_set_payload(model=args.model, timeout_seconds=args.timeout))
    elif args.domain == "image" and args.image_command == "generate":
        result = execute_task(
            make_image_generate_payload(
                prompt=args.prompt,
                timeout_seconds=args.timeout,
                output_mode=args.output_mode,
                model=args.model,
                new_chat=bool(args.new_chat),
                reference_images=args.reference_images,
            )
        )
    elif args.domain == "image" and args.image_command == "upload-ref":
        result = execute_task(
            make_image_upload_reference_payload(
                images=args.images,
                timeout_seconds=args.timeout,
            )
        )
    elif args.domain == "image" and args.image_command == "download-latest":
        result = execute_task(make_image_download_latest_payload(timeout_seconds=args.timeout))
    elif args.domain == "worker" and args.worker_command == "state":
        result = read_worker_state()
    else:
        parser.error("unknown command")
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
