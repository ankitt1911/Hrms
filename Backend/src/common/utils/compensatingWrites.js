async function retryCleanup(cleanup, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await cleanup();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function rollbackAndRethrow(error, cleanups) {
  const rollbackErrors = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await retryCleanup(cleanup);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
  }
  if (rollbackErrors.length) error.rollbackErrors = rollbackErrors;
  throw error;
}

module.exports = { rollbackAndRethrow };
