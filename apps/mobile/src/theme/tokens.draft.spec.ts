import { contrastRatio, type ColorTokens } from './tokens';
import { draftDarkColors, draftLightColors } from './tokens.draft';

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
  ['draft light', draftLightColors],
  ['draft dark', draftDarkColors],
])('%s palette', (_name, colors) => {
  it.each(textPairs)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA);
  });
});
