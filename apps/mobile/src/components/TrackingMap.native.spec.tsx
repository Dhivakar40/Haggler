import { screen } from '@testing-library/react-native';
import i18n from '../i18n';
import { renderWithProviders } from '../test-utils';
import { TrackingMap } from './TrackingMap';

jest.mock('@maplibre/maplibre-react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot close over top-level imports
  const { View } = require('react-native');
  return {
    Map: ({ children, ...p }: { children?: unknown; [key: string]: unknown }) => (
      <View testID="ml-map" {...(p as object)}>
        {children as never}
      </View>
    ),
    Camera: () => null,
    Marker: ({ children }: { children?: never }) => <>{children}</>,
  };
});

const dest = { latitude: 13.0827, longitude: 80.2707 };
const worker = { latitude: 13.05, longitude: 80.25 };

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('TrackingMap with MapLibre available (a dev build, not Expo Go)', () => {
  it('renders the real map with the OSM attribution instead of the text fallback', async () => {
    await renderWithProviders(<TrackingMap destination={dest} worker={worker} />);
    expect(await screen.findByTestId('tracking-map')).toBeTruthy();
    expect(screen.getByTestId('ml-map')).toBeTruthy();
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy();
    expect(screen.queryByTestId('map-fallback')).toBeNull();
  });
});
