import * as Location from 'expo-location';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface GeocodedPlace {
  city?: string;
  region?: string;
  postalCode?: string;
}

/**
 * Real GPS, foreground only; coordinates go to the server, which validates they are in India.
 * Shared by `NewAddressScreen` (Settings > Addresses) and `OnboardingScreen`'s address step, so the
 * permission/geocode behaviour (and its tests) stay in exactly one place.
 */
export function useAddressLocation(onPlace: (place: GeocodedPlace) => void) {
  const { t } = useTranslation();
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [status, setStatus] = useState<string>();
  const [locating, setLocating] = useState(false);

  async function useMyLocation() {
    setStatus(undefined);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setStatus(t('addresses.locationDenied'));
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setStatus(t('addresses.locationCaptured'));
      // Best-effort autofill from the phone's own geocoder (no key, no third-party billing).
      try {
        const [place] = await Location.reverseGeocodeAsync(pos.coords);
        if (place) {
          onPlace({
            city: place.city ?? place.subregion ?? undefined,
            region: place.region ?? undefined,
            postalCode: place.postalCode ?? undefined,
          });
        }
      } catch {
        /* autofill is a nicety; the person can type it */
      }
    } catch {
      setStatus(t('addresses.locationDenied'));
    } finally {
      setLocating(false);
    }
  }

  return { coords, status, locating, useMyLocation };
}
