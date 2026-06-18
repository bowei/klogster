const PREFIX_V1 = 'v1:';
const PREFIX_V2 = 'v2:';

export function saveState(panelGroups, focus) {
  try {
    const encoded = btoa(JSON.stringify({ panelGroups, focus }));
    history.replaceState(null, '', '#' + PREFIX_V2 + encoded);
  } catch {}
}

export function loadState() {
  const hash = location.hash.slice(1);

  if (hash.startsWith(PREFIX_V2)) {
    try {
      const obj = JSON.parse(atob(hash.slice(PREFIX_V2.length)));
      if (!obj || !Array.isArray(obj.panelGroups)) return null;
      return obj;
    } catch { return null; }
  }

  // v1 backward compat: each panel becomes its own single-tab panel group
  if (hash.startsWith(PREFIX_V1)) {
    try {
      const obj = JSON.parse(atob(hash.slice(PREFIX_V1.length)));
      if (!obj || !Array.isArray(obj.panels)) return null;
      return {
        panelGroups: obj.panels.map(p => ({
          activeTab: { group: p.group, ns: p.ns, pod: p.pod, container: p.container },
          tabs: [{ group: p.group, ns: p.ns, pod: p.pod, container: p.container, filters: p.filters || [] }],
        })),
        focus: obj.focus || null,
      };
    } catch { return null; }
  }

  return null;
}
