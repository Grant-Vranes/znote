import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";

// Shared semantics retain the same colors across Markdown and embedded languages.
// Language-specific meanings of broad tags belong in a scoped style below.
const sharedHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.keyword, tags.atom, tags.bool, tags.unit], class: "zn-syntax-keyword" },
  { tag: [tags.literal, tags.number, tags.color], class: "zn-syntax-number" },
  { tag: [tags.string, tags.attributeValue, tags.regexp, tags.escape, tags.inserted], class: "zn-syntax-string" },
  { tag: [tags.typeName, tags.namespace, tags.tagName], class: "zn-syntax-tag" },
  { tag: [tags.className, tags.labelName, tags.definition(tags.variableName)], class: "zn-syntax-selector" },
  { tag: [tags.meta, tags.contentSeparator, tags.processingInstruction], class: "zn-syntax-meta" },
  { tag: tags.comment, class: "zn-syntax-comment" },
  { tag: [tags.link, tags.url], class: "zn-syntax-link" },
  { tag: [tags.invalid, tags.deleted], class: "zn-syntax-invalid" },
]);

// These tags also describe Markdown prose and HTML/CSS/JavaScript properties.
// Restrict YAML scalar/key colors to the YAML tree, including nested mappings.
const yamlHighlightStyle = HighlightStyle.define([
  { tag: tags.content, class: "zn-syntax-string" },
  { tag: tags.propertyName, class: "zn-syntax-selector" },
], { scope: yamlLanguage });

// One source of truth for the editor extensions and syntax-tree consumers.
// Semantic CSS classes let theme changes update colors without rebuilding these.
export const editorHighlighters = [sharedHighlightStyle, yamlHighlightStyle] as const;
export const editorSyntaxHighlighting = editorHighlighters.map(style => syntaxHighlighting(style));
