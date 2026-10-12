import { useCallback, useEffect, useState } from 'react';
import {
  detectEnv,
  getDisplayMode,
  getInstallState,
  promptInstall,
  subscribeInstall,
  type DisplayMode,
  type InstallEnv,
  type InstallState,
} from '@/shared/lib/install';

/**
 * What this phone (or computer) can do about installing the app, kept in
 * step with the browser: the state changes when Chrome offers the install
 * prompt, when the person accepts it, and when the app gets installed.
 */
export function useInstall() {
  const [state, setState] = useState<InstallState>(() => getInstallState());
  const [env] = useState<InstallEnv>(() => detectEnv());
  const [mode] = useState<DisplayMode>(() => getDisplayMode());

  useEffect(() => subscribeInstall(() => setState(getInstallState())), []);

  const prompt = useCallback(() => promptInstall(), []);

  return { state, env, mode, prompt };
}
