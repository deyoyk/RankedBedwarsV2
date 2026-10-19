'use client';

import { useEffect, useState } from 'react';
import { isPublicMode, refreshRemoteConfig } from '@/lib/config';

export function ApiStatus() {
  const [label, setLabel] = useState('');
  useEffect(() => {
    refreshRemoteConfig().then(() => {
      const pub = isPublicMode();
      if (pub === true) setLabel('API: public read mode');
      else if (pub === false) setLabel('API: key required');
    });
  }, []);
  return <span id="api-status" className="muted">{label}</span>;
}
