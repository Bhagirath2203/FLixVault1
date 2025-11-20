// routes/auth.js
const jwt = require("jsonwebtoken");
const User = require("./User");
const { protect } = require("./auth");
const express = require("express")
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || "development";

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET);
}

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "Name, email and password required" });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const user = await User.create({ name, email, password });
    // create token cookie
    const token = signToken(user._id);
    res.cookie("token", token, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24 // 1 day in ms (match JWT_EXPIRES_IN roughly)
    });

    res.status(201).json({ user: user.toJSON() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user._id);
    res.cookie("token", token, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 24
    });

    res.json({ user: user.toJSON() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: NODE_ENV === "production" ? "none" : "lax"
  });
  return res.json({ message: "Logged out" });
});

// GET /api/auth/me
router.get("/me", protect, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
