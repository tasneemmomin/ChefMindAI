// Preloaded before every test file (see the "test" script in package.json).
// dotenv never overrides variables that already exist, so pinning these here keeps a
// developer's real .env keys out of the suite and guarantees no live AI calls are made.
process.env.GROQ_API_KEY = "";
process.env.LLM_GATEWAY_URL = "";
process.env.LLM_GATEWAY_API_KEY = "";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.LLM_LOG = "off";
