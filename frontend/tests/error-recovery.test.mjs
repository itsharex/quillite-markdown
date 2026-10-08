import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { exceedsAIInputLimit } from '../src/ai-input.js';
import { isMissingDocumentError } from '../src/library-state.js';

const source = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
function load(name, context) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:async )?function /);
  vm.runInContext(next < 0 ? rest : rest.slice(0, next + 1), context);
}

test('expected screenshot limits and export permissions are not submitted as software errors', () => {
  const context = vm.createContext({ isMissingDocumentError });
  for (const name of ['diagnosticErrorMessage', 'isExportAccessDeniedError', 'isExpectedOperationalError']) load(name, context);
  for (const [origin, message] of [
    ['document.open', 'DOCUMENT_TOO_LARGE: maximum supported document size is 64 MiB'],
    ['document.export-word', 'rename file.docx: Access is denied.'],
    ['ai.summary', 'AI_INPUT_TOO_LARGE: maximum supported AI input is 2,000,000 characters'],
    ['document.save', 'DOCUMENT_CONFLICT: The file doesn’t exist.']
  ]) assert.equal(context.isExpectedOperationalError(message, origin), true);
  assert.equal(context.isExpectedOperationalError('Maximum call stack size exceeded', 'frontend.promise'), false);
  assert.equal(context.isExpectedOperationalError('AI_EMPTY_REPLY: empty message', 'ai.summary'), false);
});

test('too-large summary is explained before settings, privacy scan or provider access', async () => {
  const toasts = [];
  const context = vm.createContext({
    state: { currentFile: { content: 'a'.repeat(2_000_001) } },
    exceedsAIInputLimit, showToast: (...args) => toasts.push(args), t: key => key,
    window: { quilliteMarkdown: { getAISettings() { throw new Error('must not request settings'); } } }
  });
  load('openAIDocumentSummary', context);
  await context.openAIDocumentSummary();
  assert.equal(toasts[0][0], 'aiInputTooLong');
});

test('Word export access denial shows retry guidance and keeps the export dialog available', async () => {
  const toasts = [];
  const context = vm.createContext({
    state: { currentFile: { path: 'document.md', name: 'document' } },
    renderedHTMLForExport: async () => '<p>content</p>',
    window: { quilliteMarkdown: { exportDOCX: async () => { throw new Error('rename stage destination: Access is denied.'); } } },
    showToast: (...args) => toasts.push(args), t: key => key,
    reportSilentError() { throw new Error('permission denial should be explained locally'); }
  });
  for (const name of ['diagnosticErrorMessage', 'isExportFileInUseError', 'isExportTooLargeError', 'isExportAccessDeniedError', 'exportWordDocument']) load(name, context);
  assert.equal(await context.exportWordDocument(), false);
  assert.equal(toasts[0][0], 'exportAccessDenied');
});

test('failed AI response clears partial stream output and keeps Apply disabled', async () => {
  const generateButton = { disabled: false, dataset: {}, textContent: '' };
  const applyButton = { disabled: true };
  let chunkCallback;
  let completedRequestID;
  const noOp = () => {};
  const context = vm.createContext({
    aiRewriteSelection: { markdown: 'source' }, aiRewriteRequest: 0,
    activeAIRewriteRequestID: '', aiRewriteStreaming: false, aiRewriteStreamCleanup: null,
    aiRewritePrivacyFindings: [], exceedsAIInputLimit,
    aiRewriteRequestText: () => 'source',
    els: { aiRewriteAction: { value: 'polish' }, aiInstruction: { value: 'edit' }, aiTargetLanguage: { value: 'English' },
      aiLengthField: { classList: { contains: () => true } },
      aiCloudConsent: { checked: true }, aiResultText: { value: '', readOnly: false },
      aiRewriteStatus: { textContent: '' } },
    $: id => id === '#generateAIRewrite' ? generateButton : applyButton,
    detectAISensitiveContent: () => [], renderAISendPrivacy: noOp,
    prepareAIContent: text => ({ text, replacements: [] }),
    setAISendPrivacyDisabled: noOp,
    clearAIRewriteDiff: () => { applyButton.disabled = true; },
    restoreAISensitiveContent: text => text, startAIRewriteProgress: noOp,
    stopAIRewriteProgress: noOp, reportSilentError: noOp,
    aiErrorMessage: error => error.message, t: key => key,
    window: { quilliteMarkdown: {
      onAIRewriteChunk: callback => { chunkCallback = callback; return noOp; },
      rewriteWithAI: async input => {
        completedRequestID = input.requestId;
        chunkCallback({ requestId: input.requestId, text: 'partial answer' });
        throw new Error('AI_RESPONSE_INCOMPLETE');
      }
    } }
  });
  load('stopAIRewriteStream', context);
  load('generateAIRewrite', context);
  await context.generateAIRewrite();
  assert.equal(context.els.aiResultText.value, '');
  assert.equal(applyButton.disabled, true);
  assert.equal(generateButton.disabled, false);
  assert.match(context.els.aiRewriteStatus.textContent, /AI_RESPONSE_INCOMPLETE/);
  chunkCallback({ requestId: completedRequestID, text: 'late partial' });
  assert.equal(context.els.aiResultText.value, '');
});
