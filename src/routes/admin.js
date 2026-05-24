import express from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../db.js";
import { hashPassword } from "../utils.js";

const router = express.Router();

router.get("/admin/users", async (req, res) => {
  const { adminId } = req.query;
  if (adminId !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    const users = await usersCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.put("/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, password, adminId } = req.body;
  if (adminId !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    const updateData = { name, email };
    if (password) updateData.passwordHash = hashPassword(password);

    await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/admin/users/:id", async (req, res) => {
  const { id } = req.params;
  const { adminId } = req.query;
  if (adminId !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    await usersCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
