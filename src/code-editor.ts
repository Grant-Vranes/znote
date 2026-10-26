import {
  bracketMatching,
  indentOnInput,
  LanguageDescription,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { editorSyntaxHighlighting } from "./editor-theme";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { EditorState, Compartment } from "@codemirror/state";
import { closeSearchPanel, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";

const lightTheme = EditorView.theme({}, { dark: false });
const darkTheme = EditorView.theme({}, { dark: true });

export interface CodeEditorCallbacks {
  change(text: string): void;
  cursor?(): void;
  save(): void;
}

const languages = [
  LanguageDescription.of({
    name: "TypeScript",
    extensions: ["ts", "tsx", "mts", "cts"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    extensions: ["js", "mjs", "cjs", "jsx"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "JSON",
    extensions: ["json", "jsonc", "json5"],
    load: async () => (await import("@codemirror/lang-json")).json(),
  }),
  LanguageDescription.of({
    name: "HTML",
    extensions: ["html", "htm"],
    load: async () => (await import("@codemirror/lang-html")).html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css", "scss", "sass", "less"],
    load: async () => (await import("@codemirror/lang-css")).css(),
  }),
  LanguageDescription.of({
    name: "XML",
    extensions: ["xml", "xsd", "xsl", "svg"],
    load: async () => (await import("@codemirror/lang-xml")).xml(),
  }),
  LanguageDescription.of({
    name: "YAML",
    extensions: ["yaml", "yml"],
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  }),
  LanguageDescription.of({
    name: "Python",
    extensions: ["py", "pyw"],
    load: async () => (await import("@codemirror/lang-python")).python(),
  }),
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load: async () => (await import("@codemirror/lang-rust")).rust(),
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load: async () => (await import("@codemirror/lang-sql")).sql(),
  }),
];

export class CodeEditor {
  readonly view: EditorView;
  languageName = "Plain Text";
  private readonly language = new Compartment();
  private readonly appearance = new Compartment();

  constructor(
    parent: HTMLElement,
    text: string,
    filename: string,
    callbacks: CodeEditorCallbacks,
  ) {
    const languageDescription = LanguageDescription.matchFilename(languages, filename);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          this.language.of([]),
          this.appearance.of(parent.ownerDocument.documentElement.dataset.theme === "dark" ? darkTheme : lightTheme),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          highlightActiveLine(),
          editorSyntaxHighlighting,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": `${filename} editor`,
            spellcheck: "false",
            autocapitalize: "off",
          }),
          keymap.of([
            { key: "Mod-s", run: () => { callbacks.save(); return true; } },
            { key: "Escape", run: (view) => closeSearchPanel(view) },
            { key: "Mod-/", run: toggleComment },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.change(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) callbacks.cursor?.();
          }),
        ],
      }),
    });
    this.view.dom.dataset.filename = filename;
    this.view.dom.dataset.language = this.languageName;
    if (languageDescription) {
      void languageDescription.load().then((support) => {
        if (!this.view.dom.isConnected) return;
        this.view.dispatch({ effects: this.language.reconfigure(support) });
        this.languageName = languageDescription.name;
        this.view.dom.dataset.language = this.languageName;
      }).catch(() => {
        this.languageName = "Plain Text";
      });
    }
  }

  flush(): string {
    return this.view.state.doc.toString();
  }

  focus(): void {
    this.view.focus();
  }

  setColorMode(mode: "light" | "dark"): void {
    const theme = mode === "dark" ? darkTheme : lightTheme;
    if (this.view.state.facet(EditorView.darkTheme) !== (mode === "dark"))
      this.view.dispatch({ effects: this.appearance.reconfigure(theme) });
  }

  jump(position: number): void {
    const pos = Math.max(0, Math.min(position, this.view.state.doc.length));
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
