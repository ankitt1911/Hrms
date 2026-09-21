class AppError extends Error {
  constructor(code, status, message, details = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.isOperational = true;
  }
}

module.exports = { AppError };
