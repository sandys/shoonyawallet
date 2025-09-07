import { NativeModules, Dimensions, PixelRatio, Platform } from 'react-native';

export async function openPartialCustomTab(url: string, heightRatio = 0.5): Promise<boolean> {
  console.log(`ChromeTabs: Attempting to open ${url}`);
  
  if (Platform.OS !== 'android') {
    console.log('ChromeTabs: iOS not supported');
    return false;
  }
  
  const mod = (NativeModules as any).ChromeTabs;
  console.log('ChromeTabs: Module check:', !!mod, typeof mod?.open);
  
  if (!mod || typeof mod.open !== 'function') {
    console.log('ChromeTabs: Module not available or invalid');
    return false;
  }
  
  const { height } = Dimensions.get('window');
  const px = Math.round(height * heightRatio * PixelRatio.get());
  
  try { 
    console.log(`ChromeTabs: Opening with heightRatio=${heightRatio}, px=${px}, url=${url.substring(0, 100)}...`);
    await mod.open(url, px); 
    console.log('ChromeTabs: Open succeeded');
    return true; 
  } catch (e) { 
    console.log('ChromeTabs: Open failed:', e);
    return false; 
  }
}

