// middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("./User");

const JWT_SECRET = process.env.JWT_SECRET;

exports.protect = async (req, res, next) => {
  try {
    // token from cookie
    const token = req.cookies?.token || (req.header("Authorization")?.replace("Bearer ", ""));

    if (!token) return res.status(401).json({ message: "Not authenticated" });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "User not found" });

    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
