import { StateField, type EditorState, type Text, type Transaction } from "@codemirror/state";
import { DocInput } from "@codemirror/language";
import { frontMatterRange, type FrontMatterRange } from "./front-matter";

// null caches an absent or unfinished header as well as a positive boundary.
const boundaries = new WeakMap<Text, FrontMatterRange | null>();
function readBoundary(doc: Text): FrontMatterRange | null {
  const cached = boundaries.get(doc);
  if (cached !== undefined) return cached;
  const range = frontMatterRange(new DocInput(doc)) ?? null;
  boundaries.set(doc, range);
  return range;
}

function updateBoundary(previous: FrontMatterRange | null, tr: Transaction): FrontMatterRange | null {
  const doc = tr.newDoc, first = doc.line(1);
  if (doc.lines === 1 || first.text.trim() !== "---") return null;
  if (previous) {
    // Inserting at the closing line's end can invalidate the delimiter.
    return tr.changes.touchesRange(0, previous.to) ? readBoundary(doc) : previous;
  }
  if (tr.startState.doc.line(1).text.trim() !== "---") return readBoundary(doc);

  // The old header was unfinished: unchanged lines cannot contain a closer.
  // Inspect entire resulting lines, including both ends of a deletion/join.
  let closing: FrontMatterRange | null = null, scannedThrough = 1;
  tr.changes.iterChangedRanges((_fromA, _toA, from, to) => {
    if (closing) return;
    const start = Math.max(2, scannedThrough + 1, doc.lineAt(from).number);
    const end = doc.lineAt(to).number;
    if (start > end) return;
    let offset = doc.line(start).from;
    const lines = doc.iterLines(start, end + 1);
    for (let line = start; line <= end; line++) {
      const text = lines.next().value;
      if (/^(?:---|\.\.\.)$/.test(text.trim())) {
        closing = { contentFrom: first.to + 1, closingFrom: offset, to: offset + text.length };
        break;
      }
      offset += text.length + 1;
    }
    scannedThrough = end;
  });
  return closing;
}

export const frontMatterState = StateField.define<FrontMatterRange | null>({
  create: state => readBoundary(state.doc),
  update(previous, tr) {
    if (!tr.docChanged) return previous;
    const range = updateBoundary(previous, tr);
    boundaries.set(tr.newDoc, range);
    return range;
  },
});

export function editorFrontMatter(state: EditorState): FrontMatterRange | undefined {
  // Explicitly request the field so it is ready even when language parsing is
  // evaluated before support fields during EditorState creation/update.
  const cached = state.field(frontMatterState, false);
  return (cached === undefined ? readBoundary(state.doc) : cached) ?? undefined;
}
