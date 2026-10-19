export interface SiteConfig {
  apiBase: string;
  apiKey: string;
}

declare global {
  interface Window {
    RBW_CONFIG?: SiteConfig;
  }
}

function windowConfig(): SiteConfig {
  if (typeof window !== 'undefined' && window.RBW_CONFIG && typeof window.RBW_CONFIG === 'object') {
    return window.RBW_CONFIG;
  }
  return { apiBase: '', apiKey: '' };
}

let remoteApiBase = '';
let remotePublic: boolean | null = null;

export function apiBase(): string {
  if (remoteApiBase) return remoteApiBase;
  return windowConfig().apiBase || '';
}

export function apiKey(): string {
  const key = windowConfig().apiKey || '';
  if (key) return key;
  return '';
}

export function isPublicMode(): boolean | null {
  return remotePublic;
}

export async function refreshRemoteConfig(): Promise<void> {
  try {
    const res = await fetch('rbw/web/config');
    if (!res.ok) return;
    const remote = await res.json();
    if (remote && typeof remote === 'object') {
      if (remote.apiBase) remoteApiBase = remote.apiBase;
      if (remote.apiKeyRequired === false) remotePublic = true;
      else if (remote.apiKeyRequired === true) remotePublic = false;
    }
  } catch {
  }
}
