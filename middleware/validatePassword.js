function validatePasswordMiddleware(req, res, next) {
  const { password } = req.body;

  if (!/[A-Z]/.test(password)) {
    return res
      .status(400)
      .json({ error: "Include at least one uppercase letter" });
  }
  if (!/[a-z]/.test(password)) {
    return res
      .status(400)
      .json({ error: "Include at least one lowercase letter" });
  }
  if (!/\d/.test(password)) {
    return res
      .status(400)
      .json({ error: "Include at least one numeric digit" });
  }
  if (!/[\W_]/.test(password)) {
    return res
      .status(400)
      .json({ error: "Include at least one special character" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }
  next();
}

module.exports = validatePasswordMiddleware;
