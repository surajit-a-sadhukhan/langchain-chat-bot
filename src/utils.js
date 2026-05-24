import crypto from "crypto";
import * as chrono from "chrono-node";
import { ObjectId } from "mongodb";
import { ChatOpenRouter } from "@langchain/openrouter";
import { geminiKey, geminiModelName, langchainmodel } from "./config.js";

// Placeholder for documentsCollection, will be imported from db.js later
let documentsCollection;
export const setDocumentsCollection = (collection) => {
  documentsCollection = collection;
};

const openRouterModel = new ChatOpenRouter(langchainmodel, {
  temperature: 0.8,
});
export const invokeLLM = async (prompt) => await openRouterModel.invoke(prompt);

export const parseLlmJsonResponse = (text) => {
  // console.log("Parsing LLM response for JSON:", text);
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

export const hashPassword = (
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) => {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
};

export const verifyPassword = (password, storedHash) => {
  if (!storedHash || typeof storedHash !== "string") return false;
  const [salt, derived] = storedHash.split(":");
  if (!salt || !derived) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(derived, "hex"),
  );
};

export const scheduleLocalAppointment = (details) => {
  const appointmentDetails = {
    clientName: null,
    email: null,
    phone: null,
    query: null,
    appointmentDateTime: null,
    ...(typeof details === "object" && details !== null
      ? details
      : { info: details }),
  };

  const appointment = {
    id: `appt_${Date.now()}`,
    createdAt: new Date().toISOString(),
    clientName: appointmentDetails.clientName || "Unknown Client",
    email: appointmentDetails.email || "",
    phone: appointmentDetails.phone || "",
    query: appointmentDetails.query || "",
    appointmentDateTime:
      appointmentDetails.appointmentDateTime || new Date().toISOString(),
    details: appointmentDetails,
    status: "scheduled",
    confirmation: "Appointment has been set.",
  };
  // console.log("Local appointment triggered:", appointment);
  return appointment;
};

export const evaluateLlmDecision = (rawResponse, message) => {
  // console.log("Raw LLM response:", rawResponse);
  // console.log("Original message:", message);
  let decision;
  try {
    decision = parseLlmJsonResponse(rawResponse);
  } catch (error) {
    console.error(
      "Unable to parse LLM decision JSON:",
      error,
      "rawResponse:",
      rawResponse,
    );
    return {
      appointment: false,
      reason: "Could not parse JSON from LLM response.",
      response: rawResponse,
      appointmentResult: null,
      details: null,
    };
  }

  // Parse natural language dates in the LLM response details
  let appointmentResult = null;
  if (decision.details) {
    if (decision.details.appointmentDateTime) {
      const rawDate = decision.details.appointmentDateTime;
      const parsedDate = chrono.parseDate(rawDate);
      if (parsedDate) {
        console.log(
          `Parsed natural language date "${rawDate}" to "${parsedDate.toISOString()}"`,
        );
        decision.details.appointmentDateTime = parsedDate.toISOString();
      }
    }

    if (decision.appointment) {
      appointmentResult = scheduleLocalAppointment(decision.details);
    }
  }

  return {
    appointment: Boolean(decision.appointment),
    reason: typeof decision.reason === "string" ? decision.reason : "",
    response:
      typeof decision.response === "string" ? decision.response : rawResponse,
    details: decision.details || null,
    appointmentResult,
  };
};

export const getNearestDocuments = async (query, userId = 1, limit = 3) => {
  if (!documentsCollection) {
    return [];
  }
  const results = await documentsCollection
    .find(
      { $text: { $search: query }, userId },
      {
        projection: {
          title: 1,
          source: 1,
          text: 1,
          uploadedAt: 1,
          score: { $meta: "textScore" },
        },
      },
    )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();
  return results;
};
