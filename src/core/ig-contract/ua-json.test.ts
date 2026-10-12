/**
 * U15 (strategy §7.11): parseIsMobile gives true, false, and 'unknown' when missing; it is
 * tolerant of whitespace and nesting and ignores non-JSON scripts. The same parser serves the
 * agent (one script's text) and contract:check (a whole document).
 */
import { describe, expect, it } from 'vitest';
import { parseIsMobile } from './ua-json.ts';

const doc = (...scripts: string[]) =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${scripts.join('\n')}</head><body></body></html>`;
const json = (text: string, attrs = 'type="application/json"') => `<script ${attrs}>${text}</script>`;

describe('U15 parseIsMobile', () => {
  it('reads true and false from a document', () => {
    expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"is_mobile":true}}')))).toBe(true);
    expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"is_mobile":false}}')))).toBe(false);
  });

  it('reads the text of one script (the agent path)', () => {
    expect(parseIsMobile('{"InstagramUserAgent":{"is_mobile":true}}')).toBe(true);
    expect(parseIsMobile('  {"InstagramUserAgent": {"is_mobile": false}}')).toBe(false);
  });

  it("is 'unknown' when the key, the flag or the script is missing", () => {
    expect(parseIsMobile(doc(json('{"Other":{"is_mobile":true}}')))).toBe('unknown');
    expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"ua":"x"}}')))).toBe('unknown');
    expect(parseIsMobile(doc())).toBe('unknown');
    expect(parseIsMobile('')).toBe('unknown');
    expect(parseIsMobile('{"is_mobile":true}')).toBe('unknown');
    expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"is_mobile":"true"}}')))).toBe('unknown');
  });

  it('tolerates whitespace, newlines and deep nesting', () => {
    const text = `{"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"define":[
      ["InstagramUserAgent", [], { "InstagramUserAgent" : { "is_ios" : false ,
        "is_mobile"
          :
        true } }, 1]]}}]]]}`;
    expect(parseIsMobile(doc(json(text)))).toBe(true);
    expect(parseIsMobile(text)).toBe(true);
  });

  it('tolerates escaped JSON (a JSON string inside JSON)', () => {
    expect(parseIsMobile(doc(json('{"payload":"{\\"InstagramUserAgent\\":{\\"is_mobile\\":true}}"}')))).toBe(true);
  });

  it('ignores non-JSON scripts, even when they mention the key first', () => {
    const js = '<script>window.x = {"InstagramUserAgent":{"is_mobile":false}};</script>';
    const typedJs = '<script type="text/javascript">({"InstagramUserAgent":{"is_mobile":false}})</script>';
    const ld = json('{"InstagramUserAgent":{"is_mobile":false}}', 'type="application/ld+json"');
    const real = json('{"InstagramUserAgent":{"is_mobile":true}}');
    expect(parseIsMobile(doc(js, typedJs, ld, real))).toBe(true);
    expect(parseIsMobile(doc(js, typedJs, ld))).toBe('unknown');
  });

  it('takes the first JSON script that contains the key, skipping earlier JSON without it', () => {
    const other = json('{"config":{"is_mobile":false}}');
    const first = json('{"InstagramUserAgent":{"is_mobile":true}}');
    const second = json('{"InstagramUserAgent":{"is_mobile":false}}');
    expect(parseIsMobile(doc(other, first, second))).toBe(true);
  });

  it('reads is_mobile after the key, not an unrelated one before it', () => {
    expect(parseIsMobile('{"a":{"is_mobile":false},"InstagramUserAgent":{"is_mobile":true}}')).toBe(true);
  });

  it('accepts attribute variants: quotes, case, extra attributes', () => {
    const variants = [
      "type='application/json'",
      'type=application/json',
      'TYPE="Application/JSON"',
      'data-content-len="42" type="application/json" data-sjs nonce="abc"',
      'type = " application/json "',
    ];
    for (const attrs of variants) {
      expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"is_mobile":true}}', attrs)))).toBe(true);
    }
    // `data-type` is not `type`.
    expect(parseIsMobile(doc(json('{"InstagramUserAgent":{"is_mobile":true}}', 'data-type="application/json"')))).toBe(
      'unknown',
    );
  });
});
