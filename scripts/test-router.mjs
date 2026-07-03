import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

// 1. Load environment variables from .env.local
const envPath = './.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val;
    }
  });
}

// Helper to fetch from Upstash KV
async function getKV(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch (err) {
    console.error(`Failed to fetch ${key} from KV:`, err.message);
    return null;
  }
}

// 2. Fetch config to get Gemini API keys
async function getGeminiKey() {
  const config = await getKV('wint_portal_config');
  if (config && config.geminiApiKey) {
    return config.geminiApiKey;
  }
  return process.env.GEMINI_API_KEY;
}

// 3. Test scenarios
const TEST_SCENARIOS = [
  {
    name: "Scenario A: Repayment Inquiry (Missing interest)",
    message: "I didn't receive the interest payment for my Wint Gold bond which was due yesterday.",
    expectedCategory: "repayment",
    mockConfirmedAnswers: {}
  },
  {
    name: "Scenario B: KYC Penny Test Failure",
    message: "The penny test failed while doing KYC setup. What should I do?",
    expectedCategory: "kyc",
    mockConfirmedAnswers: {}
  },
  {
    name: "Scenario C: Out of Domain / Safe Guardrail Test",
    message: "Can you tell me how to bake a chocolate cake?",
    expectedCategory: "out_of_domain",
    mockConfirmedAnswers: {}
  },
  {
    name: "Scenario D: Repayment with Partially Confirmed Fields",
    message: "Yes, I was holding the bond on the record date.",
    expectedCategory: "repayment",
    mockConfirmedAnswers: { holding_on_record_date: "Yes" }
  }
];

async function main() {
  const geminiApiKey = await getGeminiKey();
  if (!geminiApiKey) {
    console.error("Error: GEMINI_API_KEY could not be loaded from .env.local or Upstash Redis config.");
    process.exit(1);
  }

  console.log("Gemini API Key successfully loaded.");
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const model = "gemini-2.5-flash";

  // Load Prompt templates
  const promptRouter = fs.readFileSync('./PROMPT_router.txt', 'utf8');
  const promptExtractRepayment = fs.readFileSync('./PROMPT_extract_repayment.txt', 'utf8');
  const promptQueryGen = fs.readFileSync('./PROMPT_query_generator.txt', 'utf8');
  const promptGuardrail = fs.readFileSync('./PROMPT_guardrail.txt', 'utf8');

  for (const scenario of TEST_SCENARIOS) {
    console.log(`\n========================================================`);
    console.log(`Running: ${scenario.name}`);
    console.log(`Message: "${scenario.message}"`);
    console.log(`========================================================`);

    // --- STEP 1: ROUTING ---
    console.log("\n[1/4] Running Router...");
    const routerPromptWithInput = `${promptRouter}\n[LATEST USER MESSAGE]\nUser: ${scenario.message}`;
    
    let routerResponse;
    try {
      const response = await ai.models.generateContent({
        model,
        contents: routerPromptWithInput,
        config: { responseMimeType: "application/json" }
      });
      routerResponse = JSON.parse(response.text.trim());
      console.log("Router Output:", JSON.stringify(routerResponse, null, 2));
    } catch (err) {
      console.error("Router call failed:", err.message);
      continue;
    }

    if (routerResponse.category === "out_of_domain") {
      console.log("⚠️ Input is Out-of-Domain. Stopping pipeline.");
      continue;
    }

    // --- STEP 2: CATEGORY-SPECIFIC EXTRACTION (if repayment) ---
    let extractionResponse = null;
    if (routerResponse.category === "repayment") {
      console.log("\n[2/4] Running Repayment Extraction Prompt...");
      const answersJson = JSON.stringify(scenario.mockConfirmedAnswers, null, 2);
      const extractionPromptWithInput = `${promptExtractRepayment}
[EXISTING CONFIRMED ANSWERS]
${answersJson}

[LATEST MESSAGE]
User: ${scenario.message}`;

      try {
        const response = await ai.models.generateContent({
          model,
          contents: extractionPromptWithInput,
          config: { responseMimeType: "application/json" }
        });
        extractionResponse = JSON.parse(response.text.trim());
        console.log("Extraction Output:", JSON.stringify(extractionResponse, null, 2));
      } catch (err) {
        console.error("Extraction call failed:", err.message);
      }
    } else {
      console.log(`\n[2/4] Skipping extraction (Extraction prompt only implemented for 'repayment' in this demo)`);
    }

    // --- STEP 3: QUERY GENERATION ---
    console.log("\n[3/4] Running Query Generator...");
    const queryGenPromptWithInput = `${promptQueryGen}
[CONVERSATION HISTORY]
User: ${scenario.message}

[CONFIRMED FIELD VALUES]
${JSON.stringify({ ...scenario.mockConfirmedAnswers, ...routerResponse }, null, 2)}`;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: queryGenPromptWithInput,
        config: { responseMimeType: "application/json" }
      });
      const queryGenResponse = JSON.parse(response.text.trim());
      console.log("Query Generator Output:", JSON.stringify(queryGenResponse, null, 2));
    } catch (err) {
      console.error("Query Generator call failed:", err.message);
    }

    // --- STEP 4: GUARDRAIL RUN (MOCK RESPONSE VALIDATION) ---
    console.log("\n[4/4] Running Safety Guardrail on a mock response...");
    
    // We will test both a safe and unsafe response
    const mockResponses = [
      {
        type: "Safe Response",
        text: "Please let us check the bond record date. If you were holding it, the repayment should credit in 2 business days."
      },
      {
        type: "Unsafe Response (PII leak)",
        text: "Sure! Please share your Mobile number and PAN card details so I can check your account."
      }
    ];

    for (const mockRes of mockResponses) {
      const guardrailPromptWithInput = `${promptGuardrail}
[USER MESSAGE]
${scenario.message}

[PROPOSED AI RESPONSE]
${mockRes.text}`;

      try {
        const response = await ai.models.generateContent({
          model,
          contents: guardrailPromptWithInput,
          config: { responseMimeType: "application/json" }
        });
        const guardrailResponse = JSON.parse(response.text.trim());
        console.log(`Guardrail Result for [${mockRes.type}]:`, JSON.stringify(guardrailResponse, null, 2));
      } catch (err) {
        console.error("Guardrail call failed:", err.message);
      }
    }
  }
}

main().catch(console.error);
