const number = (v, fallback) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback;

export function aiConfig(env = process.env) {
  const localEnabled = String(env.AI_LOCAL_ENABLED ?? 'true').toLowerCase() !== 'false';
  return {
    enabled: localEnabled, localEnabled,
    localOnly: localEnabled,
    provider: 'local', model: 'offline-analytics', missing: [],
    ready: localEnabled,
    maxInputChars: Math.min(number(env.AI_MAX_INPUT_CHARS, 6000), 20000),
    requestsPerMinute: 5
  };
}

export function publicAIStatus(config) {
  return {
    enabled: config.enabled,
    ready: config.ready,
    provider: config.ready ? config.provider : null,
    model: config.ready ? config.model || null : null,
    mode: config.ready ? (config.localOnly ? 'local' : 'hybrid') : 'off',
    external_required: false,
    missing: config.localEnabled ? [] : config.missing,
    limits: { requestsPerMinute: config.requestsPerMinute, maxContextChars: config.maxInputChars }
  };
}

export function allowedFeature(role, feature) {
  if (!['viewer','cashier','accountant','admin'].includes(role)) return false;
  return ['documents','rule','invoice','report'].includes(feature);
}
