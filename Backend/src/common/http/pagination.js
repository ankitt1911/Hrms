function pagination(input = {}) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { pagination };
