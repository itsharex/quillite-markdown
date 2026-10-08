import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLines } from '../src/source-lines.js';
import { findEditableDiagramFenceAt } from '../src/diagram-editing.js';
import { findCanvasDiagramFenceAt } from '../src/flowchart-designer.js';
import { scanMarkdownFormulas } from '../src/formula-editing.js';
import { nextFootnoteNumber } from '../src/markdown-formats.js';

test('source line scanning preserves exact offsets, CRLF, emoji and empty lines', () => {
  assert.deepEqual([...sourceLines('a😀\r\n\n末尾')], ['a😀\r\n', '\n', '末尾']);
  assert.deepEqual([...sourceLines('')], []);
  assert.deepEqual([...sourceLines('a\n')], ['a\n']);
});

test('diagram lookup handles very long single lines followed by a CRLF diagram', () => {
  const prefix = 'x'.repeat(16 * 1024 * 1024) + '\r\n';
  const source = prefix + '```mermaid\r\nflowchart LR\r\nA-->B\r\n```';
  for (const lookup of [findEditableDiagramFenceAt, findCanvasDiagramFenceAt]) {
    assert.equal(lookup(source, 0), null);
    const range = lookup(source, prefix.length + 20);
    assert.equal(range.from, prefix.length);
    assert.equal(range.to, source.length);
    assert.equal(range.source.replace(/\r\n/g, '\n'), 'flowchart LR\nA-->B');
  }
});

test('formula scanning keeps UTF-16 offsets after emoji and a fenced example', () => {
  const markdown = '😀\n```text\n😀$ignore$\n```\n文本 $x+1$';
  const result = scanMarkdownFormulas(markdown);
  assert.equal(result.length, 1);
  assert.equal(result[0].from, markdown.indexOf('$x+1$'));
  assert.equal(markdown.slice(result[0].from, result[0].to), '$x+1$');
  assert.equal(scanMarkdownFormulas('x'.repeat(1024 * 1024) + ' $a$')[0].source, 'a');
});

test('footnote numbering does not spread unbounded arguments', () => {
  assert.equal(nextFootnoteNumber('[^1] '.repeat(150000) + '[^37]'), 38);
});
