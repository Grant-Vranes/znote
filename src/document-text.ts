import { Text } from "@codemirror/state";

/** Keep edits as persistent text; materialize one string only when consumed. */
export class DocumentText {
  doc: Text;
  private serialized: string | undefined;
  private baseline: { text: string; doc: Text };

  constructor(text: string) {
    this.doc = Text.of(text.split("\n"));
    this.serialized = text;
    this.baseline = { text, doc: this.doc };
  }
  get text(): string { return this.serialized ??= this.doc.toString(); }
  set text(text: string) {
    this.doc = Text.of(text.split("\n"));
    this.serialized = text;
    this.baseline = { text, doc: this.doc };
  }
  update(doc: Text) {
    if (doc === this.doc) return;
    this.doc = doc;
    this.serialized = undefined;
  }
  matches(text: string): boolean {
    if (this.doc.length !== text.length) return false;
    if (this.baseline.text !== text)
      this.baseline = { text, doc: text === this.serialized ? this.doc : Text.of(text.split("\n")) };
    return this.doc.eq(this.baseline.doc);
  }
}
