import express, { NextFunction, Request } from "express";
import asyncify from "express-asyncify";
import cors from "cors";
import helmet from "helmet";
import http from "node:http";
import {
  OrmClient,
  loadAccountFromPrivatekeyFile,
  OrmFunctionPayload,
  OrmTxnOptions,
  getOrmAddress,
  OrmTxn,
  serializeOrmTxn,
  deserializeOrmTxn,
  SerializedOrmTxn,
  FeeFreeOrmTxnOptions,
  Account,
  serializeArgument,
  deserializeArgument,
} from "apto_orm";
import { AptosApiError, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

if (!process.env.APTOS_NODE_URL) {
  throw new Error("APTOS_NODE_URL not specified");
}

const port = 5678;
const app = asyncify(express());
app.disable("x-powered-by");
app.use(cors());
app.use(helmet({ frameguard: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.enable("trust proxy"); // to get remote ip properly
app.disable("etag");

const client = new OrmClient(process.env.APTOS_NODE_URL);
let payer: Account;
if (process.env.PAYER_PRIVATE_KEY) {
  const privateKey = new Ed25519PrivateKey(process.env.PAYER_PRIVATE_KEY);
  payer = Account.fromPrivateKey({ privateKey });
} else {
  payer = loadAccountFromPrivatekeyFile(process.env.PAYER || "./.key/payer");
}

console.log("Payer address:", payer.accountAddress.toString());
let payer_sequence_number = -1n;
// (async () => {
//   if (payer_sequence_number < 0n) {
//     payer_sequence_number = await client.getAccountSequenceNumber(
//       payer.accountAddress
//     );
//   }
// })();

app.post("/fee_free/create_account/:address", async (req, res) => {
  try {
    if (payer_sequence_number < 0n) {
      payer_sequence_number = await client.getAccountSequenceNumber(
        payer.accountAddress
      );
    }
    const otxn = await client.transferCoinsTxn(payer, req.params.address, 0n, {
      accountSequenceNumber: payer_sequence_number++,
    });
    const ptxn = await client.signAndsubmitOrmTxn([payer], otxn);
    return res.status(200).json(ptxn);
  } catch (err) {
    console.error(err);
    if (err instanceof AptosApiError) {
      return res.status(err.status).json({
        error_message: JSON.parse(err.message),
        data: err.data,
      });
    }
    return res.status(400).json({
      error_message: err.message,
    });
  }
});

app.post(
  "/fee_free/generate_txn",
  async (
    req: Request<
      unknown,
      unknown,
      {
        signers: string[];
        payload: OrmFunctionPayload;
        options: FeeFreeOrmTxnOptions;
      }
    >,
    res
  ) => {
    const { signers, payload, options } = req.body;
    if (!signers || !Array.isArray(signers)) {
      return res.status(400).json({ error_message: "invalid signers" });
    }
    if (signers.length <= 0) {
      return res.status(400).json({ error_message: "no signers" });
    }
    if (!payload?.function) {
      return res.status(400).json({ error_message: "function not specified" });
    }
    try {
      payload.functionArguments = payload.functionArguments.map((arg) => {
        return deserializeArgument(arg);
      });
      const ormtxn = await client.generateOrmTxn(signers, payload, {
        accountSequenceNumber: options?.accountSequenceNumber,
        expireTimestamp: options?.expireTimestamp,
        payer,
      });
      return res.status(200).json({
        ormtxn: serializeOrmTxn(ormtxn),
      });
    } catch (err) {
      console.error(err);
      if (err instanceof AptosApiError) {
        return res.status(err.status).json({
          error_message: JSON.parse(err.message),
          data: err.data,
        });
      }
      return res.status(400).json({
        error_message: err.message,
      });
    }
  }
);

app.get("/fee_free*", async (req, res) => {
  return res.status(200).json({ payer: payer.accountAddress.toString() });
});

app.post(
  "/fee_free/sign_and_submit_txn",
  async (
    req: Request<unknown, unknown, { ormtxn: SerializedOrmTxn }>,
    res
  ) => {
    try {
      if (!req.body?.ormtxn) {
        return res.status(400).json({ error_message: "ormtxn not specified" });
      }
      const ormtxn = deserializeOrmTxn(req.body?.ormtxn);
      const ptxn = await client.signAndsubmitOrmTxn([], ormtxn, { payer });
      return res.status(200).json(ptxn);
    } catch (err) {
      if (err instanceof AptosApiError) {
        return res.status(err.status).json({
          error_message: JSON.parse(err.message),
          data: err.data,
        });
      }
      return res.status(400).json({
        error_message: err.message,
      });
    }
  }
);

app.get("/", (req, res) => {
  res.json({ alive: true });
});

app.all("*", (req, res) => {
  res.status(404).json({ error_message: "not found" });
});

const server = http.createServer(app);
server.listen(port, () => {
  console.log(`server is listening on port ${port}`);
});
function shutdown() {
  server.close(() => {
    console.log("server closed");
    process.exit(1);
  });
}
process.on("SIGINT", () => {
  console.log("SIGINT received");
  shutdown();
});
