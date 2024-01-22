import serverless from "serverless-http";
import express, { Request } from "express";
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
  OrmTxnSerialized,
  deserializeOrmTxn,
  FeeFreeOrmTxnOptions,
  deserializeArgument,
} from "apto_orm";
import {
  AptosAccount,
  AptosApiError,
  BCS,
  MaybeHexString,
  HexString,
} from "aptos";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";

export class Payer {
  constructor(
    public id: number,
    public address: string,
    public pubkey: string,
    private prikey: string,
    public sequence_number?: bigint
  ) {
    this.id = id;
    this.address = address;
    this.pubkey = pubkey;
    this.prikey = prikey;
    this.sequence_number = sequence_number;
  }

  toAccount() {
    if (!this.prikey) {
      throw new Error("prikey not initialized in payer");
    }
    return new AptosAccount(
      HexString.ensure(this.prikey).toUint8Array(),
      this.address
    );
  }
}

export class PayersMgmt {
  private ddbc: DynamoDBClient;
  private doc: DynamoDBDocumentClient;
  tablename = `Payers-${process.env.NETWORK || "devnet"}`;

  constructor(readonly maxPayers: number) {
    this.ddbc = new DynamoDBClient();
    this.doc = DynamoDBDocumentClient.from(this.ddbc);
  }


  async getRandPayer() {
    const id = Math.floor(Math.random() * this.maxPayers);
    const Key: { [key: string]: any } = {
      id: id,
    };
    const { Item: payer } = await this.doc.send(
      new GetCommand({ TableName: this.tablename, Key })
    );
    return new Payer(
      payer.id,
      payer.address,
      payer.pubkey,
      payer.prikey,
      payer.sequence_number
    );
  }

  async getPayerByPubkey(pubkey: string) {
    const Key: { [key: string]: any } = {
      pubkey: pubkey,
    };
    const command = new QueryCommand({
      TableName: this.tablename,
      IndexName: "PubkeyIndex",
      KeyConditionExpression: "pubkey = :pubkey",
      ExpressionAttributeValues: {
        ":pubkey": { S: pubkey },
      },
    });
    const response = await this.doc.send(command);
    if (!response?.Count || response.Count <= 0) {
      throw new Error(`payer (${pubkey}) not found`);
    }
    console.log("query result", response);
    const r = response.Items?.[0] as any;
    const payer = new Payer(
      r.id,
      r.address,
      r.pubkey,
      r.prikey,
      r.sequence_number
    );
    return payer;
  }

  async loadSenderPayer(payload: any) {
    const text = JSON.stringify(payload);
    const hash = createHash("sha256");
    hash.update(text);
    hash.update("apto_orm");
    const value = hash.digest("hex");
    const num = Number("0x" + value.slice(-1));
    const id = num % this.maxPayers;
    const Key: { [key: string]: any } = {
      id: id,
    };
    const { Item: prev } = await this.doc.send(
      new GetCommand({ TableName: this.tablename, Key })
    );
    if (prev?.sequence_number) {
      throw new Error(`invalid sequence_number: ${prev.sequence_number}`);
    }
    const response = await this.doc.send(
      new UpdateCommand({
        TableName: this.tablename,
        Key,
        UpdateExpression: `set sequence_number = :sequence_number`,
        ExpressionAttributeValues: {
          ":sequence_number": BigInt(prev.sequence_number) + 1n,
        },
        ConditionExpression: `sequence_number = ${prev.sequence_number}`,
        ReturnValues: "UPDATED_NEW",
      })
    );
    if (!response?.Attributes?.sequence_number) {
      throw new Error(`sequence_number update failed: ${response.Attributes}`);
    }
    const sequence_number = BigInt(response.Attributes.sequence_number);
    const payer = new Payer(
      id,
      prev.address,
      prev.pubkey,
      prev.prikey,
      sequence_number
    );
    return payer;
  }

  async savePayer(payer: Payer) {
    const Item = payer;
    const command = new PutCommand({ TableName: this.tablename, Item });
    await this.doc.send(command);
  }
}

export enum AptosNodeUri {
  local = "http://localhost:8080/v1",
  devnet = "https://fullnode.devnet.aptoslabs.com/v1",
  testnet = "https://fullnode.testnet.aptoslabs.com/v1",
  mainnet = "https://fullnode.mainnet.aptoslabs.com/v1",
}

if (!process.env.NETWORK) {
  throw new Error("NETWORK not specified");
}

const nodeUri = AptosNodeUri[process.env.NETWORK];
if (!nodeUri) {
  throw new Error(`invalid NETWORK: ${process.env.NETWORK}`);
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

const client = new OrmClient(nodeUri);
export const mgmt = new PayersMgmt(
  process.env.MAX_PAYERS ? Number(process.env.MAX_PAYERS) : 0
);

async function getPayer(pubkey: string) {
  console.log(`pubkey`, pubkey);
  const payer = await mgmt.getPayerByPubkey(pubkey);
  return payer.toAccount();
}

async function getSenderPayer(payload: any) {
  const payer = await mgmt.loadSenderPayer(payload);
  return payer.toAccount();
}

app.post("/fee_free/create_account/:address", async (req, res) => {
  if (!req.params.address) {
    return res.status(400).json({ error_message: "address not specified" });
  }
  const payer = await mgmt.loadSenderPayer(req.body);
  if (payer.sequence_number < 0n) {
    throw new Error(`invalid sequence_number: ${payer.sequence_number}`);
    // payer.sequence_number = await client
    //   .getAccountSequenceNumber(req.params.address)
    //   .catch(() => {
    //     return -1n;
    //   });
    // await mgmt.savePayer(payer);
  }
  try {
    const otxn = await client.transferCoinsTxn(
      payer.toAccount(),
      req.params.address,
      0n,
      {
        sequence_number: String(payer.sequence_number++),
      }
    );
    const ptxn = await client.signAndsubmitOrmTxn([], otxn);
    await mgmt.savePayer(payer);
    return res.status(200).json(ptxn);
  } catch (err) {
    console.error(err);
    if (err instanceof AptosApiError) {
      return res.status(err.status).json({
        error_message: JSON.parse(err.message),
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
        signers: MaybeHexString[];
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
    // check validation and authorization
    // if (!payload.function.startsWith(getOrmAddress())) {
    //   res.status(400).json({ error_message: "invalid function" });
    // }
    try {
      payload.arguments = payload.arguments.map((arg) => {
        return deserializeArgument(arg);
      });
      const payer = await mgmt.getRandPayer();
      if (!payer) throw new Error("payer not found");
      const otxn = await client.generateOrmTxn(signers, payload, {
        sequence_number: options?.sequence_number,
        expiration_timestamp_secs: options?.expiration_timestamp_secs,
        payer: payer.toAccount(),
      });
      return res.status(200).json(serializeOrmTxn(otxn));
    } catch (err) {
      console.error(err);
      if (err instanceof AptosApiError) {
        return res.status(err.status).json({
          error_message: JSON.parse(err.message),
        });
      }
      return res.status(400).json({
        error_message: err.message,
      });
    }
  }
);

app.get("/fee_free*", async (req, res) => {
  const payer = await mgmt.getRandPayer();
  return res.status(200).json({ payer: payer.address });
});

app.post(
  "/fee_free/sign_and_submit_txn",
  async (req: Request<unknown, unknown, OrmTxnSerialized>, res) => {
    const orm_txn_serialized = req.body as OrmTxnSerialized;
    if (
      !orm_txn_serialized ||
      !orm_txn_serialized.txn ||
      !orm_txn_serialized.auths
    ) {
      return res
        .status(400)
        .json({ error_message: "invalid transaction format" });
    }
    try {
      const orm_txn = deserializeOrmTxn(orm_txn_serialized);
      const pubkey = orm_txn.payer_auth?.public_key.toBytes();
      const payer = await getPayer(HexString.fromUint8Array(pubkey).toString());
      if (!payer) throw new Error("payer not found");
      const ptxn = await client.signAndsubmitOrmTxn([], orm_txn, { payer });
      return res.status(200).json(ptxn);
    } catch (err) {
      if (err instanceof AptosApiError) {
        return res.status(err.status).json({
          error_message: JSON.parse(err.message),
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

// const server = http.createServer(app);
// server.listen(port, () => {
//   console.log(`server is listening on port ${port}`);
// });
// function shutdown() {
//   server.close(() => {
//     console.log("server closed");
//     process.exit(1);
//   });
// }
// process.on("SIGINT", () => {
//   console.log("SIGINT received");
//   shutdown();
// });

// app.get("/", function (req, res) {
//   res.send("Hello World!");
// });

// module.exports.hello = hello;
module.exports.handler = serverless(app);
