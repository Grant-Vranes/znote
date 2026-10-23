"""Exercise the real renderer and block provenance for Quotes callouts.

Run: .venv/Scripts/python.exe tests/test-callouts.py
"""
from html.parser import HTMLParser
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
import markdown
from render_plan import resolve
from znote_renderer import render


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.nodes = []
        self.stack = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "text": ""}
        self.nodes.append(node)
        if tag not in {"br", "hr", "img", "input", "wbr"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        for node in self.stack:
            node["text"] += data


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


class Callouts(unittest.TestCase):
    def location(self, result, tag, text, index=0):
        nodes = [node for node in Elements(result["html"]).nodes
                 if node["tag"] == tag and node["text"].strip() == text]
        node_id = nodes[index]["attrs"]["data-zn-node"]
        return next(entry for entry in result["sourceMap"]["entries"] if entry["id"] == node_id)

    def assert_line(self, result, tag, text, source, line, index=0, precision="exact"):
        entry = self.location(result, tag, text, index)
        lines = source.split("\n")
        self.assertEqual(entry["from"], utf16("\n".join(lines[:line - 1]) + ("\n" if line > 1 else "")))
        self.assertEqual(entry["to"], entry["from"] + utf16(lines[line - 1]))
        self.assertEqual(entry["precision"], precision)
        return entry

    def test_github_types_and_obsidian_classes(self):
        for kind in ("NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION", "note", "CUSTOM"):
            with self.subTest(kind=kind):
                result = render({"text": f"> [!{kind}]\n> Body"})
                self.assertIn(f'class="admonition {kind.lower()}"', result["html"])
                self.assertFalse(result["warnings"])
        result = render({"text": "> [!warning | inline | end] **Title**\n> Body"})
        self.assertIn('class="admonition warning inline end"', result["html"])
        self.assertIn("<strong>Title</strong>", result["html"])

    def test_collapse_is_independent_of_admonition_and_details_extensions(self):
        for marker in ("+", "-"):
            with self.subTest(marker=marker):
                source = f"> [!tip]{marker} Title\n> Body"
                result = render({"text": source, "settings": {"extensions": {
                    "admonition": False, "pymdownx.details": False}}})
                self.assertIn('<details class="tip"', result["html"])
                self.assertEqual(" open>" in result["html"], marker == "+")
                self.assert_line(result, "summary", "Title", source, 1)
                self.assert_line(result, "p", "Body", source, 2)

    def test_switches_and_cache_revisions(self):
        request = {"text": "> [!NOTE]\n> Body", "includeEffectiveConfig": True}
        enabled = render(request)
        disabled = render(request | {"settings": {"extensions": {"pymdownx.quotes": False}}})
        quotes_only = render(request | {"settings": {"extensionConfigs": {"pymdownx.quotes": {"callouts": False}}}})
        self.assertIn('class="admonition note"', enabled["html"])
        for result in (disabled, quotes_only):
            self.assertIn("<blockquote", result["html"])
            self.assertIn("[!NOTE]", result["html"])
            self.assertFalse(result["warnings"])
        self.assertEqual(len({r["plan"]["revisions"]["parse"] for r in (enabled, disabled, quotes_only)}), 3)
        self.assertTrue(enabled["effectiveConfig"]["extensionConfigs"]["pymdownx.quotes"]["callouts"])
        self.assertEqual(enabled, render(request))
        invalid = render(request | {"settings": {"extensionConfigs": {"pymdownx.quotes": {"callouts": "yes"}}}})
        self.assertIn("extensionConfigs.pymdownx.quotes.callouts", invalid["warnings"][0])

    def test_quote_grouping_and_callout_position(self):
        source = "> First\n\n> Second"
        for settings, expected in (({}, 2), ({"extensions": {"pymdownx.quotes": False}}, 1),
                                   ({"extensionConfigs": {"pymdownx.quotes": {"callouts": False}}}, 2)):
            with self.subTest(settings=settings):
                self.assertEqual(render({"text": source, "settings": settings})["html"].count("<blockquote"), expected)
        self.assertEqual(render({"text": "> First\n>\n> Second"})["html"].count("<blockquote"), 1)
        self.assertNotIn("admonition", render({"text": "> First\n> [!NOTE]\n> Body"})["html"])

    def test_repeated_nested_content_and_generated_title(self):
        source = ("Before 😀\n\n> [!note]\n> Same\n>\n> > [!tip] Inner\n> > Same\n>\n> Same\n\nAfter")
        result = render({"text": source})
        self.assert_line(result, "p", "Note", source, 3, precision="inherited")
        self.assert_line(result, "p", "Inner", source, 6)
        for index, line in enumerate((4, 7, 9)):
            self.assert_line(result, "p", "Same", source, line, index)
        self.assert_line(result, "p", "After", source, 11)
        outer = self.location(result, "div", "Note\nSame\n\nInner\nSame\n\nSame")
        self.assertEqual(outer["precision"], "exact")
        self.assertEqual(outer["from"], utf16("Before 😀\n\n"))

    def test_custom_title_frontmatter_crlf_and_cache(self):
        body = "Intro 😀\n> [!note]+ Custom **title**\n> Body\n>\n> Second\n\nAfter"
        for newline in ("\n", "\r\n"):
            with self.subTest(newline=newline):
                source = ("---\ntitle: Callouts\n---\n" + body).replace("\n", newline)
                result = render({"text": source})
                self.assert_line(result, "summary", "Custom title", source, 5)
                self.assert_line(result, "p", "Body", source, 6)
                self.assert_line(result, "p", "Second", source, 8)
                self.assertEqual(result, render({"text": source}))

    def test_lists_code_and_heading_titles(self):
        source = ("- Item\n\n    > [!note] ### Heading\n    > Same\n    >\n    > - Same\n    >\n"
                  "    > ```python\n    > print(1)\n    > ```")
        result = render({"text": source})
        self.assert_line(result, "h3", "Heading¶", source, 3)
        self.assert_line(result, "p", "Same", source, 4)
        self.assert_line(result, "li", "Same", source, 6)
        code = next(node for node in Elements(result["html"]).nodes
                    if "highlight" in node["attrs"].get("class", "").split())
        entry = next(e for e in result["sourceMap"]["entries"] if e["id"] == code["attrs"]["data-zn-node"])
        self.assertEqual(entry["precision"], "exact")
        self.assertEqual(entry["from"], utf16("\n".join(source.split("\n")[:7]) + "\n"))
        self.assertEqual(entry["to"], utf16(source))
        self.assertEqual(result["toc"][0]["name"], "Heading")

    def test_mapping_does_not_change_upstream_html(self):
        cases = [
            ">\n> [!NOTE]\n> Body",
            "Intro\n> [!tip]+ **Title**\n> Text\n>\n> More",
            "> [!note]\n> > [!warning]- Nested\n> > Text",
            "> [!example]\n> ```python\n> print(1)\n> ```",
            "> [!note] ### Heading\n> Body",
            "!!! note\n\n    > [!tip] Nested\n    > Body",
            "> First\n\n> Second",
        ]
        for text in cases:
            with self.subTest(text=text):
                _, extensions, configs, *_ = resolve({})
                expected = markdown.Markdown(extensions=extensions, extension_configs=configs, output_format="html").convert(text)
                self.assertEqual(re.sub(r' data-zn-node="\d+"', "", render({"text": text})["html"]), expected)

if __name__ == "__main__":
    unittest.main()
