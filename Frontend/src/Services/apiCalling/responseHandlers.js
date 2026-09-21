export const toData = async (request) => {
  const response = await request;
  return response.raw;
};

export const toResult = async (request) => {
  try {
    const response = await request;
    return { ok: true, data: response.raw, code: null, message: response.message, errors: [] };
  } catch (error) {
    return { ok: false, data: null, code: error.code || "UNKNOWN_ERROR", message: error.message || "Unexpected error occurred.", errors: error.errors || [], statusCode: error.statusCode || null, requestId: error.requestId || null };
  }
};
