import express from "express";
import { ticketsCollection } from "../db.js";
import { ObjectId } from "mongodb";

const router = express.Router();

// Get all tickets (filtered by user if not admin)
router.get("/tickets", async (req, res) => {
  const { userId, role } = req.query;
  if (!userId) return res.status(401).json({ error: "Missing userId" });

  try {
    const filter = role === "admin" ? {} : { userId };
    const tickets = await ticketsCollection.find(filter).sort({ createdAt: -1 }).toArray();
    return res.json({
      tickets: tickets.map(t => ({
        id: t._id.toString(),
        ticketNo: t.ticketNo,
        subject: t.subject,
        description: t.description,
        status: t.status,
        createdAt: t.createdAt,
        userName: t.userName,
        userEmail: t.userEmail
      }))
    });
  } catch (error) {
    console.error("Fetch tickets error:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// Update ticket status (Admin only for status, but endpoint used by both)
router.put("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  const { status, subject, description, adminId } = req.body;

  try {
    const updateData = {};
    if (status) updateData.status = status;
    if (subject) updateData.subject = subject;
    if (description) updateData.description = description;
    updateData.updatedAt = new Date().toISOString();

    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: "Ticket not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
});

// Delete ticket
router.delete("/tickets/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await ticketsCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Ticket not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
