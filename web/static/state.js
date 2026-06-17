const PREFIX = 'v1:';

export function saveState(panels, focus) {
  try {
    const encoded = btoa(JSON.stringify({ panels, focus }));
    history.replaceState(null, '', '#' + PREFIX + encoded);
  } catch {}
}

export function loadState() {
  const hash = location.hash.slice(1);
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const obj = JSON.parse(atob(hash.slice(PREFIX.length)));
    if (!obj || !Array.isArray(obj.panels)) return null;
    return obj;
  } catch {
    return null;
  }
}
