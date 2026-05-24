import { MongoClient, ObjectId } from "mongodb";
import { geminiKey, mongoUri, mongoDbName, mongoCollection, mongoChatCollection, mongoAppointmentsCollection, mongoUsersCollection } from "./config.js";
import { setDocumentsCollection } from "./utils.js";

export let documentsCollection;
export let chatCollection;
export let appointmentsCollection;
export let usersCollection;

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

  setDocumentsCollection(documentsCollection);

  // 1. Fix the distorted name for your user
  try {
    await usersCollection.updateOne(
      { _id: new ObjectId("67b32ee0b140e86775c6e2cf") },
      { $set: { name: "Surajit" } },
    );
  } catch (e) {
    console.warn("Migration: Could not update specific user name");
  }

  // 2. Map all unassigned data to your user ID
  const targetUserId = "67b32ee0b140e86775c6e2cf";
  const migrationFilter = {
    $or: [{ userId: { $exists: false } }, { userId: null }, { userId: "1" }],
  };

  await documentsCollection.updateMany(migrationFilter, {
    $set: { userId: targetUserId },
  });
  await appointmentsCollection.updateMany(migrationFilter, {
    $set: { userId: targetUserId },
  });
  await chatCollection.updateMany(migrationFilter, {
    $set: { userId: targetUserId },
  });

  await documentsCollection.createIndex({
    title: "text",
    source: "text",
    text: "text",
  });
  await documentsCollection.createIndex({ uploadedAt: 1 });
  await documentsCollection.createIndex({ userId: 1 });
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await chatCollection.createIndex({ message: "text", response: "text" });
  await chatCollection.createIndex({ createdAt: 1 });
  await appointmentsCollection.createIndex({
    clientName: "text",
    query: "text",
    appointmentDateTime: 1,
  });
  await appointmentsCollection.createIndex({ createdAt: 1 });
};