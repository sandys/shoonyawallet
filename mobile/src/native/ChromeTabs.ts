import { NativeModules, Dimensions, PixelRatio, Platform } from 'react-native';

export async function openPartialCustomTab(url: string, heightRatio = 0.5): Promise<boolean> {
  if (Platform.OS !== 'android') {
    console.log('ChromeTabs: iOS not supported');
    return false;
  }
  
  const mod = (NativeModules as any).ChromeTabs;
  if (!mod || typeof mod.open !== 'function') {
    console.log('ChromeTabs: Module not available');
    return false;
  }
  
  const { height } = Dimensions.get('window');
  const px = Math.round(height * heightRatio * PixelRatio.get());
  
  try { 
    console.log(`ChromeTabs: Opening with heightRatio=${heightRatio}, px=${px}`);
    mod.open(url, px); 
    return true; 
  } catch (e) { 
    console.log('ChromeTabs: Open failed:', e);
    return false; 
  }
}

