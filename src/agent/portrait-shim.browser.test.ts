/**
 * AM37: the portrait shim in a real Chromium page. It runs from its serialised source, as
 * `scripting.executeScript({func})` would run it, against this page's own `screen` (headless
 * Chromium's screen is 800x600, so `landscape-primary`), and against stand-in screens for the cases a
 * real one cannot show here (a portrait screen, none, a frozen orientation, a foreign own `type`).
 *
 * - On a landscape screen it installs once: own `type` → `portrait-primary` and `angle` → 0 on the
 *   instance; a second injection finds its marker and changes nothing.
 * - Only when landscape: a portrait screen, no `screen.orientation`, and the read-only E2E mode
 *   (`install: false`) install nothing.
 * - SH-2: a page that broke a global the shim uses, or a getter that throws, reads `failed` (with the
 *   type if it can still be read, else null): the shim never throws out of executeScript.
 * - It leaves the prototype and everything else alone: the ScreenOrientation prototype getters,
 *   `screen.width/height`, `matchMedia('(orientation: …)')`, `window.orientation`, and it adds no
 *   symbol to the instance; it dispatches no event (`change`, `resize`, `orientationchange`).
 * - What it is for: the fake's model of Instagram's composer gate (`usePolarisDisplayProperties`,
 *   tools/fake-ig/client/orientation.ts) reads portrait once it is installed, while the session
 *   start's viewport check (+ → Story) reads exactly what it read before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  readLandscapeGate,
  screenOrientationType,
  sessionStartRejected,
} from '../../tools/fake-ig/client/orientation.ts';
import type { PageOrientation } from '../core/ig-contract/contract.ts';
import { portraitShim } from './portrait-shim.ts';

/** The shim as executeScript runs it: its source text, re-evaluated, with `install` as its only argument. */
const injected = new Function('install', `return (${portraitShim.toString()})(install);`) as (
  install: boolean,
) => PageOrientation;

const proto = ScreenOrientation.prototype;
const protoType = Object.getOwnPropertyDescriptor(proto, 'type');
const protoAngle = Object.getOwnPropertyDescriptor(proto, 'angle');
/** What the screen really reports, read through the prototype getter (immune to the shim). */
const realType = (): string => protoType?.get?.call(screen.orientation) as string;

afterEach(() => {
  // Undo the shim on this page's instance (its getters are configurable, like the native ones).
  const o = screen.orientation as unknown as Record<string, unknown>;
  delete o.type;
  delete o.angle;
});

describe('AM37 portrait shim (MAIN world, from its serialised source)', () => {
  it('the test page’s screen is landscape, as on the owner’s desktop', () => {
    expect(realType()).toMatch(/^landscape/);
    expect(screen.orientation.type).toBe(realType());
    expect(Object.getOwnPropertyDescriptor(screen.orientation, 'type')).toBeUndefined();
  });

  it('installs once on a landscape screen: type portrait-primary and angle 0, on the instance only', () => {
    const before = {
      width: screen.width,
      height: screen.height,
      mqLandscape: matchMedia('(orientation: landscape)').matches,
      mqPortrait: matchMedia('(orientation: portrait)').matches,
      windowOrientation: (window as Window & { orientation?: unknown }).orientation,
      real: realType(),
    };
    // It dispatches nothing: Instagram re-reads the type when its composer page mounts.
    let events = 0;
    const count = () => {
      events += 1;
    };
    screen.orientation.addEventListener('change', count);
    window.addEventListener('resize', count);
    window.addEventListener('orientationchange', count);
    expect(injected(true)).toEqual({ type: 'portrait-primary', shim: 'installed' });
    expect(screen.orientation.type).toBe('portrait-primary');
    expect(screen.orientation.angle).toBe(0);
    const own = Object.getOwnPropertyDescriptor(screen.orientation, 'type');
    expect(own).toMatchObject({ enumerable: true, configurable: true });
    expect(typeof own?.get).toBe('function');
    expect(Object.getOwnPropertyDescriptor(screen.orientation, 'angle')).toMatchObject({
      enumerable: true,
      configurable: true,
    });

    // Re-injection (every later load of the same document): a no-op that finds its marker.
    expect(injected(true)).toEqual({ type: 'portrait-primary', shim: 'present' });
    expect(Object.getOwnPropertyDescriptor(screen.orientation, 'type')?.get).toBe(own?.get);
    expect(injected(false)).toEqual({ type: 'portrait-primary', shim: 'present' });

    // Nothing else moved: the prototype, the screen's size, media queries, window.orientation.
    expect(Object.getOwnPropertyDescriptor(proto, 'type')).toEqual(protoType);
    expect(Object.getOwnPropertyDescriptor(proto, 'angle')).toEqual(protoAngle);
    expect(realType()).toBe(before.real);
    expect(screen.width).toBe(before.width);
    expect(screen.height).toBe(before.height);
    expect(matchMedia('(orientation: landscape)').matches).toBe(before.mqLandscape);
    expect(matchMedia('(orientation: portrait)').matches).toBe(before.mqPortrait);
    expect((window as Window & { orientation?: unknown }).orientation).toBe(before.windowOrientation);
    // Only the two accessors are own: the marker is not on the instance.
    expect(Object.getOwnPropertyNames(screen.orientation).sort()).toEqual(['angle', 'type']);
    expect(Object.getOwnPropertySymbols(screen.orientation)).toEqual([]);
    screen.orientation.removeEventListener('change', count);
    window.removeEventListener('resize', count);
    window.removeEventListener('orientationchange', count);
    expect(events).toBe(0);
  });

  it('install false (a guarded build’s E2E flag) only reads the type', () => {
    expect(injected(false)).toEqual({ type: realType(), shim: 'off' });
    expect(Object.getOwnPropertyNames(screen.orientation)).toEqual([]);
  });

  it('only when landscape: a portrait screen and a page without screen.orientation get nothing', () => {
    const portraitOrientation = Object.create({ type: 'portrait-primary', angle: 0 }) as ScreenOrientation;
    const portrait = { orientation: portraitOrientation } as unknown as Screen;
    expect(portraitShim(true, portrait)).toEqual({ type: 'portrait-primary', shim: 'portrait' });
    expect(Object.getOwnPropertyNames(portraitOrientation)).toEqual([]);
    const secondary = { orientation: Object.create({ type: 'portrait-secondary' }) } as unknown as Screen;
    expect(portraitShim(true, secondary)).toEqual({ type: 'portrait-secondary', shim: 'portrait' });
    expect(portraitShim(true, {} as Screen)).toEqual({ type: null, shim: 'absent' });
  });

  it('cannot install: a frozen orientation, or another own `type` already there, is left as it is', () => {
    const frozen = Object.freeze(Object.create({ type: 'landscape-primary', angle: 0 })) as ScreenOrientation;
    expect(portraitShim(true, { orientation: frozen } as unknown as Screen)).toEqual({
      type: 'landscape-primary',
      shim: 'failed',
    });
    expect(Object.getOwnPropertyNames(frozen)).toEqual([]);
    const foreign = { type: 'landscape-secondary', angle: 180 };
    expect(portraitShim(true, { orientation: foreign } as unknown as Screen)).toEqual({
      type: 'landscape-secondary',
      shim: 'failed',
    });
    expect(foreign).toEqual({ type: 'landscape-secondary', angle: 180 });
  });

  it('SH-2: whatever throws in the page reads `failed`, with the type when it can still be read, never an exception', () => {
    // A page that replaced a global the shim uses: the real (landscape) type is still read.
    const symbolFor = Symbol.for;
    Symbol.for = () => {
      throw new Error('page replaced Symbol.for');
    };
    try {
      expect(injected(true)).toEqual({ type: realType(), shim: 'failed' });
    } finally {
      Symbol.for = symbolFor;
    }
    expect(Object.getOwnPropertyNames(screen.orientation)).toEqual([]);
    const defineProperty = Object.defineProperty;
    Object.defineProperty = (() => {
      throw new Error('page replaced Object.defineProperty');
    }) as typeof Object.defineProperty;
    try {
      expect(injected(true)).toEqual({ type: realType(), shim: 'failed' });
    } finally {
      Object.defineProperty = defineProperty;
    }
    expect(Object.getOwnPropertyNames(screen.orientation)).toEqual([]);
    // A `type` getter that throws: nothing can be read, so the type is null (C3b unknown, fails closed).
    const throwing = Object.create({
      get type(): string {
        throw new Error('tampered');
      },
    }) as ScreenOrientation;
    expect(portraitShim(true, { orientation: throwing } as unknown as Screen)).toEqual({ type: null, shim: 'failed' });
    // So does a `screen.orientation` getter that throws.
    const noOrientation = {
      get orientation(): ScreenOrientation {
        throw new Error('tampered');
      },
    } as unknown as Screen;
    expect(portraitShim(true, noOrientation)).toEqual({ type: null, shim: 'failed' });
  });

  it('Instagram’s two readings, as the fake models them: the composer’s gate follows the shim, the session start does not', () => {
    // Before: the composer page (usePolarisDisplayProperties) reads the landscape screen.
    expect(readLandscapeGate('screen')).toMatchObject({ landscape: true, via: 'screen' });
    const viewportLandscape = innerWidth > innerHeight;
    const sessionRejected = sessionStartRejected();
    injected(true);
    expect(screenOrientationType()).toBe('portrait-primary');
    expect(readLandscapeGate('screen')).toMatchObject({
      landscape: false,
      via: 'screen',
      screenOrientation: 'portrait-primary',
    });
    // The viewport readings (the session start at + → Story, the `viewport` knob) are untouched by it.
    expect(sessionStartRejected()).toBe(sessionRejected);
    expect(readLandscapeGate('viewport').landscape).toBe(viewportLandscape);
  });
});
