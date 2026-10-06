import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '../test-utils';
import { Dialog } from './Dialog';

describe('Dialog', () => {
  it('shows the title and message, and calls back on confirm/cancel', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await renderWithProviders(
      <Dialog
        visible
        title="Cancel this job?"
        message="The Ranger will be notified."
        confirmLabel="Cancel job"
        onConfirm={onConfirm}
        cancelLabel="Keep job"
        onCancel={onCancel}
        testID="dlg"
      />,
    );
    expect(screen.getByText('Cancel this job?')).toBeTruthy();
    expect(screen.getByText('The Ranger will be notified.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel job' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Keep job' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is absent from the tree when not visible', async () => {
    await renderWithProviders(
      <Dialog
        visible={false}
        title="Delete account?"
        confirmLabel="Delete"
        onConfirm={() => {}}
        cancelLabel="Keep"
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText('Delete account?')).toBeNull();
  });
});
