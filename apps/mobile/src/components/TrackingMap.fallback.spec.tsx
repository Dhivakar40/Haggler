import { fireEvent, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import i18n from '../i18n';
import { renderWithProviders } from '../test-utils';
import { mapsUrl, TrackingMap } from './TrackingMap';

jest.mock('@maplibre/maplibre-react-native', () => {
  throw new Error('native module missing');
});

const dest = { latitude: 13.0827, longitude: 80.2707 };
const worker = { latitude: 13.05, longitude: 80.25 };

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('mapsUrl', () => {
  it('builds an Apple Maps link on iOS and a geo: link on Android', () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    expect(mapsUrl(dest)).toBe('http://maps.apple.com/?ll=13.0827,80.2707&q=Job');
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    expect(mapsUrl(dest)).toBe('geo:13.0827,80.2707?q=13.0827,80.2707');
    Object.defineProperty(Platform, 'OS', { value: original });
  });
});

describe('TrackingMap without MapLibre (Expo Go / native module missing)', () => {
  it('shows nothing yet when there is no destination and no worker fix', async () => {
    await renderWithProviders(<TrackingMap destination={null} worker={null} />);
    expect(
      await screen.findByText("Your Ranger's location will appear once they set off."),
    ).toBeTruthy();
  });

  it('falls back to a text readout of the worker position plus an "open in maps" button', async () => {
    await renderWithProviders(<TrackingMap destination={dest} worker={worker} />);
    expect(await screen.findByTestId('map-fallback')).toHaveTextContent('13.05000, 80.25000');
    expect(screen.getByText('Open in maps')).toBeTruthy();
  });

  it('before the Ranger has sent a fix, centres on the destination but still shows the waiting text', async () => {
    await renderWithProviders(<TrackingMap destination={dest} worker={null} />);
    expect(await screen.findByTestId('map-fallback')).toHaveTextContent(
      "Your Ranger's location will appear once they set off.",
    );
  });

  it('opens the device map app with the worker (or destination) coordinates', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await renderWithProviders(<TrackingMap destination={dest} worker={worker} />);
    await fireEvent.press(await screen.findByLabelText('Open in maps'));
    expect(spy).toHaveBeenCalled();
  });
});
