import { formatRupees } from '../lib/money';
import { Text, type TextProps } from './Text';

interface PriceTagProps {
  paise: number;
  /** `default` is a confirmed/current price (heading weight); `muted` is a reference/estimate
   * figure sitting next to one (e.g. a price-band range next to an agreed price). */
  variant?: 'default' | 'muted';
  testID?: string;
}

/** The one money-rendering component — always routes through lib/money.ts's formatRupees so a
 * price never gets formatted two different ways in two different screens. */
export function PriceTag({ paise, variant = 'default', testID }: PriceTagProps) {
  const props: TextProps =
    variant === 'default' ? { variant: 'heading' } : { variant: 'body', color: 'textMuted' };
  return (
    <Text testID={testID} {...props}>
      {formatRupees(paise)}
    </Text>
  );
}
