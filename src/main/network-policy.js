const nodeFetch = require('node-fetch');

function normalizeTimeoutMs(value, fallback = 10000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(50, Math.min(Math.floor(n), 120000));
}

function normalizeLabel(label, fallback) {
  return String(label || fallback || 'Network request').trim();
}

function assertNetworkPolicyUrl(rawUrl, policy = 'external-web') {
  const parsed = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${policy} network requests only support HTTP(S) URLs`);
  }
  return parsed;
}

async function policyFetch(rawUrl, options = {}, policyOptions = {}) {
  const policy = policyOptions.policy || 'external-web';
  const label = normalizeLabel(policyOptions.label, policy);
  const url = assertNetworkPolicyUrl(rawUrl, policy).toString();
  const timeoutMs = normalizeTimeoutMs(policyOptions.timeoutMs || options.timeout, policyOptions.defaultTimeoutMs || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await (policyOptions.fetchImpl || nodeFetch)(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${label} failed: ${error.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function externalWebFetch(rawUrl, options = {}, policyOptions = {}) {
  return policyFetch(rawUrl, options, {
    defaultTimeoutMs: 15000,
    ...policyOptions,
    policy: 'external-web'
  });
}

function localProbeFetch(rawUrl, options = {}, policyOptions = {}) {
  return policyFetch(rawUrl, options, {
    defaultTimeoutMs: 5000,
    ...policyOptions,
    policy: 'local-probe'
  });
}

async function policyAxiosRequest(axiosLib, config = {}, policyOptions = {}) {
  const policy = policyOptions.policy || 'local-probe';
  const label = normalizeLabel(policyOptions.label, policy);
  const timeoutMs = normalizeTimeoutMs(config.timeout || policyOptions.timeoutMs, policyOptions.defaultTimeoutMs || 10000);
  assertNetworkPolicyUrl(config.url, policy);

  try {
    return await axiosLib.request({
      ...config,
      timeout: timeoutMs
    });
  } catch (error) {
    const code = error?.code ? ` (${error.code})` : '';
    throw new Error(`${label} failed${code}: ${error.message || String(error)}`);
  }
}

function localProbeAxiosRequest(axiosLib, config = {}, policyOptions = {}) {
  return policyAxiosRequest(axiosLib, config, {
    defaultTimeoutMs: 5000,
    ...policyOptions,
    policy: 'local-probe'
  });
}

module.exports = {
  assertNetworkPolicyUrl,
  externalWebFetch,
  localProbeAxiosRequest,
  localProbeFetch,
  normalizeTimeoutMs,
  policyAxiosRequest,
  policyFetch
};
