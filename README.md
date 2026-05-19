# LangChain Node.js Chatbot

A simple Node.js chatbot using LangChain and OpenAI.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the bot:
   ```bash
   npm start
   ```

3. Open the upload UI in your browser:
   ```bash
   open http://localhost:3000
   ```

4. Use the page to send chat messages and upload document text or .txt files.

## Environment

This project loads credentials from `.env`.

- `OPEN_KEY` for OpenAI
- `GEMINI_KEY` for Google Gemini / Google Generative AI
- `MONGODB_URI` for MongoDB Atlas persistence

If `GEMINI_KEY` is present, the bot will use the Google Gemini model first. Otherwise it will default to OpenAI.

## Features

- `GET /` serves a browser UI for chat and document upload
- `POST /upload` stores documents in MongoDB Atlas with embeddings
- `GET /documents` lists uploaded documents
- `POST /chat` performs retrieval from MongoDB and enriches the model prompt with nearest document text
