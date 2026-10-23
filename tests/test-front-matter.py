"""Exercise front matter through the real JSON-lines renderer process."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
prefix = ('---\r\ntitle: 中文 😀\r\ndate: 2026-10-10\r\n'
          'history:\r\n  - updated: 2026-10-11T10:30:00+08:00\r\n'
          'tags: [Web, Social]\r\ncomments: true\r\nempty: null\r\n...\r\n')
invalid = ['title: [broken', '- item', 'loop: &loop [*loop]',
           'value: !!binary SGVsbG8=', 'value: .nan']
texts = [prefix + '# Body\r\n\r\nText',
         *[f'---\n{metadata}\n---\n# Body' for metadata in invalid],
         '---\ntitle: unfinished\n\n# Body', '# Body\n\nSubtitle\n---',
         '---\ndate: 2026-10-10\n---\n# Date', '# After']
process = subprocess.run([sys.executable, str(ROOT / 'python/znote_renderer.py')],
    input=''.join(json.dumps({"action": "render", "text": text}) + '\n' for text in texts),
    capture_output=True, text=True, encoding='utf-8', check=True, timeout=30)
results = [json.loads(line) for line in process.stdout.splitlines()]
assert len(results) == len(texts), process.stderr
assert all('error' not in result for result in results), results
for result in results:
    json.dumps(result, allow_nan=False)
result = results[0]
assert result["meta"]["date"] == "2026-10-10"
assert result["meta"]["history"][0]["updated"] == "2026-10-11T10:30:00+08:00"
assert result["meta"]["tags"] == ["Web", "Social"]
assert result["meta"]["comments"] is True
assert result["meta"]["empty"] is None
assert not result["warnings"]
assert "2026-10-10" not in result["html"]
heading = next(e for e in result["sourceMap"]["entries"] if e["kind"] == "h1")
assert heading["from"] == len(prefix.encode("utf-16-le")) // 2
for result, metadata in zip(results[1:1 + len(invalid)], invalid):
    assert result["meta"] == {} and result["warnings"]
    assert 'Body' in result["html"] and metadata not in result["html"]
unclosed, normal, date, after = results[-4:]
assert unclosed["warnings"] and 'Body' in unclosed["html"] and unclosed["meta"] == {}
assert not normal["warnings"] and '<h2' in normal["html"]
assert date["meta"]["date"] == '2026-10-10'
assert 'After' in after["html"]
print(f"Front matter JSONL integration passed ({len(results)} requests)")
