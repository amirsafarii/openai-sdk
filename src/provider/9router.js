import "dotenv/config";

import {
  configureProvider,
  createProviderClient,
  getProviderClient,
  detectProvider,
  providerBaseURL,
  providerApiKey,
  providerModel,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL
} from "../runtime/provider.js";

// Shared OpenAI-compatible client bound to the 9router gateway.
const provider = getProviderClient();

export {
  provider,
  configureProvider,
  createProviderClient,
  getProviderClient,
  detectProvider,
  providerBaseURL,
  providerApiKey,
  providerModel,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL
};

export default provider;
