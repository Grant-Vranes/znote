"""Isolated JSON-lines Markdown renderer used by the desktop application."""
import contextlib
import importlib.metadata
import io
import json
import os
import sys
import traceback
import copy
import hashlib
import math
import re
from collections import OrderedDict
from datetime import date, datetime

import markdown
import yaml

from render_plan import resolve
from render_config import CAPABILITIES
from source_map import SourceMap

_parse_cache = OrderedDict()
_cache_bytes = 0
_metadata_cache = OrderedDict()
_metadata_cache_bytes = 0
# Match splitlines boundaries without allocating lines for the whole document.
_line_break = re.compile(r"\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]")
_line_break_chars = "\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"
_fence = re.compile(r"---|\.\.\.")

def convert_cached(text, plan, extensions, configs):
    """Styles and runtime preferences do not require another Markdown parse."""
    global _cache_bytes
    key = (hashlib.sha256(text.encode()).hexdigest(), plan["revisions"]["parse"])
    cached = _parse_cache.get(key)
    if cached is not None:
        _parse_cache.move_to_end(key)
        return cached[0], copy.deepcopy(cached[1]), [entry.copy() for entry in cached[2]]
    md = markdown.Markdown(extensions=extensions, extension_configs=configs, output_format="html")
    mapping = SourceMap(md, text)
    html = md.convert(text)
    toc = getattr(md, "toc_tokens", [])
    entries = mapping.entries
    size = len(html.encode()) + len(json.dumps(toc).encode()) + len(json.dumps(entries).encode())
    if size <= 8 * 1024 * 1024:
        _parse_cache[key] = (html, copy.deepcopy(toc), [entry.copy() for entry in entries], size)
        _cache_bytes += size
        while len(_parse_cache) > 6 or _cache_bytes > 16 * 1024 * 1024:
            _, removed = _parse_cache.popitem(last=False)
            _cache_bytes -= removed[3]
    return html, toc, entries


def metadata_json(value, active=None):
    """Normalize YAML metadata at the JSON protocol boundary, including dates."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, (dict, list)):
        active = set() if active is None else active
        if id(value) in active:
            raise ValueError("YAML 元数据包含循环引用")
        active.add(id(value))
        try:
            if isinstance(value, list):
                return [metadata_json(item, active) for item in value]
            result = {}
            for key, item in value.items():
                normalized = metadata_json(key, active)
                if isinstance(normalized, (dict, list)):
                    raise ValueError("YAML 元数据的键必须是标量")
                name = normalized if isinstance(normalized, str) else json.dumps(normalized, ensure_ascii=False)
                if name in result:
                    raise ValueError("YAML 元数据的键在转换后重复")
                result[name] = metadata_json(item, active)
            return result
        finally:
            active.remove(id(value))
    raise ValueError(f"YAML 元数据类型不受支持：{type(value).__name__}")


def parse_metadata(source):
    """Cache the header alone; callers receive independent, mutable results."""
    global _metadata_cache_bytes
    cached = _metadata_cache.get(source)
    if cached is not None:
        _metadata_cache.move_to_end(source)
        return copy.deepcopy(cached[0]), cached[1].copy()
    try:
        meta = yaml.safe_load(source)
        if meta is None:
            meta = {}
        if not isinstance(meta, dict):
            raise ValueError("YAML 元数据应为键值映射")
        meta, warnings = metadata_json(meta), []
    except (yaml.YAMLError, ValueError, TypeError, RecursionError) as exc:
        meta, warnings = {}, [f"Front matter 无法解析：{exc}"]
    # Bound both entry count and serialized payload, including invalid headers.
    # Large or heavily expanded YAML remains supported without occupying cache.
    if len(source) <= 64 * 1024:
        size = len(source.encode()) + len(json.dumps([meta, warnings], ensure_ascii=False).encode())
        if size <= 256 * 1024:
            _metadata_cache[source] = (meta, warnings, size)
            _metadata_cache_bytes += size
            while len(_metadata_cache) > 8 or _metadata_cache_bytes > 1024 * 1024:
                _, removed = _metadata_cache.popitem(last=False)
                _metadata_cache_bytes -= removed[2]
            return copy.deepcopy(meta), warnings.copy()
    return meta, warnings


def front_matter(text):
    first = _line_break.search(text)
    if text[:first.start() if first else len(text)].strip() != "---":
        return text, {}, []
    content_from = first.end() if first else len(text)
    # Search delimiter candidates in C rather than iterating every body line in
    # Python for unfinished headers. Stop at the first standalone closing line.
    for match in _fence.finditer(text, content_from):
        start, end = match.span()
        while start > content_from and text[start - 1].isspace() and text[start - 1] not in _line_break_chars:
            start -= 1
        if start > content_from and text[start - 1] not in _line_break_chars:
            continue
        while end < len(text) and text[end].isspace() and text[end] not in _line_break_chars:
            end += 1
        if end < len(text) and text[end] not in _line_break_chars:
            continue
        ending = _line_break.match(text, end)
        meta, warnings = parse_metadata(text[content_from:start])
        return text[ending.end() if ending else end:], meta, warnings
    return text, {}, ["Front matter 缺少结束分隔符（--- 或 ...），已按正文渲染。"]


def render(req):
    original = req.get("text", "")
    # CodeMirror uses LF and UTF-16 offsets. Preserve CRLF input offsets when
    # this renderer is called directly; the GUI already normalizes its text.
    text, meta, warnings = front_matter(original)
    prefix = original[:len(original) - len(text)]
    plan, extensions, configs, theme, effective, config_warnings = resolve(req)
    warnings.extend(config_warnings)
    html, toc, entries = convert_cached(text, plan, extensions, configs)
    base = len(prefix.encode("utf-16-le")) // 2
    if base:
        for entry in entries:
            if "from" in entry:
                entry["from"] += base
                entry["to"] += base
    result = {"html": html, "toc": toc, "meta": meta,
              "sourceMap": {"version": 1, "offsetEncoding": "utf-16", "entries": entries},
              "warnings": warnings, "theme": theme, "plan": plan}
    if effective is not None:
        result["effectiveConfig"] = effective
    return result


def dispatch(req):
    if req.get("action") == "info":
        return {"versions": {name: importlib.metadata.version(name) for name in ("zensical", "Markdown", "pymdown-extensions")},
                "python": sys.version.split()[0], "capabilities": CAPABILITIES}
    if req.get("action") == "render":
        return render(req)
    raise ValueError("Unknown action")


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, sys.stdout.fileno())
    os.close(null)
    for line in sys.stdin:
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                result = dispatch(json.loads(line))
            protocol.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as exc:
            protocol.write(json.dumps({"error": f"{exc}\n{traceback.format_exc()}"}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
