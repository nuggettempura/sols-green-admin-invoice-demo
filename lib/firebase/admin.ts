import { initializeApp, getApps, cert, App } from "firebase-admin/app";

let serviceAccount: object;
try {
  const raw = process.env.SERVICE_ACCOUNT as string;
  if (!raw) throw new Error("SERVICE_ACCOUNT env var is not set");
  console.log("[admin] SERVICE_ACCOUNT first 30 chars:", raw.slice(0, 30));
  serviceAccount = JSON.parse(raw);
} catch (error) {
  console.error("[admin] Failed to parse SERVICE_ACCOUNT:", error);
  throw new Error("Invalid SERVICE_ACCOUNT JSON: " + error);
}

export const adminApp: App =
  getApps().find((app) => app.name === "demo") ||
  initializeApp(
    {
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      projectId: "demo-no-project",
    },
    "demo"
  );
