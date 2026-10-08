import { embeddedImageRanges } from './ai-input.js';
const SENSITIVE_PATTERNS = [
  { type: 'apiKey', pattern: /\b(?:sk|ak)-[A-Za-z0-9_.-]{12,}\b/g },
  { type: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'idNumber', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { type: 'phone', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'bankCard', pattern: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g }
];

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function maskedValue(type, value) {
  if (type === 'email') {
    const [name, domain = ''] = value.split('@');
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  const compact = value.replace(/[ -]/g, '');
  if (type === 'phone') return `${compact.slice(0, 3)}••••${compact.slice(-4)}`;
  if (type === 'idNumber') return `${compact.slice(0, 6)}••••••••${compact.slice(-4)}`;
  return `${compact.slice(0, 4)}••••••••${compact.slice(-4)}`;
}

export function detectAISensitiveContent(text = '') {
  const source = String(text || '');
  const candidates = [];
  const images = embeddedImageRanges(source);
  for (const { type, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const value = match[0];
      if (images.some(image => match.index < image.end && match.index + value.length > image.start)) continue;
      candidates.push({ type, value, masked: maskedValue(type, value), start: match.index, end: match.index + value.length });
    }
  }
  candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.some(item => overlaps(item, candidate))) continue;
    accepted.push({ ...candidate, id: `private-${accepted.length + 1}`, selected: true });
  }
  return accepted;
}

export function redactAISensitiveContent(text = '', findings = []) {
  const source = String(text || '');
  const selected = findings.filter(item => item?.selected && Number.isInteger(item.start) && Number.isInteger(item.end))
    .sort((left, right) => right.start - left.start);
  const replacements = [];
  let redacted = source;
  selected.forEach((item, reverseIndex) => {
    const number = selected.length - reverseIndex;
    let placeholder = `⟦QUILLITE_PRIVATE_${number}⟧`;
    while (source.includes(placeholder)) placeholder = `_${placeholder}_`;
    redacted = redacted.slice(0, item.start) + placeholder + redacted.slice(item.end);
    replacements.push({ placeholder, value: item.value });
  });
  return { text: redacted, replacements };
}

export function restoreAISensitiveContent(text = '', replacements = []) {
  let restored = String(text || '');
  for (const item of replacements) {
    const count = restored.split(item.placeholder).length - 1;
    if (restored.length + count * (item.value.length - item.placeholder.length) > 64 * 1024 * 1024) throw new Error('AI_RESPONSE_TOO_LARGE');
    restored = restored.split(item.placeholder).join(item.value);
  }
  if (new TextEncoder().encode(restored).length > 64 * 1024 * 1024) throw new Error('AI_RESPONSE_TOO_LARGE');
  return restored;
}

export function restoreAISuggestions(suggestions = [], replacements = []) {
  let total = 0;
  return (Array.isArray(suggestions) ? suggestions : []).map(suggestion => {
    const restored = {
    ...suggestion,
    original: restoreAISensitiveContent(suggestion?.original, replacements),
    replacement: restoreAISensitiveContent(suggestion?.replacement, replacements),
    reason: restoreAISensitiveContent(suggestion?.reason, replacements)
    };
    total += new TextEncoder().encode(restored.original).length + new TextEncoder().encode(restored.replacement).length + new TextEncoder().encode(restored.reason).length;
    if (total > 64 * 1024 * 1024) throw new Error('AI_RESPONSE_TOO_LARGE');
    return restored;
  });
}
