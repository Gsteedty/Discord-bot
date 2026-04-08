import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getDmLog } from "./logStore";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.get("/logs/:id", (req: Request, res: Response) => {
  const html = getDmLog(req.params.id);
  if (!html) {
    res.status(404).send("<html><body style='background:#313338;color:#dcddde;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='text-align:center'><h2>Log not found</h2><p style='color:#949ba4;margin-top:8px'>This link may have expired (logs are kept for 24 hours).</p></div></body></html>");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export default app;
