import express from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../db.js";
import { hashPassword, verifyPassword } from "../utils.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: "name, email, and password are required" });
  }

  try {
    const existing = await usersCollection.findOne({ email });
    if (existing) {
      return res
        .status(409)
        .json({ error: "A user with that email already exists." });
    }

    const passwordHash = hashPassword(password);
    const result = await usersCollection.insertOne({
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    });

    const user = {
      id: result.insertedId.toString(),
      name,
      email,
    };
    return res.json({ success: true, user });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ error: "Failed to register user." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  // Admin Hardcoded Login (for this example)
  if (email === "admin@agentic.ai" && password === "Admin@123") {
    return res.json({
      success: true,
      user: {
        id: "admin",
        name: "System Admin",
        email: "admin@agentic.ai",
        role: "admin",
      },
    });
  }

  try {
    const user = await usersCollection.findOne({ email });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    return res.json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Failed to login user." });
  }
});

export default router;
