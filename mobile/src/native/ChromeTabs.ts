import { NativeModules, Dimensions, PixelRatio, Platform } from 'react-native';

export async function openPartialCustomTab(url: string, heightRatio = 0.5): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const mod = (NativeModules as any).ChromeTabs;
  if (!mod || typeof mod.open !== 'function') return false;
  const { height } = Dimensions.get('window');
  const px = Math.round(height * heightRatio * PixelRatio.get());
  try { mod.open(url, px); return true; } catch { return false; }
}

