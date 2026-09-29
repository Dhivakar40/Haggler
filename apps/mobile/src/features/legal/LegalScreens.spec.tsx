import { fireEvent, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import i18n from '../../i18n';
import { renderWithProviders, routerMock } from '../../test-utils';
import { LegalDocScreen, LegalListScreen } from './LegalScreens';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});

describe('LegalListScreen', () => {
  it('lists every document, including the Grievance Officer, and shows the placeholder banner', async () => {
    await renderWithProviders(<LegalListScreen />);
    expect(
      await screen.findByText(
        'Placeholder text. A lawyer has not reviewed this yet and it will be replaced before launch.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('legal-terms')).toBeTruthy();
    expect(screen.getByTestId('legal-privacy')).toBeTruthy();
    expect(screen.getByTestId('legal-refund')).toBeTruthy();
    expect(screen.getByTestId('legal-grievance')).toBeTruthy();
  });

  it('opens a document', async () => {
    await renderWithProviders(<LegalListScreen />);
    await fireEvent.press(await screen.findByTestId('legal-terms'));
    expect(routerMock().push).toHaveBeenCalledWith({
      pathname: '/legal/[doc]',
      params: { doc: 'terms' },
    });
  });
});

describe('LegalDocScreen', () => {
  it('shows a normal document with the placeholder banner', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ doc: 'terms' });
    await renderWithProviders(<LegalDocScreen />);
    expect(await screen.findByText('Terms of Service')).toBeTruthy();
    expect(screen.getAllByText(/placeholder text/i).length).toBeGreaterThan(0);
  });

  it('shows the Grievance Officer contact details (compliance checklist item 8), clearly marked as a placeholder', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ doc: 'grievance' });
    await renderWithProviders(<LegalDocScreen />);
    expect(await screen.findByText('Name not yet appointed')).toBeTruthy();
    expect(screen.getAllByText('Grievance Officer').length).toBe(2); // page title + the label above the contact card
    expect(screen.getByText('grievance@haggler.example (placeholder)')).toBeTruthy();
    expect(screen.getByText(/Ops must appoint a real grievance officer/)).toBeTruthy();
  });

  it('falls back to the generic placeholder for an unknown doc id', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ doc: 'made-up' });
    await renderWithProviders(<LegalDocScreen />);
    expect(await screen.findByText('Legal and policies')).toBeTruthy();
  });
});
