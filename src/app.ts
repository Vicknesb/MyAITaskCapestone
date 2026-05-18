import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { authRouter }    from "./routes/auth";
import { reposRouter }   from "./routes/repos";
import { metricsRouter } from "./routes/metrics";
import { syncRouter }    from "./routes/sync";
import { dashboardRouter } from "./routes/dashboard";

export const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth",      authRouter);
app.use("/api/repos",     reposRouter);
app.use("/api/metrics",   metricsRouter);
app.use("/api/sync",      syncRouter);
app.use("/api/dashboard", dashboardRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Not found", code: "NOT_FOUND" });
});
