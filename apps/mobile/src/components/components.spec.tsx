import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { renderWithProviders } from '../test-utils';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Button, Chip, ErrorState } from './index';

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
