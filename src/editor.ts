import { isImageFile } from "./image-settings";
import { tr, onLanguageChange } from "./i18n";
import { EditorState, Compartment, type Text } from "@codemirror/state";
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { noteLanguage } from "./editor-language";
import { bracketMatching, indentOnInput, syntaxTree } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches, closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { editorSyntaxHighlighting } from "./editor-theme";
import { editorCommands } from "./editor-command-registry";
import { applyEditorTransaction, blockStyleTransaction, inlineStyleTransaction, type InlineStyle, type BlockStyle } from "./editor-commands";

const lightTheme = EditorView.theme({}, { dark: false });
const darkTheme = EditorView.theme({}, { dark: true });

export interface EditorCallbacks {
  change: (doc: Text) => void;
  cursor: () => void;
  scroll?: (line: number) => void;
  save: () => void;
  image: (file: File) => void;
  images?: (files: File[]) => void;
  command?: (action: string) => void;
  formatting?: () => void;
}

/** One lossless Markdown source editor, reused in edit and split views. */
export class NoteEditor {
  readonly view: EditorView;
  private scrollIntent = false;
  private readonly locale = new Compartment();
  private readonly appearance = new Compartment();
  private readonly disposeLanguage: () => void;
  private localeExtensions() {
    return [
      EditorState.phrases.of({
        Find: tr("查找"), Replace: tr("替换"), next: tr("下一个"), previous: tr("上一个"),
        all: tr("全选"), "match case": tr("区分大小写"), regexp: tr("正则"),
        "by word": tr("全词"), replace: tr("替换"), "replace all": tr("全部替换"), close: tr("关闭"),
      }),
      placeholder(tr("写下你的第一个想法…")),
      EditorView.contentAttributes.of({"aria-label": tr("Markdown 编辑器"), spellcheck: "false", autocapitalize: "off"}),
    ];
  }
  constructor(parent: HTMLElement, text: string | Text, callbacks: EditorCallbacks) {
    const shortcuts = [
      ...editorCommands.filter(command => command.key).map(command => ({key: command.key!, run: (view: EditorView) => {
        if (callbacks.command) { callbacks.command(command.id); return true; }
        return command.transaction ? applyEditorTransaction(view, command.transaction(view.state)) : false;
      }})),
      { key: "Mod-s", run: () => { callbacks.save(); return true; } },
      { key: "Mod-/", run: toggleComment },
    ];
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          this.locale.of(this.localeExtensions()),
          this.appearance.of(parent.ownerDocument.documentElement.dataset.theme === "dark" ? darkTheme : lightTheme),
          noteLanguage, history(), drawSelection(), dropCursor(), indentOnInput(),
          bracketMatching(), closeBrackets(), highlightSelectionMatches(), highlightActiveLine(),
          editorSyntaxHighlighting,
          EditorView.lineWrapping,
          keymap.of([...shortcuts, ...markdownKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.change(update.state.doc);
            if (update.selectionSet || update.docChanged) {
              this.scrollIntent = false;
              callbacks.cursor();
            }
            else if (syntaxTree(update.startState) !== syntaxTree(update.state)) callbacks.formatting?.();
          }),
          EditorView.domEventHandlers({
            wheel: () => { this.scrollIntent = true; },
            touchmove: () => { this.scrollIntent = true; },
            pointerdown: () => { this.scrollIntent = true; },
            keydown: () => { this.scrollIntent = false; },
            scroll: (_event, view) => {
              if (!this.scrollIntent) return;
              const y = view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.clientHeight * 0.28;
              const block = view.lineBlockAtHeight(y - view.documentTop);
              callbacks.scroll?.(view.state.doc.lineAt(block.from).number);
            },
            paste: event => {
              const files = Array.from(event.clipboardData?.files || []).filter(isImageFile);
              if (!files.length) return false;
              event.preventDefault();
              if (callbacks.images) callbacks.images(files);
              else files.forEach(callbacks.image);
              return true;
            },
            drop: (event, view) => {
              const files = Array.from(event.dataTransfer?.files || []).filter(isImageFile);
              if (!files.length) return false;
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) view.dispatch({ selection: { anchor: pos } });
              if (callbacks.images) callbacks.images(files);
              else files.forEach(callbacks.image);
              return true;
            },
          }),
        ],
      }),
    });
    this.disposeLanguage = onLanguageChange(() => {
      const focused = this.view.dom.ownerDocument.activeElement as HTMLElement | null;
      const searching = !!this.view.dom.querySelector(".cm-search");
      if (searching) closeSearchPanel(this.view);
      this.view.dispatch({ effects: this.locale.reconfigure(this.localeExtensions()) });
      if (searching) openSearchPanel(this.view);
      if (focused?.isConnected && !this.view.dom.contains(focused)) focused.focus({ preventScroll: true });
    });
  }
  setColorMode(mode: "light" | "dark") {
    const dark = mode === "dark";
    if (this.view.state.facet(EditorView.darkTheme) !== dark) {
      this.view.dispatch({ effects: this.appearance.reconfigure(dark ? darkTheme : lightTheme) });
    }
  }
  insert(text: string) {
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true});
    this.view.focus();
  }
  jump(from: number) {
    const pos = Math.min(from, this.view.state.doc.length);
    this.view.dispatch({selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 60 })});
    this.view.focus();
  }
  revealLine(line: number) {
    // Keep viewport-only transactions from echoing back into the preview.
    // A new editor scroll gesture takes control again.
    this.scrollIntent = false;
    const doc = this.view.state.doc;
    const pos = doc.line(Math.max(1, Math.min(line, doc.lines))).from;
    this.view.dispatch({effects: EditorView.scrollIntoView(pos, {
      y: "start", yMargin: this.view.scrollDOM.clientHeight * 0.28,
    })});
  }
  destroy() { this.disposeLanguage(); this.view.destroy(); }
}

export function wrap(view: EditorView, mark: string) {
  const style = ({ "**": "bold", "*": "italic", "`": "inline-code", "~~": "strikethrough" } as Record<string, InlineStyle>)[mark];
  if (style) return applyEditorTransaction(view, inlineStyleTransaction(view.state, style));
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({changes: { from, to, insert: mark + text + mark }, selection: { anchor: from + mark.length, head: to + mark.length }, scrollIntoView: true});
  view.focus();
  return true;
}

/** Prefix complete selected lines without discarding their source text. */
export function prefixLines(view: EditorView, prefix: string) {
  const style = ({ "# ": "heading-1", "> ": "quote", "- ": "list", "- [ ] ": "task" } as Record<string, BlockStyle>)[prefix];
  if (style) return applyEditorTransaction(view, blockStyleTransaction(view.state, style));
  const selection = view.state.selection.main;
  const start = view.state.doc.lineAt(selection.from).from;
  const last = selection.empty || selection.to !== view.state.doc.lineAt(selection.to).from
    ? selection.to : selection.to - 1;
  const end = view.state.doc.lineAt(last).to;
  const old = view.state.sliceDoc(start, end);
  const lines = old.split("\n");
  const removing = lines.every(line => line.startsWith(prefix));
  const updated = lines.map(line => removing ? line.slice(prefix.length) : prefix + line).join("\n");
  const shift = removing ? -prefix.length : prefix.length;
  const cursor = Math.max(start, selection.head + shift);
  const range = selection.empty ? { anchor: cursor } : selection.anchor <= selection.head
    ? { anchor: start, head: start + updated.length }
    : { anchor: start + updated.length, head: start };
  view.dispatch({changes: { from: start, to: end, insert: updated }, selection: range, scrollIntoView: true});
  view.focus();
  return true;
}
