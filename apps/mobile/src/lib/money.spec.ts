import { formatRupees, parseRupeesToPaise } from './money';

describe('formatRupees', () => {
  it.each([
    [0, '₹0'],
    [34900, '₹349'],
    [19900, '₹199'],
    [123456, '₹1,234.56'],
    [10000000, '₹1,00,000'],
    [3490050, '₹34,900.50'],
    [100, '₹1'],
    [5, '₹0.05'],
    [-2500, '-₹25'],
    [123456789, '₹12,34,567.89'],
  ])('%s paise -> %s', (paise, out) => expect(formatRupees(paise)).toBe(out));
});

describe('parseRupeesToPaise', () => {
  it.each([
    ['349', 34900],
    ['349.5', 34950],
    ['349.50', 34950],
    ['1,200', 120000],
    [' 75 ', 7500],
    ['0.05', 5],
  ])('%s -> %s', (input, paise) => expect(parseRupeesToPaise(input)).toBe(paise));

  it.each(['', 'abc', '12.345', '-5', '1e5', '12345678', '.5'])('rejects %s', (input) =>
    expect(parseRupeesToPaise(input)).toBeNull(),
  );
});
