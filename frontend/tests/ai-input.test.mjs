import test from 'node:test';
import assert from 'node:assert/strict';
import { exceedsAIInputLimit, MAX_AI_INPUT_CHARACTERS } from '../src/ai-input.js';

test('AI input limits count Unicode characters consistently with the backend', () => {
  assert.equal(exceedsAIInputLimit('文'.repeat(MAX_AI_INPUT_CHARACTERS)), false);
  assert.equal(exceedsAIInputLimit('文'.repeat(MAX_AI_INPUT_CHARACTERS + 1)), true);
  assert.equal(exceedsAIInputLimit('😀'.repeat(MAX_AI_INPUT_CHARACTERS)), false);
  assert.equal(exceedsAIInputLimit('😀'.repeat(MAX_AI_INPUT_CHARACTERS) + 'a'), true);
  assert.equal(exceedsAIInputLimit('\ud800'.repeat(MAX_AI_INPUT_CHARACTERS + 1)), true);
});
