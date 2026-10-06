import { act, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { renderWithProviders } from '../test-utils';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders, hidden from assistive tech (it is a placeholder, not content)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await renderWithProviders(<Skeleton testID="sk" />);
    await act(async () => {});
    // Hidden from the default accessibility tree by design, so queries must opt back in.
    const el = screen.getByTestId('sk', { includeHiddenElements: true });
    expect(el.props.accessibilityElementsHidden).toBe(true);
    expect(el.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('does not throw when the OS reports reduce-motion is on (animation is skipped)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderWithProviders(<Skeleton testID="sk" />);
    await act(async () => {});
    expect(screen.getByTestId('sk', { includeHiddenElements: true })).toBeTruthy();
  });
});
