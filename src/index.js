import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

dotenv.config();

const openAiKey = process.env.OPEN_KEY;
const openAiEndpoint = process.env.OPENAI_ENDPOINT || "https://api.openai.com";
const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || "chatbot";
const mongoCollection = process.env.MONGODB_COLLECTION || "documents";
const mongoQueriesCollection = process.env.MONGODB_QUERIES_COLLECTION || "queries";

if (!openAiKey) {
  throw new Error("Missing OPEN_KEY in .env");
}

if (!mongoUri) {
  throw new Error("Missing MONGODB_URI in .env");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const openAiModel = buildOpenAIModel();
const embeddings = buildEmbeddings();
let documentsCollection;
let queriesCollection;

function buildOpenAIModel() {
  return new ChatOpenAI({
    apiKey: openAiKey,
    model: "gpt-4o-mini",
    temperature: 0.7,
    configuration: {
      baseURL: openAiEndpoint,
    },
  });
}

async function invokeLLM(prompt) {
  return await openAiModel.invoke(prompt);
}

function buildEmbeddings() {
  return new OpenAIEmbeddings({
    openAIApiKey: openAiKey,
    modelName: "text-embedding-3-small",
    configuration: {
      baseURL: openAiEndpoint,
    },
  });
}

async function initMongo() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDbName);
  documentsCollection = db.collection(mongoCollection);
  queriesCollection = db.collection(mongoQueriesCollection);
  await documentsCollection.createIndex({ title: "text", source: "text", text: "text" });
  await documentsCollection.createIndex({ uploadedAt: 1 });
  await queriesCollection.createIndex({ title: "text", description: "text", message: "text" });
  await queriesCollection.createIndex({ createdAt: 1 });
}

function cosineSimilarity(a, b) {
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
}

async function getNearestDocuments(query, limit = 3) {
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
}

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

app.post("/query", async (req, res) => {
  const { title, description, message } = req.body;
  if (!title || !description || !message) {
    return res.status(400).json({ error: "title, description and message are required" });
  }

  try {
    const prompt = `Query title: ${title}\nDescription: ${description}\nQuestion: ${message}`;
    const response = await invokeLLM(prompt);
    const result = response?.text ?? (typeof response?.content === "string" ? response.content : response);

    const queryDoc = {
      title,
      description,
      message,
      response: result,
      status: "open",
      createdAt: new Date().toISOString(),
      provider: "openai",
    };
    const insertResult = await queriesCollection.insertOne(queryDoc);

    return res.json({
      success: true,
      query: {
        id: insertResult.insertedId.toString(),
        title,
        description,
        status: queryDoc.status,
        response: result,
      },
    });
  } catch (error) {
    console.error("Query error:", error);
    return res.status(500).json({ error: "Failed to create query." });
  }
});

app.get("/queries", async (req, res) => {
  try {
    const queries = await queriesCollection
      .find({}, { projection: { title: 1, description: 1, status: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    return res.json({ queries: queries.map((query, index) => ({
      id: query._id.toString(),
      number: index + 1,
      title: query.title,
      description: query.description,
      status: query.status,
      createdAt: query.createdAt,
    })) });
  } catch (error) {
    console.error("Fetch queries error:", error);
    return res.status(500).json({ error: "Failed to fetch queries." });
  }
});

app.patch("/queries/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid query id." });
  }
  if (!status || !["open", "pending"].includes(status)) {
    return res.status(400).json({ error: "Status must be open or pending." });
  }

  try {
    const result = await queriesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status } },
      { returnDocument: "after" }
    );
    if (!result.value) {
      return res.status(404).json({ error: "Query not found." });
    }
    return res.json({ success: true, query: { id, status: result.value.status } });
  } catch (error) {
    console.error("Update query status error:", error);
    return res.status(500).json({ error: "Failed to update query status." });
  }
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "A message is required in the request body." });
  }

  try {
    const relevantDocs = await getNearestDocuments(message, 3);
    console.log("Relevant documents:", relevantDocs);
    const context = relevantDocs
      .map((doc, index) => `Document ${index + 1} [${doc.title} | ${doc.source}]:\n${doc.text}`)
      .join("\n\n");
    const prompt = context
      ? `Use the following documents to help answer the question:\n\n${context}\n\nQuestion: ${message}`
      : message;
    const response = await invokeLLM(prompt);
    const result =
      response?.text ??
      (typeof response?.content === "string" ? response.content : response);
    return res.json({ response: result, retrievedDocuments: relevantDocs.map((doc) => ({ title: doc.title, source: doc.source, score: doc.score })) });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Failed to generate a response." });
  }
});

const port = process.env.PORT || 3000;

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
