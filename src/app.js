import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { geminiKey, mongoUri, port } from "./config.js";
import { invokeLLM, parseLlmJsonResponse, hashPassword, verifyPassword, scheduleLocalAppointment, evaluateLlmDecision, getNearestDocuments } from "./utils.js";
import { initializeDatabase, documentsCollection, chatCollection, appointmentsCollection, usersCollection } from "./db.js";
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import appointmentRoutes from './routes/appointments.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import ticketRoutes from './routes/tickets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(authRoutes);
app.use(documentRoutes);
app.use(appointmentRoutes);
app.use(chatRoutes);
app.use(adminRoutes);
app.use(ticketRoutes);

initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Agentic AI server listening on http://localhost:${port}`);
  });
}).catch((error) => {
  console.error("Failed to start Agentic AI:", error);
  process.exit(1);
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "An internal server error occurred." });
});
