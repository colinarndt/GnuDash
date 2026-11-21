import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET env vars are required");
  }
  const env = (process.env.PLAID_ENV ?? "sandbox") as keyof typeof PlaidEnvironments;
  if (!(env in PlaidEnvironments)) {
    throw new Error(
      `Invalid PLAID_ENV "${env}". Must be: sandbox or production`
    );
  }
  _client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    })
  );
  return _client;
}
