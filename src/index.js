import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

dotenv.config();

const openAiKey = process.env.OPEN_KEY;
const openAiEndpoint = process.env.OPENAI_ENDPOINT || "https://api.openai.com";
const openAiBaseUrl = openAiEndpoint.replace(/\/$/, "") + "/v1";
const openAiModelName = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const openAiEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "chatbot";
const mongoCollection = process.env.MONGODB_COLLECTION || "documents";
const mongoChatCollection = process.env.MONGODB_CHAT_COLLECTION || "chats";
const mongoAppointmentsCollection = process.env.MONGODB_APPOINTMENTS_COLLECTION || "appointments";

if (!openAiKey) {
  throw new Error("Missing OPEN_KEY in .env");
}

if (!mongoUri) {
  throw new Error("Missing MONGODB_URI in .env");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const buildOpenAIModel = () =>
  new ChatOpenAI({
    apiKey: openAiKey,
    model: openAiModelName,
    temperature: 0.7,
    configuration: {
      baseURL: openAiBaseUrl,
    },
  });

const invokeLLM = async (prompt) => await openAiModel.invoke(prompt);

const buildEmbeddings = () =>
  new OpenAIEmbeddings({
    openAIApiKey: openAiKey,
    modelName: openAiEmbeddingModel,
    configuration: {
      baseURL: openAiBaseUrl,
    },
  });

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const parseLlmJsonResponse = (text) => {
  console.log("Parsing LLM response for JSON:", text);
  if (!text || typeof text !== "string") {
    throw new Error("LLM response is empty or invalid.");
  }

  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (firstError) {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through
      }
    }
    throw new Error("Unable to parse JSON from LLM response.");
  }
};

const scheduleLocalAppointment = (details) => {
  const appointmentDetails = {
    clientName: null,
    email: null,
    phone: null,
    query: null,
    appointmentDateTime: null,
    ...(typeof details === "object" && details !== null ? details : { info: details }),
  };

  const appointment = {
    id: `appt_${Date.now()}`,
    createdAt: new Date().toISOString(),
    clientName: appointmentDetails.clientName || "Unknown Client",
    email: appointmentDetails.email || "",
    phone: appointmentDetails.phone || "",
    query: appointmentDetails.query || "",
    appointmentDateTime: appointmentDetails.appointmentDateTime || new Date().toISOString(),
    details: appointmentDetails,
    status: "scheduled",
    confirmation: "Appointment has been set.",
  };
  console.log("Local appointment triggered:", appointment);
  return appointment;
};

const evaluateLlmDecision = (rawResponse, message) => {
  console.log("Raw LLM response:", rawResponse);
  console.log("Original message:", message);
  let decision;
  try {
    decision = parseLlmJsonResponse(rawResponse);
  } catch (error) {
    console.error("Unable to parse LLM decision JSON:", error, "rawResponse:", rawResponse);
    return {
      technical: false,
      appointment: false,
      reason: "Could not parse JSON from LLM response.",
      response: rawResponse,
      appointmentResult: null,
    };
  }

  const appointmentResult = decision.appointment
    ? scheduleLocalAppointment(decision.details || {
        clientName: null,
        email: null,
        phone: null,
        query: message,
        appointmentDateTime: new Date().toISOString(),
      })
    : null;

  return {
    technical: Boolean(decision.technical),
    appointment: Boolean(decision.appointment),
    reason: typeof decision.reason === "string" ? decision.reason : "",
    response: typeof decision.response === "string" ? decision.response : rawResponse,
    details: decision.details || null,
    appointmentResult,
  };
};

const getNearestDocuments = async (query, limit = 3) => {
  if (!documentsCollection) {
    return [];
  }
  const queryEmbedding = await embeddings.embedQuery(query);
  const rows = await documentsCollection
    .find({ embedding: { $exists: true } }, { projection: { title: 1, source: 1, text: 1, embedding: 1, uploadedAt: 1 } })
    .toArray();
  return rows
    .map((row) => ({
      ...row,
      score: cosineSimilarity(queryEmbedding, row.embedding || []),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const openAiModel = buildOpenAIModel();
const embeddings = buildEmbeddings();
let documentsCollection;
let chatCollection;
let appointmentsCollection;

const initMongo = async () => {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDbName);
  documentsCollection = db.collection(mongoCollection);
  chatCollection = db.collection(mongoChatCollection);
  appointmentsCollection = db.collection(mongoAppointmentsCollection);
  await documentsCollection.createIndex({ title: "text", source: "text", text: "text" });
  await documentsCollection.createIndex({ uploadedAt: 1 });
  await chatCollection.createIndex({ message: "text", response: "text" });
  await chatCollection.createIndex({ createdAt: 1 });
  await appointmentsCollection.createIndex({ clientName: "text", query: "text", appointmentDateTime: 1 });
  await appointmentsCollection.createIndex({ createdAt: 1 });
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Serve the documents UI page (keeps the API route at /documents intact)
app.get("/documents-ui", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "documents.html"));
});

app.get("/documents", async (req, res) => {
  const docs = await documentsCollection
    .find({}, { projection: { title: 1, source: 1, text: 1, uploadedAt: 1 } })
    .sort({ uploadedAt: -1 })
    .toArray();
  return res.json({
    documents: docs.map((doc) => ({
      id: doc._id.toString(),
      title: doc.title,
      source: doc.source,
      length: doc.text.length,
      uploadedAt: doc.uploadedAt,
    })),
  });
});

app.post("/upload", async (req, res) => {
  const { title, source, text } = req.body;
  if (!title || !text) {
    return res.status(400).json({ error: "title and text are required" });
  }

  try {
    const embedding = await embeddings.embedQuery(text);
    const document = {
      title,
      source: source || "manual",
      text,
      embedding,
      uploadedAt: new Date().toISOString(),
      provider: "openai",
    };
    const result = await documentsCollection.insertOne(document);
    return res.json({ success: true, document: { id: result.insertedId.toString(), title } });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ error: "Failed to upload document." });
  }
});

app.get("/appointments", async (req, res) => {
  try {
    const appointments = await appointmentsCollection
      .find({}, { projection: { clientName: 1, email: 1, phone: 1, query: 1, appointmentDateTime: 1, createdAt: 1, status: 1, confirmation: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ appointments: appointments.map((appointment, index) => ({
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
    })) });
  } catch (error) {
    console.error("Fetch appointments error:", error);
    return res.status(500).json({ error: "Failed to fetch appointments." });
  }
});

app.get("/appointments-ui", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "appointments.html"));
});

app.post("/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    const relevantDocs = await getNearestDocuments(message, 3);
    console.log("Relevant documents found:", relevantDocs);
    const context = relevantDocs
      .map(
        (doc, index) =>
          `Document ${index + 1}: ${doc.title}\nSource: ${doc.source}\nText: ${doc.text}`
      )
      .join("\n\n");

    const systemInstruction = `You are a helpful assistant that receives a user question and decides two things:
1. Whether the question is technical.
2. Whether it should trigger a local appointment action.

To schedule an appointment, you MUST gather all the following details:
- Client Name (clientName)
- Email Address (email)
- Phone Number (phone)
- Preferred Appointment Date & Time (appointmentDateTime) - parse this into a valid ISO 8601 string or readable date-time string if possible.
- Topic / Reason for appointment (query)

Rules for scheduling an appointment:
- Check the conversation history and the current question to see which details have been provided.
- If the user wants to book/schedule an appointment, but any of the required details (Name, Email, Phone, Date/Time, or Topic) are missing, you MUST NOT trigger the appointment. Set "appointment" to false, and in the "response", politely ask the user for the missing details.
- Once (and only when) ALL the required details are gathered, set "appointment" to true and populate the "details" object with the collected values. Set a friendly confirmation message in "response".

Respond only in valid JSON with these keys:
- technical: true or false
- appointment: true or false
- reason: a short explanation of your decision
- response: a natural-language answer to the user (e.g. answering a question, asking for missing appointment details, or confirming the scheduled appointment)
- details: object with keys: clientName, email, phone, appointmentDateTime, query
`;

    const formattedHistory = Array.isArray(history) && history.length > 0
      ? history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join("\n")
      : "";

    const prompt = relevantDocs.length
      ? `${systemInstruction}\n\nContext:\n${context}\n\n${formattedHistory ? `Conversation History:\n${formattedHistory}\n\n` : ""}Question: ${message}`
      : `${systemInstruction}\n\n${formattedHistory ? `Conversation History:\n${formattedHistory}\n\n` : ""}Question: ${message}`;
console.log("Constructed prompt for LLM:", prompt);
    const response = await invokeLLM(prompt);
    console.log("LLM raw response:", response);
    const rawResponse =
      response?.text ??
      (typeof response?.content === "string" ? response.content : response);

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
      provider: "openai",
      model: openAiModelName,
      technical: decision.technical,
      appointment: decision.appointment,
      appointmentResult: decision.appointmentResult,
      llmReason: decision.reason,
    };

    if (decision.technical) {
      await chatCollection.insertOne(chatDoc);
      console.log("Technical question saved to database:", message);
    } else {
      console.log("Non-technical question, not saved:", message);
    }

    let savedAppointment = null;
    if (decision.appointment && appointmentsCollection) {
      const appointmentDoc = {
        clientName: decision.details?.clientName || "Unknown Client",
        email: decision.details?.email || "",
        phone: decision.details?.phone || "",
        query: decision.details?.query || message,
        appointmentDateTime: decision.details?.appointmentDateTime || new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: "scheduled",
        confirmation: "Appointment has been set.",
        llmReason: decision.reason,
      };
      const appointmentResult = await appointmentsCollection.insertOne(appointmentDoc);
      savedAppointment = {
        ...appointmentDoc,
        id: appointmentResult.insertedId.toString(),
      };
      console.log("Appointment saved to database:", savedAppointment);
    }

    return res.json({
      response: decision.response,
      retrievedDocuments: chatDoc.retrievedDocuments,
      technical: decision.technical,
      appointment: decision.appointment,
      appointmentResult: decision.appointmentResult,
      savedAppointment,
      reason: decision.reason,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to generate a response." });
  }
});

app.get("/chats", async (req, res) => {
  try {
    const chats = await chatCollection
      .find({}, { projection: { message: 1, response: 1, createdAt: 1, retrievedDocuments: 1 } })
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
      })) 
    });
  } catch (error) {
    console.error("Fetch chats error:", error);
    return res.status(500).json({ error: "Failed to fetch chat history." });
  }
});

const port = process.env.PORT || 3001;

initMongo()
  .then(() => {
    app.listen(port, () => {
      console.log(`Chatbot server listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize MongoDB:", error);
    process.exit(1);
  });
