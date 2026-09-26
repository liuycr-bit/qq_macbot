#!/usr/bin/env python3
"""Small process boundary for LRZ9712/tudou-meme.

The QQ Agent worker invokes this file for catalog discovery and generation.  It
deliberately keeps the Python renderer outside the Electron process so a bad or
very large GIF cannot block the bot.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any


def ensure_config() -> None:
    root = Path(os.environ["QQ_AGENT_MEME_PY_HOME"]).resolve()
    config_dir = root / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    config_file = config_dir / "config.toml"
    if not config_file.exists():
        config_file.write_text(
            """[meme]
load_builtin_memes = false
meme_dirs = []
meme_disabled_list = []

[gif]
gif_max_size = 30
gif_max_frames = 200
""",
            encoding="utf-8",
        )


ensure_config()

from meme_generator import get_meme, get_meme_keys  # noqa: E402
from meme_generator.manager import _memes  # noqa: E402


def load_module(module_dir: Path) -> None:
    init_file = module_dir / "__init__.py"
    if not init_file.is_file():
        raise RuntimeError(f"模板模块不存在：{module_dir.name}")
    digest = hashlib.sha256(str(module_dir.resolve()).encode("utf-8")).hexdigest()[:16]
    module_name = f"qq_agent_tudou_{digest}"
    if module_name in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        module_name,
        init_file,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载模板模块：{module_dir.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)


def meme_info(key: str, module_dir: str) -> dict[str, Any]:
    meme = get_meme(key)
    params = meme.params_type
    shortcuts = []
    for shortcut in meme.shortcuts:
        shortcuts.append(
            {
                "pattern": str(shortcut.key),
                "humanized": str(shortcut.humanized or ""),
                "names": [str(shortcut.key)],
                "texts": [str(value) for value in (shortcut.args or [])],
            }
        )
    return {
        "key": str(meme.key),
        "moduleDir": module_dir,
        "keywords": [str(value) for value in meme.keywords],
        "shortcuts": shortcuts,
        "tags": sorted(str(value) for value in meme.tags),
        "params": {
            "minImages": int(params.min_images),
            "maxImages": int(params.max_images),
            "minTexts": int(params.min_texts),
            "maxTexts": int(params.max_texts),
            "defaultTexts": [str(value) for value in params.default_texts],
        },
    }


def catalog(source: Path) -> int:
    templates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    module_dirs = sorted(
        (init_file.parent for init_file in source.rglob("__init__.py")),
        key=lambda entry: entry.relative_to(source).as_posix().casefold(),
    )
    for module_dir in module_dirs:
        # The upstream archive contains two nested modules and two different
        # templates that share the same internal key.  Discover every module
        # in a clean registry; generation also runs in a fresh subprocess, so
        # both colliding templates remain independently addressable.
        _memes.clear()
        try:
            load_module(module_dir)
            for key in get_meme_keys():
                templates.append(meme_info(key, module_dir.relative_to(source).as_posix()))
        except Exception as error:  # keep the rest of the catalog usable
            errors.append({
                "moduleDir": module_dir.relative_to(source).as_posix(),
                "error": str(error),
            })

    key_counts: dict[str, int] = {}
    for template in templates:
        key = str(template["key"])
        key_counts[key] = key_counts.get(key, 0) + 1
    for template in templates:
        key = str(template["key"])
        if key_counts[key] > 1:
            suffix = str(template["moduleDir"]).replace("/", "_")
            template["publicKey"] = f"{key}_{suffix}"
        else:
            template["publicKey"] = key
    print(json.dumps({"templates": templates, "errors": errors}, ensure_ascii=False))
    return 0


def generate(
    source: Path,
    module_name: str,
    key: str,
    images: list[str],
    texts_json: Path,
    names_json: Path,
    output: Path,
) -> int:
    if not module_name:
        raise RuntimeError("模板模块名无效")
    module_dir = (source / module_name).resolve()
    try:
        module_dir.relative_to(source.resolve())
    except ValueError:
        raise RuntimeError("模板模块路径越界")
    load_module(module_dir)
    meme = get_meme(key)
    texts = json.loads(texts_json.read_text(encoding="utf-8"))
    names = json.loads(names_json.read_text(encoding="utf-8"))
    if not isinstance(texts, list) or not isinstance(names, list):
        raise RuntimeError("文字或名称参数格式错误")
    image_bytes = [Path(image).read_bytes() for image in images]
    user_infos = [{"name": str(name), "gender": "unknown"} for name in names]
    result = meme(images=image_bytes, texts=[str(text) for text in texts], args={"user_infos": user_infos})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(result.getvalue())
    print(json.dumps({"path": str(output), "bytes": output.stat().st_size}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    catalog_parser = subparsers.add_parser("catalog")
    catalog_parser.add_argument("--source", type=Path, required=True)

    generate_parser = subparsers.add_parser("generate")
    generate_parser.add_argument("--source", type=Path, required=True)
    generate_parser.add_argument("--module", required=True)
    generate_parser.add_argument("--key", required=True)
    generate_parser.add_argument("--image", action="append", default=[])
    generate_parser.add_argument("--texts-json", type=Path, required=True)
    generate_parser.add_argument("--names-json", type=Path, required=True)
    generate_parser.add_argument("--output", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "catalog":
        return catalog(args.source.resolve())
    return generate(
        args.source.resolve(),
        args.module,
        args.key,
        args.image,
        args.texts_json,
        args.names_json,
        args.output,
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
