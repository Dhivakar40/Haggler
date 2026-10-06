import { fireEvent, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { renderWithProviders } from '../test-utils';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('renders its children when visible', async () => {
    await renderWithProviders(
      <Sheet visible onClose={() => {}} testID="sheet">
        <Text>Filter options</Text>
      </Sheet>,
    );
    expect(screen.getByText('Filter options')).toBeTruthy();
  });

  it('is absent from the tree when not visible', async () => {
    await renderWithProviders(
      <Sheet visible={false} onClose={() => {}} testID="sheet">
        <Text>Filter options</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Filter options')).toBeNull();
  });

  it('closes on a backdrop tap', async () => {
    const onClose = jest.fn();
    await renderWithProviders(
      <Sheet visible onClose={onClose} testID="sheet">
        <View />
      </Sheet>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
