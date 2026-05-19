const REQUIRED: ReadonlyArray<string> = ["DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY"];

export function validateEnv(): void {
  const missing = REQUIRED.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and fill in each value before starting the server."
    );
  }
}
