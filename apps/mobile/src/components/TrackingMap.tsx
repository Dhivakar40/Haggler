import { Linking, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type * as MapLibreModule from '@maplibre/maplibre-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radii, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

interface Point {
  latitude: number;
  longitude: number;
}
interface Props {
  destination: Point | null;
  worker: Point | null;
  trail?: Point[];
}

/**
 * OpenStreetMap raster tiles through MapLibre (D-021: no Google billing exposure).
 * The public OSM tile server is for light use only; production needs a tile provider.
 * Attribution is required by the OSM licence and is always shown.
 */
export const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

export const mapsUrl = (p: Point): string =>
  Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${p.latitude},${p.longitude}&q=Job`
    : `geo:${p.latitude},${p.longitude}?q=${p.latitude},${p.longitude}`;

let maplibre: typeof MapLibreModule | null | undefined;
/** MapLibre is native code: it is absent in Expo Go. Fall back to a text view instead of crashing. */
function loadMapLibre(): typeof MapLibreModule | null {
  if (maplibre !== undefined) return maplibre;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    maplibre = require('@maplibre/maplibre-react-native') as typeof MapLibreModule;
  } catch {
    maplibre = null;
  }
  return maplibre;
}

export function TrackingMap({ destination, worker }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ml = loadMapLibre();
  const centre = worker ?? destination;

  if (!centre) return <Text color="textMuted">{t('job.trackingNone')}</Text>;

  const fallback = (
    <View style={[styles.box, { borderColor: colors.border, padding: spacing.md }]}>
      <Text testID="map-fallback">
        {worker
          ? `${worker.latitude.toFixed(5)}, ${worker.longitude.toFixed(5)}`
          : t('job.trackingNone')}
      </Text>
      <Button
        variant="secondary"
        title={t('job.openMaps')}
        onPress={() => void Linking.openURL(mapsUrl(centre))}
      />
    </View>
  );
  if (!ml) return fallback;

  const { Map, Camera, Marker } = ml;
  return (
    <View
      style={[styles.box, { borderColor: colors.border }]}
      testID="tracking-map"
      accessibilityLabel={t('job.trackingTitle')}
    >
      <Map style={StyleSheet.absoluteFill} mapStyle={OSM_STYLE}>
        {/* key: re-centre when the first Ranger fix arrives */}
        <Camera
          key={worker ? 'worker' : 'dest'}
          initialViewState={{ center: [centre.longitude, centre.latitude], zoom: 14 }}
        />
        {destination ? (
          <Marker id="destination" lngLat={[destination.longitude, destination.latitude]}>
            <View style={[styles.pin, { backgroundColor: colors.danger }]} />
          </Marker>
        ) : (
          <></>
        )}
        {worker ? (
          <Marker id="worker" lngLat={[worker.longitude, worker.latitude]}>
            <View style={[styles.pin, { backgroundColor: colors.primary }]} />
          </Marker>
        ) : (
          <></>
        )}
      </Map>
      <Text variant="caption" style={styles.attribution}>
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 240, borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden', gap: spacing.sm },
  pin: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#fff' },
  attribution: {
    position: 'absolute',
    bottom: 2,
    right: 6,
    backgroundColor: 'rgba(255,255,255,0.8)',
    color: '#000',
    paddingHorizontal: 4,
  },
});
