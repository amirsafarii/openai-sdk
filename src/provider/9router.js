import "dotenv/config";

import OpenAI from "openai";

const provider = new OpenAI({
   apiKey: process.env.OPENROUTER_API_KEY,
   baseURL: process.env.OPENROUTER_BASE_URL
});

export {
  provider
}
