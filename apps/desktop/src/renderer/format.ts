/**
 * Small, dependency-free save formatter for the custom editor.
 *
 * JSON is pretty-printed; every other language gets trailing whitespace
 * removed and a final newline. This is intentionally conservative: it never
 * rewrites code it does not understand.
 */
export function formatDocumentContent(name: string, content: string): string {
  const trimmed = content.replace(/[ \t]+$/gm, '');
  if (/\.json$/i.test(name)) {
    try {
      return `${JSON.stringify(JSON.parse(trimmed), null, 2)}\n`;
    } catch {
      return withFinalNewline(trimmed);
    }
  }
  return withFinalNewline(trimmed);
}

function withFinalNewline(value: string): string {
  if (value.length === 0) return '';
  return value.endsWith('\n') ? value : `${value}\n`;
}
