import express from "express";
import { ObjectId } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";
import { appointmentsCollection } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get("/appointments", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(401).json({ error: "Missing userId" });
    }
    const appointments = await appointmentsCollection
      .find(
        { userId },
        { projection: { clientName: 1, email: 1, phone: 1, query: 1, appointmentDateTime: 1, createdAt: 1, status: 1, confirmation: 1 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({
      appointments: appointments.map((appointment, index) => ({
        id: appointment._id.toString(),
        number: index + 1,
        clientName: appointment.clientName,
        email: appointment.email,
        phone: appointment.phone,
        query: appointment.query,
        appointmentDateTime: appointment.appointmentDateTime,
        createdAt: appointment.createdAt,
        status: appointment.status,
        confirmation: appointment.confirmation,
      })),
    });
  } catch (error) {
    console.error("Fetch appointments error:", error);
    return res.status(500).json({ error: "Failed to fetch appointments." });
  }
});

router.put("/appointments/:id", async (req, res) => {
  const { id } = req.params;
  const { clientName, email, phone, query, appointmentDateTime, status } =
    req.body;
  try {
    const updateFields = {};
    if (clientName !== undefined) updateFields.clientName = clientName;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    if (query !== undefined) updateFields.query = query;
    if (appointmentDateTime !== undefined)
      updateFields.appointmentDateTime = appointmentDateTime;
    if (status !== undefined) updateFields.status = status;
    updateFields.updatedAt = new Date().toISOString();

    const result = await appointmentsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Appointment not found." });
    }
    return res.json({ success: true, updated: updateFields });
  } catch (error) {
    console.error("Update appointment error:", error);
    return res.status(500).json({ error: "Failed to update appointment." });
  }
});

router.delete("/appointments/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await appointmentsCollection.deleteOne({
      _id: new ObjectId(id),
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Appointment not found." });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete appointment error:", error);
    return res.status(500).json({ error: "Failed to delete appointment." });
  }
});

router.get("/appointments-ui", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "appointments.html"));
});

export default router;
