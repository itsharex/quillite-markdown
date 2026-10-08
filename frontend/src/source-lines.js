// Preserve UTF-16 offsets and line endings without a whole-line regular
// expression. WebView's regexp engine can exhaust its stack on long lines.
export function* sourceLines(source) {
  let offset = 0;
  while (offset < source.length) {
    const newline = source.indexOf('\n', offset);
    const end = newline < 0 ? source.length : newline + 1;
    yield source.slice(offset, end);
    offset = end;
  }
}
