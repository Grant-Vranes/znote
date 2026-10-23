import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { DocInput, Language, LanguageSupport, ParseContext } from "@codemirror/language";
import { Parser, TreeFragment, parseMixed, type Input, type PartialParse } from "@lezer/common";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig, MarkdownParser } from "@lezer/markdown";
import { frontMatterRange, type FrontMatterRange } from "./front-matter";
import { editorFrontMatter, frontMatterState } from "./editor-front-matter";

function boundary(input: Input) {
  const state = ParseContext.get()?.state;
  return state && input instanceof DocInput && input.doc === state.doc
    ? editorFrontMatter(state) : frontMatterRange(input);
}

const ranges = new WeakMap<PartialParse, FrontMatterRange>();
const htmlSupport = html({ matchClosingTags: false });
const mixed = parseMixed(node => {
  if (node.name === "FrontMatterContent") return { parser: yamlLanguage.parser };
  if (node.name !== "HTMLBlock" && node.name !== "HTMLTag" && node.name !== "CommentBlock") return null;
  // Match @lezer/markdown's parseCode HTML ranges: exclude Markdown children
  // such as quote/list markers from the input passed to the HTML parser.
  const overlay = [];
  let from = node.from;
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (from < child.from) overlay.push({ from, to: child.from });
    from = child.to;
  }
  if (from < node.to) overlay.push({ from, to: node.to });
  return { parser: htmlSupport.language.parser, overlay };
});

const frontMatter: MarkdownConfig = {
  defineNodes: [
    { name: "FrontMatter", block: true },
    { name: "FrontMatterMark", style: tags.meta },
    "FrontMatterContent",
  ],
  wrap(inner, input, fragments, parseRanges) {
    const range = boundary(input);
    if (range) ranges.set(inner, range);
    return mixed(inner, input, fragments, parseRanges);
  },
  parseBlock: [{
    name: "FrontMatter",
    before: "IndentedCode",
    parse(cx) {
      const range = ranges.get(cx);
      if (cx.lineStart !== 0 || !range) return false;
      const children = [cx.elt("FrontMatterMark", 0, range.contentFrom - 1)];
      if (range.contentFrom < range.closingFrom)
        children.push(cx.elt("FrontMatterContent", range.contentFrom, range.closingFrom));
      children.push(cx.elt("FrontMatterMark", range.closingFrom, range.to));
      while (cx.lineStart < range.closingFrom && cx.nextLine()) { /* consume YAML */ }
      cx.addElement(cx.elt("FrontMatter", 0, range.to, children));
      cx.nextLine();
      return true;
    },
  }],
};

// Use one mixed pass for YAML and HTML. Calling markdown({ base }) here would
// add a second HTML wrapper and repeat fragment/tree checks on every body edit.
const markdownParser = (markdownLanguage.parser as MarkdownParser).configure(frontMatter);
class NoteParser extends Parser {
  createParse(input: Input, fragments: readonly TreeFragment[], parseRanges: readonly { from: number; to: number }[]) {
    const start = fragments.find(fragment => fragment.from === 0);
    const first = start?.tree.topNode.childAfter(start.offset);
    if (first) {
      const range = boundary(input);
      const oldEnd = first.name === "FrontMatter" && first.from === start!.offset
        ? first.to - start!.offset : 0;
      // A closer added far from the start can turn previously reusable Markdown
      // into metadata. Invalidate that prefix, but retain unaffected body trees.
      // If the first block already intersects an edit, Markdown will rebuild
      // it; keep its fragments so YAML can still reuse unchanged inner nodes.
      const reusable = first.from === start!.offset && start!.to >= first.to - start!.offset;
      if ((range && !oldEnd) || (reusable && oldEnd !== (range?.to ?? 0))) {
        const end = Math.min(input.length, Math.max(oldEnd, range?.to ?? 0));
        fragments = TreeFragment.applyChanges(fragments, [{ fromA: 0, toA: end, fromB: 0, toB: end }], 0);
      }
    }
    return markdownParser.startParse(input, fragments, parseRanges);
  }
}
const base = new Language(markdownLanguage.data, new NoteParser(), [], "markdown");
// Retain the upstream folding, keymap, paste-URL and HTML completion support.
// Both languages share markdownLanguage.data, including its completion facet.
const support = markdown({ base: markdownLanguage, htmlTagLanguage: htmlSupport }).support;
export const noteLanguage = new LanguageSupport(base, [frontMatterState, support]);
