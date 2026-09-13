import * as Network from "expo-network";

/**
 * Whether the device can reach the internet right now. Re-renders on every
 * connectivity change, so a caller reacts to regaining a signal with no polling.
 *
 * `isInternetReachable` is undefined until the first probe resolves; only a
 * definite `false` means a connected-but-captive network.
 */
export function useIsOnline() {
  const network = Network.useNetworkState();
  return !!network.isConnected && network.isInternetReachable !== false;
}
