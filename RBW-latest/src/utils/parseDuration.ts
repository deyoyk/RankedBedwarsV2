
 


export function parseDuration(str: string): number {
  
  str = str.toLowerCase().replace(/\s+/g, '');
  let totalMs = 0;

  
  const monthMatch = str.match(/(\d+)\s*(mo|month)/);
  if (monthMatch) {
    totalMs += parseInt(monthMatch[1]) * 30 * 24 * 60 * 60 * 1000;
    str = str.replace(monthMatch[0], '');
  }

  
  const dayMatch = str.match(/(\d+)d/);
  if (dayMatch) {
    totalMs += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
    str = str.replace(dayMatch[0], '');
  }

  
  const hourMatch = str.match(/(\d+)h/);
  if (hourMatch) {
    totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;
    str = str.replace(hourMatch[0], '');
  }

  
  const minMatch = str.match(/(\d+)(min|m)(?!o|onth)/);
  if (minMatch) {
    totalMs += parseInt(minMatch[1]) * 60 * 1000;
    str = str.replace(minMatch[0], '');
  }

  
  const secMatch = str.match(/(\d+)(sec|s)/);
  if (secMatch) {
    totalMs += parseInt(secMatch[1]) * 1000;
    str = str.replace(secMatch[0], '');
  }

  return totalMs;
}