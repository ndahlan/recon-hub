import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/** Returns true when the device has an active internet connection. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true); // optimistic default

  useEffect(() => {
    // Check immediately
    NetInfo.fetch().then((s) => {
      setOnline(s.isConnected === true && s.isInternetReachable !== false);
    });

    // Subscribe to changes
    const unsub = NetInfo.addEventListener((s) => {
      setOnline(s.isConnected === true && s.isInternetReachable !== false);
    });
    return unsub;
  }, []);

  return online;
}
