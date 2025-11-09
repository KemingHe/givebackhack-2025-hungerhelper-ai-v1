
import { useState, useCallback } from 'react';

interface GeolocationState {
  loading: boolean;
  error: GeolocationPositionError | Error | null;
  location: GeolocationCoordinates | null;
}

export const useGeolocation = () => {
  const [state, setState] = useState<GeolocationState>({
    loading: false,
    error: null,
    location: null,
  });

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: new Error('Geolocation is not supported by your browser.') }));
      return;
    }

    setState(s => ({ ...s, loading: true }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          loading: false,
          error: null,
          location: position.coords,
        });
      },
      (error) => {
        setState({
          loading: false,
          error: error,
          location: null,
        });
      }
    );
  }, []);

  return { ...state, getLocation };
};
