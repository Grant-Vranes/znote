import { getLanguage, tr } from "./i18n";

const labels: Record<string, string> = {
  title: "文档标题", description: "摘要", date: "日期", authors: "作者", author: "作者",
  tags: "标签", categories: "分类",
};
const listFields = new Set(["authors", "author", "tags", "categories"]);
const labelOrder = Object.keys(labels);
const rank = (key: string) => { const i = labelOrder.indexOf(key); return i < 0 ? labelOrder.length : i; };
const panelSignatures = new WeakMap<Element, string>();

/** App-owned labels only: metadata values must never enter the UI translator. */
export function localizeDocumentProperties(root: Element) {
  root.querySelectorAll<HTMLElement>(".znote-document-properties [data-property-label]")
    .forEach(label => { label.textContent = tr(label.dataset.propertyLabel!); });
}

export function documentProperties(doc: Document, meta: Record<string, unknown>, previous?: Element | null) {
  const entries = Object.entries(meta || {});
  if (!entries.length) return;
  // Results cross IPC as fresh objects, so compare content rather than identity.
  // A reused panel must remain attached until the caller commits the render.
  const signature = JSON.stringify([getLanguage(), meta]);
  if (previous?.ownerDocument === doc && panelSignatures.get(previous) === signature) return previous;
  const expanded = new Set(Array.from(previous?.querySelectorAll<HTMLDetailsElement>("details[open]") || [],
    details => details.dataset.propertyKey));
  const panel = doc.createElement("aside");
  panel.className = "znote-document-properties";
  const details = doc.createElement("details");
  details.dataset.propertyKey = "";
  details.open = expanded.has("");
  const summary = doc.createElement("summary");
  const label = (key: string) => {
    const element = doc.createElement("span");
    element.dataset.propertyLabel = key;
    element.textContent = tr(key);
    return element;
  };
  summary.append(label("文档属性"));
  const count = doc.createElement("span");
  count.className = "znote-property-count";
  count.textContent = String(entries.length);
  summary.append(count);
  const properties = doc.createElement("dl");
  entries.sort(([a], [b]) => rank(a) - rank(b));
  for (const [key, value] of entries) {
    const name = doc.createElement("dt");
    name.title = key;
    if (Object.hasOwn(labels, key)) name.append(label(labels[key]));
    else name.textContent = key;
    const content = doc.createElement("dd");
    if (Array.isArray(value) && listFields.has(key) && value.every(item => typeof item === "string")) {
      content.className = "znote-property-tokens";
      for (const item of value) {
        const token = doc.createElement("span");
        token.textContent = item;
        content.append(token);
      }
      if (!value.length) content.textContent = "[]";
    } else if (value !== null && typeof value === "object") {
      const nested = doc.createElement("details");
      nested.dataset.propertyKey = key;
      nested.open = expanded.has(key);
      const toggle = doc.createElement("summary");
      toggle.append(label("展开内容"));
      const pre = doc.createElement("pre");
      pre.textContent = JSON.stringify(value, null, 2);
      nested.append(toggle, pre);
      content.append(nested);
    } else {
      content.textContent = value === null ? "null" : String(value);
      if (key === "title") content.className = "znote-property-title";
    }
    properties.append(name, content);
  }
  details.append(summary, properties);
  panel.append(details);
  panelSignatures.set(panel, signature);
  return panel;
}
