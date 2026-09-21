function validate(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!parsed.success) return next(parsed.error);
    req.validated = parsed.data;
    next();
  };
}

module.exports = { validate };
