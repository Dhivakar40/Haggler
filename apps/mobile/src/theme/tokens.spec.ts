import {
  contrastRatio,
  darkColors,
  lightColors,
  MIN_TOUCH_TARGET,
  type ColorTokens,
} from './tokens';

const AA = 4.5;

const textPairs: [keyof ColorTokens, keyof ColorTokens][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['onPrimary', 'primary'],
  ['onDanger', 'danger'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s palette', (_name, colors) => {
  it.each(textPairs)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});

it('touch target is at least 48dp', () => {
  expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
});
