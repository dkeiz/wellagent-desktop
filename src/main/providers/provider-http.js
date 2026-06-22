function isProviderRequestCanceled(axiosLib, error) {
  return Boolean(
    axiosLib?.isCancel?.(error)
    || error?.name === 'AbortError'
    || error?.code === 'ERR_CANCELED'
  );
}

function normalizeProviderHttpError(error, label = 'Provider request') {
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''))) {
    const timeoutError = new Error(`${label} timed out`);
    timeoutError.cause = error;
    timeoutError.code = 'PROVIDER_TIMEOUT';
    return timeoutError;
  }
  if (error?.response?.status) {
    const statusError = new Error(`${label} failed with HTTP ${error.response.status}`);
    statusError.cause = error;
    statusError.code = 'PROVIDER_HTTP_ERROR';
    statusError.status = error.response.status;
    return statusError;
  }
  return error;
}

async function providerRequest(axiosLib, config, options = {}) {
  const timeout = Number(options.timeoutMs || config?.timeout || 0) || undefined;
  const label = options.label || 'Provider request';
  try {
    return await axiosLib.request({
      ...config,
      timeout
    });
  } catch (error) {
    if (isProviderRequestCanceled(axiosLib, error)) {
      throw error;
    }
    throw normalizeProviderHttpError(error, label);
  }
}

module.exports = {
  isProviderRequestCanceled,
  normalizeProviderHttpError,
  providerRequest
};
