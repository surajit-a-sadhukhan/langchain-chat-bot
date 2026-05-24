import { MongoClient, ObjectId } from "mongodb";
import { geminiKey, mongoUri, mongoDbName, mongoCollection, mongoChatCollection, mongoAppointmentsCollection, mongoUsersCollection, mongoTicketsCollection } from "./config.js";
import { setDocumentsCollection } from "./utils.js";

export let documentsCollection;
export let chatCollection;
export let appointmentsCollection;
export let usersCollection;
export let ticketsCollection;

export const initializeDatabase = async () => {
  if (!geminiKey) {
    throw new Error("Missing GOOGLE_API_KEY in .env");
  }
  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI in .env");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDbName);
  documentsCollection = db.collection(mongoCollection);
  chatCollection = db.collection(mongoChatCollection);
  appointmentsCollection = db.collection(mongoAppointmentsCollection);
  usersCollection = db.collection(mongoUsersCollection);
  ticketsCollection = db.collection(mongoTicketsCollection);

  setDocumentsCollection(documentsCollection);
  // ... existing logic ...
  await appointmentsCollection.createIndex({ createdAt: 1 });
  await ticketsCollection.createIndex({ ticketNo: 1 }, { unique: true });
  await ticketsCollection.createIndex({ userId: 1 });
  await ticketsCollection.createIndex({ status: 1 });
};