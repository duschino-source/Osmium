// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatDocumentContent } from '../renderer/format.js';

describe('formatDocumentContent', () => {
  it('pretty-prints JSON and adds a final newline', () => {
    expect(formatDocumentContent('settings.json', '{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n',
    );
  });

  it('trims trailing whitespace but leaves invalid JSON alone', () => {
    expect(formatDocumentContent('broken.json', '{ nope   \n  ')).toBe('{ nope\n');
  });

  it('trims trailing whitespace and adds a final newline for code', () => {
    expect(formatDocumentContent('main.ts', 'const a = 1;   \nconst b = 2;')).toBe(
      'const a = 1;\nconst b = 2;\n',
    );
  });
});
