import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { syncPendingEntries } from '../db/database';

/**
 * Watches network state. When connectivity is restored after being offline,
 * automatically syncs any entries that were created while offline.
 *
 * @param onSynced - called with the number of entries synced (if > 0)
 */
export function useNetworkSync(onSynced?: (count: number) => void) {
  const wasOffline = useRef(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;

      if (!online) {
        wasOffline.current = true;
      } else if (wasOffline.current) {
        // Just came back online
        wasOffline.current = false;
        syncPendingEntries()
          .then((count) => { if (count > 0) onSynced?.(count); })
          .catch(() => {});
      }
    });

    return unsub;
  }, [onSynced]);
}
