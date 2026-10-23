export interface FrontMatterRange {
  contentFrom: number;
  closingFrom: number;
  to: number;
}

type FrontMatterInput = string | { readonly length: number; chunk(from: number): string };

function readLine(input: FrontMatterInput, from: number): { text: string; to: number } {
  if (typeof input === "string") {
    const next = input.indexOf("\n", from);
    const to = next < 0 ? input.length : next;
    return { text: input.slice(from, to), to };
  }
  let text = "", to = from;
  while (to < input.length) {
    const chunk = input.chunk(to);
    const next = chunk.indexOf("\n");
    if (next >= 0) return { text: text + chunk.slice(0, next), to: to + next };
    text += chunk;
    to += chunk.length;
  }
  return { text, to };
}

/** Only a closed block at the very start of a document is metadata. */
export function frontMatterRange(input: FrontMatterInput): FrontMatterRange | undefined {
  const first = readLine(input, 0);
  if (first.to === input.length || first.text.trim() !== "---") return;
  for (let from = first.to + 1; from <= input.length;) {
    const line = readLine(input, from);
    if (/^(?:---|\.\.\.)$/.test(line.text.trim()))
      return { contentFrom: first.to + 1, closingFrom: from, to: line.to };
    if (line.to === input.length) return;
    from = line.to + 1;
  }
}
