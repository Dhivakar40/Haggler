import { formatIndianPhone, normalizeIndianPhone } from './phone';

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['91 9876543210', '+919876543210'],
    ['(+91) 98765-43210', '+919876543210'],
  ])('%s -> %s', (input, expected) => expect(normalizeIndianPhone(input)).toBe(expected));

  it.each(['', '12345', '5876543210', '98765432101', 'abcdefghij', '+1 202 555 0100'])(
    'rejects %s',
    (input) => expect(normalizeIndianPhone(input)).toBeNull(),
  );
});

it('formats for display', () => {
  expect(formatIndianPhone('+919876543210')).toBe('+91 98765 43210');
  expect(formatIndianPhone('garbage')).toBe('garbage');
});
