export const EMPTY_DRAWIO_XML =
  '<mxfile host="znote"><diagram id="diagram-1" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export function isValidDrawioXml(xml: string): boolean {
  const normalized = xml.trim().replace(/^<\?xml[^?]*\?>\s*/i, "");
  const root = normalized.match(/^(?:<!--[^]*?-->\s*)*<(mxfile|mxGraphModel)\b/i)?.[1];
  if (!root) return false;
  return new RegExp(`<\\/${root}\\s*>\\s*$`, "i").test(normalized);
}
