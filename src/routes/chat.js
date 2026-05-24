import express from "express";
import { chatCollection, appointmentsCollection, ticketsCollection } from "../db.js";
import { geminiModelName } from "../config.js";
import { invokeLLM, evaluateLlmDecision, getNearestDocuments } from "../utils.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  const { message, history, appointmentDetails, userId, userName, userEmail } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    const currentUserId = userId;
    if (!currentUserId) {
      return res.status(401).json({ error: "Missing userId" });
    }
    const relevantDocs = await getNearestDocuments(message, currentUserId, 3);
    console.log("Relevant documents found:", relevantDocs);
    const context = relevantDocs
      .map(
        (doc, index) =>
          `Document ${index + 1}: ${doc.title}\nSource: ${doc.source}\nText: ${doc.text}`,
      )
      .join("\n\n");

    const detailsState = `
Current collected details so far:
- Client Name: ${appointmentDetails?.clientName || "not provided"}
- Email Address: ${appointmentDetails?.email || "not provided"}
- Phone/Contact: ${appointmentDetails?.phone || "not provided"}
- Preferred Date & Time: ${appointmentDetails?.appointmentDateTime || "not provided"}
- Topic / Reason: ${appointmentDetails?.query || "not provided"}
`;

    const systemInstruction = `You are a helpful assistant that receives a user question and decides whether it should trigger a local action:
1. "appointment": For scheduling a meeting.
2. "query_ticket": For when a user reports a problem or asks a complex query that needs support tracking.

Today's Date: ${new Date().toDateString()}

TO SCHEDULE AN APPOINTMENT (appointment: true):
You MUST gather: Client Name (clientName), Email (email), Phone (phone), and Date/Time (appointmentDateTime).

TO CREATE A SUPPORT TICKET (query_ticket: true):
If the user is reporting a bug, technical issue, or problem that requires investigation, set query_ticket to true.
You MUST gather:
- subject: a short summary of the issue
- description: a detailed explanation of the problem

Rules:
- Review "Current collected details so far".
- If important details for either action are missing, set the action to false and ask for missing info.
- Once ALL details for a ticket are present, set query_ticket to true.

Respond ONLY in valid JSON:
- appointment: true/false
- query_ticket: true/false
- reason: short explanation
- response: natural-language response
- details: object with keys: clientName, email, phone, appointmentDateTime, query, subject, description.
`;

    const formattedHistory =
      Array.isArray(history) && history.length > 0
        ? history
            .map(
              (h) =>
                `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`,
            )
            .join("\n")
        : "";

    const prompt = relevantDocs.length
      ? `${systemInstruction}\n\nContext:\n${context}\n\n${detailsState}\n\n${formattedHistory ? `Conversation History:\n${formattedHistory}\n\n` : ""}Question: ${message}`
      : `${systemInstruction}\n\n${detailsState}\n\n${formattedHistory ? `Conversation History:\n${formattedHistory}\n\n` : ""}Question: ${message}`;
    
    const resp = await invokeLLM(prompt);
    const rawResponse = resp?.content;

    const decision = evaluateLlmDecision(rawResponse, message);

    const chatDoc = {
      message,
      response: decision.response,
      retrievedDocuments: relevantDocs.map((doc) => ({
        title: doc.title,
        source: doc.source,
        score: doc.score,
      })),
      createdAt: new Date().toISOString(),
      provider: "google",
      model: geminiModelName,
      appointment: decision.appointment,
      query_ticket: decision.query_ticket,
      llmReason: decision.reason,
      userId: currentUserId,
    };

    await chatCollection.insertOne(chatDoc);

    let savedAppointment = null;
    if (decision.appointment && appointmentsCollection) {
      const appointmentDoc = {
        clientName: decision.details?.clientName || "Unknown Client",
        email: decision.details?.email || "",
        phone: decision.details?.phone || "",
        query: decision.details?.query || message,
        appointmentDateTime:
          decision.details?.appointmentDateTime || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: "scheduled",
        confirmation: "Appointment has been set.",
        llmReason: decision.reason,
        userId: currentUserId,
      };
      const appointmentResult = await appointmentsCollection.insertOne(appointmentDoc);
      savedAppointment = { ...appointmentDoc, id: appointmentResult.insertedId.toString() };
    }

    let savedTicket = null;
    if (decision.query_ticket && ticketsCollection) {
      const ticketNo = `TIC-${Date.now()}`;
      const ticketDoc = {
        ticketNo,
        userId: currentUserId,
        userName: userName || "User",
        userEmail: userEmail || "",
        subject: decision.details?.subject || "Support Query",
        description: decision.details?.description || message,
        status: "open",
        createdAt: new Date().toISOString(),
        llmReason: decision.reason
      };
      const result = await ticketsCollection.insertOne(ticketDoc);
      savedTicket = { ...ticketDoc, id: result.insertedId.toString() };
      decision.response = `I have created a support ticket for you. Ticket Number: ${ticketNo}. ${decision.response}`;
    }

    return res.json({
      response: decision.response,
      retrievedDocuments: chatDoc.retrievedDocuments,
      appointment: decision.appointment,
      query_ticket: decision.query_ticket,
      savedAppointment,
      savedTicket,
      details: decision.details || null,
      reason: decision.reason,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to generate a response." });
  }
});
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to generate a response." });
  }
});

router.get("/chats", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(401).json({ error: "Missing userId" });
    }
    const chats = await chatCollection
      .find(
        { userId },
        { projection: { message: 1, response: 1, createdAt: 1, retrievedDocuments: 1 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({
      chats: chats.map((chat, index) => ({
        id: chat._id.toString(),
        number: index + 1,
        message: chat.message,
        response: chat.response,
        retrievedDocuments: chat.retrievedDocuments || [],
        createdAt: chat.createdAt,
      })),
    });
  } catch (error) {
    console.error("Fetch chats error:", error);
    return res.status(500).json({ error: "Failed to fetch chat history." });
  }
});

export default router;
