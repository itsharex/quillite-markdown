export const MAX_AI_INPUT_CHARACTERS = 2_000_000;

// Match Go's rune count without allocating an array of every character.
export function exceedsAIInputLimit(text) {
  text = protectEmbeddedImages(text).text;
  if (text.length <= MAX_AI_INPUT_CHARACTERS) return false;
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (++count > MAX_AI_INPUT_CHARACTERS) return true;
    if (text.codePointAt(index) > 0xffff) index++;
  }
  return false;
}

export function embeddedImageRanges(text) {
  const result = [], header = /data:image\/[a-z0-9.+-]+;base64,/gi;
  for (let match; (match = header.exec(text));) {
    let end = header.lastIndex;
    while (end < text.length) {
      const code = text.charCodeAt(end);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 61)) break;
      end++;
    }
    if (end > header.lastIndex) result.push({ start: match.index, end, value: text.slice(match.index, end) });
    header.lastIndex = end;
  }
  return result;
}

export function protectEmbeddedImages(text) {
  const parts = [], replacements = []; let cursor = 0;
  for (const item of embeddedImageRanges(text)) {
    let placeholder = `QUILLITE_EMBEDDED_IMAGE_${replacements.length + 1}`;
    while (text.includes(placeholder)) placeholder = `_${placeholder}_`;
    parts.push(text.slice(cursor, item.start), placeholder); cursor = item.end;
    replacements.push({ placeholder, value: item.value });
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(''), replacements };
}

export function aiInputCharacterCount(text) {
  let count = 0;
  for (const character of protectEmbeddedImages(String(text || '')).text) count++;
  return count;
}
