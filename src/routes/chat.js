import express from "express";
import { chatCollection, appointmentsCollection } from "../db.js";
import { geminiModelName } from "../config.js";
import { invokeLLM, evaluateLlmDecision, getNearestDocuments } from "../utils.js";

const router = express.Router();

router.post("/chat", async (req, res) => {
  const { message, history, appointmentDetails, userId } = req.body;
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

    const systemInstruction = `You are a helpful assistant that receives a user question and decides whether it should trigger a local appointment action.\n\nToday\\\\\\\\\\\\\\\"s Date: ${new Date().toDateString()}\n\nTo schedule an appointment, you MUST gather all the following important details:\n- Client Name (clientName)\n- Email Address (email)\n- Contact / Phone Number (phone)\n- Preferred Appointment Date & Time (appointmentDateTime) - parse this into a valid ISO 8601 string or readable date-time string if possible.\n\nOptional detail:\n- Topic / Reason for appointment (query) - collect this if the user volunteers it, but do not block scheduling if it is missing.\n\nRules for scheduling an appointment:\n- Review the \"Current collected details so far\" section below.\n- Analyze the user\\\\\\\\\\\\\\\\\\\\\\\"s new message and the conversation history to update these details.\n- Always output the full updated state of all collected details (both previously collected and newly identified) in the \"details\" object in your JSON response. Do not lose any details that were already collected.\n- If any of the important details (Name, Email, Phone/Contact, and Date/Time) are missing, you MUST NOT trigger the appointment. Set \"appointment\" to false, and in the \"response\", politely ask the user for the missing details.\n- Once (and only when) ALL the important details (Name, Email, Phone/Contact, and Date/Time) are gathered, set \"appointment\" to true and populate the \"details\" object with the complete collected values. Set a friendly confirmation message in \"response\".\n\nRespond only in valid JSON with these keys:\n- appointment: true or false\n- reason: a short explanation of your decision\n- response: a natural-language answer to the user (e.g. answering a question, asking for missing appointment details, or confirming the scheduled appointment)\n- details: object with keys: clientName, email, phone, appointmentDateTime, query. Ensure you include all details collected so far.\n`;

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
    console.log("Constructed prompt for LLM:", prompt);
    const resp = await invokeLLM(prompt);
    const response = resp?.content;
    console.log("LLM raw response:", response);
    const rawResponse =
      response?.text ??
      (typeof response?.content === "string" ? response.content : response);

    const decision = evaluateLlmDecision(rawResponse, message);
    // try {
    //   const openRouterModel = new ChatOpenRouter(
    //     langchainmodel,
    //     { temperature: 0.8 }
    //   );
    //   console.log("prompt -->", prompt)
    //   const resp = await openRouterModel.invoke(prompt);
    //   console.log("----------------------------------------------------");
    //   console.log("Raw OpenRouter response:", resp?.content);
    //   const parseItm = parseLlmJsonResponse(resp?.content);
    //   console.log("----------------------------------------------------");
    //   console.log("Parsed OpenRouter JSON response:", parseItm);
    // }
    // catch (e) {
    //   console.error("Error invoking OpenRouter model:", e);
    // }
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
      appointmentResult: decision.appointmentResult,
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
      const appointmentResult =
        await appointmentsCollection.insertOne(appointmentDoc);
      savedAppointment = {
        ...appointmentDoc,
        id: appointmentResult.insertedId.toString(),
      };
      console.log("Appointment saved to database:", savedAppointment);
    }

    return res.json({
      response: decision.response,
      retrievedDocuments: chatDoc.retrievedDocuments,
      appointment: decision.appointment,
      appointmentResult: decision.appointmentResult,
      savedAppointment,
      details: decision.details || null,
      reason: decision.reason,
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
