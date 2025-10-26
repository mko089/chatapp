import { describe, expect, it } from 'vitest';
import { renderInlineValue } from './inlineFormat';

describe('renderInlineValue', () => {
  it('returns fallback for nullish values', () => {
    expect(renderInlineValue(null, 50, '{}')).toBe('{}');
    expect(renderInlineValue(undefined, 50, 'null')).toBe('null');
  });

  it('parses JSON strings and flattens whitespace', () => {
    const value = '{\n  "foo": { "bar": 1, "baz": [1, 2, 3] }\n}';
    expect(renderInlineValue(value, 100, '{}')).toBe('{"foo": {"bar": 1, "baz": [1, 2, 3]}}');
  });

  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(80);
    const result = renderInlineValue(long, 40, '{}');
    expect(result.startsWith('"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
  });

  it('limits object depth and entries', () => {
    const value = {
      deep: { deeper: { deepest: { value: 42 } } },
      list: Array.from({ length: 6 }, (_, idx) => idx),
    };

    expect(renderInlineValue(value, 200, '{}')).toBe('{"deep": {"deeper": {"deepest": {"value": …}}}, "list": [0, 1, 2, 3, …]}');
  });
});
