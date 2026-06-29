#!/usr/bin/env python3
"""
Local WD14 tagger CLI for CanNyan.

Install:
  python -m pip install onnxruntime pillow numpy huggingface_hub

ComfyUI embedded Python example:
  C:\\ComfyUI_windows_portable\\python_embeded\\python.exe -m pip install onnxruntime pillow numpy huggingface_hub

The first run may take a while because the model is downloaded from Hugging Face.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from PIL import Image

RATING_CATEGORY = 9
GENERAL_CATEGORY = 0
CHARACTER_CATEGORY = 4
PROMPT_TAG_LIMIT = 80


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run WD14 image tagging with ONNX Runtime.")
    parser.add_argument("--image", required=True, help="Path to the input image.")
    parser.add_argument("--model-dir", default="data/wd14", help="Local directory for the WD14 model.")
    parser.add_argument(
        "--repo",
        default="SmilingWolf/wd-swinv2-tagger-v3",
        help="Hugging Face repo id for the WD14 model.",
    )
    parser.add_argument(
        "--general-threshold",
        type=float,
        default=0.35,
        help="Threshold for general tags.",
    )
    parser.add_argument(
        "--character-threshold",
        type=float,
        default=0.85,
        help="Threshold for character tags.",
    )
    return parser.parse_args()


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def ensure_model_files(model_dir: Path, repo_id: str) -> tuple[Path, Path]:
    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        snapshot_download(repo_id=repo_id, local_dir=str(model_dir))
    except Exception as exc:  # pragma: no cover - external dependency path
        fail(f"Failed to download WD14 model '{repo_id}': {exc}")

    model_path = next(model_dir.rglob("model.onnx"), None)
    tags_path = next(model_dir.rglob("selected_tags.csv"), None)

    if model_path is None:
        fail(f"model.onnx was not found under {model_dir}")
    if tags_path is None:
        fail(f"selected_tags.csv was not found under {model_dir}")

    return model_path, tags_path


def load_tags(tags_path: Path) -> list[dict[str, object]]:
    tags: list[dict[str, object]] = []
    with tags_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                category = int(row.get("category", ""))
            except ValueError:
                continue

            name = (row.get("name") or "").strip()
            if not name:
                continue

            tags.append({
                "name": name,
                "category": category,
            })

    if not tags:
        fail(f"No tags were loaded from {tags_path}")

    return tags


def composite_rgba_to_white(image: Image.Image) -> Image.Image:
    if image.mode == "RGBA":
        background = Image.new("RGBA", image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, image)
        return image.convert("RGB")

    if image.mode in {"LA", "PA"}:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")

    return image.convert("RGB")


def preprocess_image(image_path: Path, input_shape: list[object]) -> np.ndarray:
    try:
        image = Image.open(image_path)
    except Exception as exc:
        fail(f"Failed to open image '{image_path}': {exc}")

    image = composite_rgba_to_white(image)
    width, height = image.size
    max_side = max(width, height)

    square = Image.new("RGB", (max_side, max_side), (255, 255, 255))
    offset = ((max_side - width) // 2, (max_side - height) // 2)
    square.paste(image, offset)

    height_index = 1
    width_index = 2
    channel_first = False

    if len(input_shape) >= 4 and input_shape[1] == 3:
        channel_first = True
        height_index = 2
        width_index = 3

    target_height = input_shape[height_index]
    target_width = input_shape[width_index]

    if not isinstance(target_height, int) or not isinstance(target_width, int):
        fail(f"Unsupported dynamic ONNX input shape: {input_shape}")

    resized = square.resize((target_width, target_height), Image.BICUBIC)
    array = np.asarray(resized, dtype=np.float32)

    if channel_first:
        array = np.transpose(array, (2, 0, 1))

    return np.expand_dims(array, axis=0)


def score_to_entry(tag: str, score: float) -> dict[str, object]:
    return {"tag": tag, "score": round(float(score), 6)}


def infer(
    session: ort.InferenceSession,
    input_tensor: np.ndarray,
    tags: list[dict[str, object]],
    general_threshold: float,
    character_threshold: float,
) -> dict[str, object]:
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    scores = session.run([output_meta.name], {input_meta.name: input_tensor})[0]
    scores = np.asarray(scores).reshape(-1)

    if len(scores) != len(tags):
        fail(
            f"Tag count mismatch: model returned {len(scores)} scores, "
            f"but CSV contains {len(tags)} tags."
        )

    rating: list[dict[str, object]] = []
    general: list[dict[str, object]] = []
    character: list[dict[str, object]] = []

    for tag_info, score in zip(tags, scores):
        name = str(tag_info["name"])
        category = int(tag_info["category"])
        value = float(score)

        if category == RATING_CATEGORY:
            rating.append(score_to_entry(name, value))
            continue

        if category == GENERAL_CATEGORY and value >= general_threshold:
            general.append(score_to_entry(name, value))
            continue

        if category == CHARACTER_CATEGORY and value >= character_threshold:
            character.append(score_to_entry(name, value))

    rating.sort(key=lambda item: item["score"], reverse=True)
    general.sort(key=lambda item: item["score"], reverse=True)
    character.sort(key=lambda item: item["score"], reverse=True)

    prompt_source = sorted(general + character, key=lambda item: item["score"], reverse=True)[:PROMPT_TAG_LIMIT]
    raw_tags = ", ".join(item["tag"] for item in prompt_source)
    prompt_tags = ", ".join(item["tag"].replace("_", " ") for item in prompt_source)

    return {
        "rating": rating,
        "general": general,
        "character": character,
        "prompt_tags": prompt_tags,
        "raw_tags": raw_tags,
    }


def main() -> None:
    args = parse_args()
    image_path = Path(args.image)

    if not image_path.is_file():
        fail(f"Image file was not found: {image_path}")

    model_path, tags_path = ensure_model_files(Path(args.model_dir), args.repo)
    tags = load_tags(tags_path)

    try:
        session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    except Exception as exc:
        fail(f"Failed to load ONNX model '{model_path}': {exc}")

    input_shape = session.get_inputs()[0].shape
    input_tensor = preprocess_image(image_path, input_shape)
    result = infer(
        session=session,
        input_tensor=input_tensor,
        tags=tags,
        general_threshold=args.general_threshold,
        character_threshold=args.character_threshold,
    )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
