# Wint Wealth – IR Portal

An AI-powered Investor Relations portal that connects to Google Drive as a knowledge base and uses Claude to answer queries from investors and analysts.

---

## Architecture

```
Next.js App (App Router)
├── /login            — Credentials-based login page
├── /                 — Main IR chat dashboard (protected)
├── /api/chat         — Streaming RAG pipeline (Drive → Claude)
└── /api/files        — Lists Drive knowledge base files

lib/
├── drive.ts          — Google Drive fetcher + text chunker + retriever
└── types.ts          — Shared TypeScript types

auth.ts               — NextAuth config (credentials provider)
middleware.ts         — Route protection
```

**Flow:** User query → fetch relevant chunks from Drive docs → inject as context into Claude prompt → stream response back with source citations.

---

## Prerequisites

- Node.js 18+
- An **Anthropic API key** — https://console.anthropic.com
- A **Google Cloud Service Account** with Drive API enabled
- A **Google Drive folder** containing your IR documents (PDFs, Google Docs, Word files)

---

## Setup

### 1. Clone & install

```bash
cd wint-ir-portal
npm install
```

### 2. Create `.env.local`

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

### 3. Set up Google Service Account

1. Go to Google Cloud Console (https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable **Google Drive API**
4. Create a **Service Account** under IAM & Admin → Service Accounts
5. Generate a **JSON key** for the service account
6. Paste the entire JSON content as one line into GOOGLE_SERVICE_ACCOUNT_JSON in .env.local
7. **Share your Google Drive folder** with the service account email — give it **Viewer** access

### 4. Prepare your Google Drive folder

Place your IR documents in the shared folder:
- PDFs (annual reports, policy docs, FAQs)
- Google Docs
- Word (.docx) files

The app will automatically fetch, parse, and index all documents.

### 5. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## Deployment (Vercel)

```bash
npm install -g vercel
vercel
```

Add all .env.local variables in Vercel project settings. Set NEXTAUTH_URL to your production domain.

---

## Adding IR users

Edit IR_USERS in .env.local:
```
IR_USERS=alice:Pass123,bob:Pass456
```

---

## Tech Stack

- Next.js 15 (App Router)
- Anthropic Claude (claude-opus-4-5) with streaming
- Google Drive API (PDFs, Docs, Word)
- NextAuth.js (credentials)
- Tailwind CSS
- pdf-parse + mammoth for document parsing
- In-memory keyword retrieval (RAG)
