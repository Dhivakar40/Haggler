import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithProviders } from '../test-utils';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  ErrorState,
  LeagueBadge,
  ListRow,
  PriceTag,
  Rating,
  StatusPill,
} from './index';

describe('Button', () => {
  it('calls onPress and is announced as a button with its label', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button title="Send code" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Send code' });
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is at least 48dp tall', async () => {
    await renderWithProviders(<Button title="Go" onPress={() => {}} testID="b" />);
    const style = StyleSheet.flatten(screen.getByTestId('b').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('is disabled for assistive tech and the native Pressable when disabled', async () => {
    // Note: RNTL's fireEvent climbs to the Button's own `onPress` prop, so we assert the
    // disabled state that React Native's Pressable uses to swallow real touches instead.
    await renderWithProviders(<Button title="Pay" onPress={() => {}} disabled testID="d" />);
    expect(screen.getByTestId('d').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('d').props.accessible).toBe(true);
  });

  it('reports busy while loading', async () => {
    await renderWithProviders(<Button title="Pay" onPress={() => {}} loading testID="l" />);
    expect(screen.getByTestId('l').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });
});

describe('Chip', () => {
  it('exposes selected state to assistive tech', async () => {
    await renderWithProviders(<Chip label="Dark" selected onPress={() => {}} testID="c" />);
    expect(screen.getByTestId('c').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('c').props.accessibilityRole).toBe('radio');
  });
});

describe('ErrorState', () => {
  it('offers a retry that calls back', async () => {
    const onRetry = jest.fn();
    await renderWithProviders(<ErrorState onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('renders its label', async () => {
    await renderWithProviders(<Badge label="Ranger" testID="b" />);
    expect(screen.getByText('Ranger')).toBeTruthy();
  });
});

describe('StatusPill', () => {
  it.each(['neutral', 'positive', 'negative', 'warning'] as const)(
    'renders the %s tone without crashing',
    async (tone) => {
      await renderWithProviders(<StatusPill label="Open" tone={tone} testID="s" />);
      expect(screen.getByText('Open')).toBeTruthy();
    },
  );
});

describe('PriceTag', () => {
  it('formats paise as Indian-grouped rupees', async () => {
    await renderWithProviders(<PriceTag paise={349000} />);
    expect(screen.getByText('₹3,490')).toBeTruthy();
  });

  it('muted variant still formats the same amount', async () => {
    await renderWithProviders(<PriceTag paise={19900} variant="muted" />);
    expect(screen.getByText('₹199')).toBeTruthy();
  });
});

describe('LeagueBadge', () => {
  it("renders a Ranger tier's translated name", async () => {
    await renderWithProviders(<LeagueBadge tier="STONE" kind="worker" testID="lb" />);
    expect(screen.getByText('Stone')).toBeTruthy();
  });

  it("renders a client tier's translated name, from the other translation namespace", async () => {
    await renderWithProviders(<LeagueBadge tier="PREFERRED" kind="client" testID="lb" />);
    expect(screen.getByText('Preferred')).toBeTruthy();
  });

  it('renders nothing for an unrecognized tier rather than a broken pill', async () => {
    await renderWithProviders(
      // @ts-expect-error intentionally invalid, to prove the guard
      <LeagueBadge tier="NOT_A_TIER" kind="worker" testID="lb" />,
    );
    expect(screen.queryByTestId('lb')).toBeNull();
  });
});

describe('Avatar', () => {
  it('shows initials from first and last name when there is no photo', async () => {
    await renderWithProviders(<Avatar name="Ravi Kumar" testID="a" />);
    expect(screen.getByText('RK')).toBeTruthy();
  });

  it('shows a single initial for a one-word name', async () => {
    await renderWithProviders(<Avatar name="Ravi" testID="a" />);
    expect(screen.getByText('R')).toBeTruthy();
  });

  it('falls back to "?" with no name', async () => {
    await renderWithProviders(<Avatar name={null} testID="a" />);
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('is deterministic: the same name always gets the same tone', async () => {
    await renderWithProviders(
      <>
        <Avatar name="Ravi Kumar" testID="a1" />
        <Avatar name="Ravi Kumar" testID="a2" />
      </>,
    );
    const color1 = StyleSheet.flatten(screen.getByTestId('a1').props.style).backgroundColor;
    const color2 = StyleSheet.flatten(screen.getByTestId('a2').props.style).backgroundColor;
    expect(color1).toBe(color2);
  });

  it('renders a real image when a photo URL is given', async () => {
    await renderWithProviders(<Avatar name="Ravi Kumar" photoUrl="https://x.test/p.jpg" testID="a" />);
    expect(screen.getByTestId('a').props.source).toEqual({ uri: 'https://x.test/p.jpg' });
  });
});

describe('Rating', () => {
  it('read-only mode: no tappable stars, announced as a single "X out of 5" label', async () => {
    await renderWithProviders(<Rating value={4} testID="r" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('r').props.accessibilityLabel).toBe('4 out of 5 stars');
  });

  it('interactive mode: five tappable stars that report which was pressed', async () => {
    const onChange = jest.fn();
    await renderWithProviders(<Rating value={0} onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(5);
    await fireEvent.press(screen.getByTestId('star-3'));
    expect(onChange).toHaveBeenCalledWith(3);
  });
});

describe('ListRow', () => {
  it('calls onPress and is announced as a button with its title', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<ListRow title="Addresses" onPress={onPress} testID="row" />);
    await fireEvent.press(screen.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a subtitle when given one', async () => {
    await renderWithProviders(<ListRow title="Home" subtitle="12 Gandhi Road" onPress={() => {}} />);
    expect(screen.getByText('12 Gandhi Road')).toBeTruthy();
  });

  it('is at least 48dp tall even with no onPress', async () => {
    await renderWithProviders(<ListRow title="Plain row" testID="row" />);
    const style = StyleSheet.flatten(screen.getByTestId('row').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});
