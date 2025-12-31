import { create } from 'zustand';
import { ProxyConfig, defaultProxyConfig } from '../types/proxy';

interface ProxyStore {
  proxy: ProxyConfig;
  setProxy: (proxy: ProxyConfig) => void;
  toggleEnabled: () => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

const STORAGE_KEY = 'text2mp3_proxy_config';

export const useProxyStore = create<ProxyStore>((set, get) => ({
  proxy: defaultProxyConfig,

  setProxy: (proxy) => {
    set({ proxy });
    get().saveToStorage();
  },

  toggleEnabled: () => {
    set((state) => ({
      proxy: { ...state.proxy, enabled: !state.proxy.enabled }
    }));
    get().saveToStorage();
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        set({ proxy: JSON.parse(stored) });
      }
    } catch (error) {
      console.error('加载代理配置失败:', error);
    }
  },

  saveToStorage: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().proxy));
    } catch (error) {
      console.error('保存代理配置失败:', error);
    }
  },
}));
