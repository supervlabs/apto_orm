import {
  Serializer,
  Deserializer,
  Aptos,
  AptosConfig,
  ClientConfig,
  Network,
  MoveType,
  MoveValue,
  AccountAddress,
  AccountAddressInput,
  Hex,
  HexInput,
  Account,
  InputGenerateTransactionPayloadData,
  InputGenerateTransactionOptions,
  PendingTransactionResponse,
  AnyRawTransaction,
  SimpleTransaction,
  MultiAgentTransaction,
  AccountAuthenticator,
  EntryFunctionArgumentTypes,
  RawTransaction,
} from '@aptos-labs/ts-sdk';
import axios, { isAxiosError } from 'axios';
import { OrmTxn, PendingTransaction, OrmFunctionPayload, FeeFreeOrmTxnOptions } from './types';
import { toAddress } from './utilities';
// import { serializeArgument, hexEncodedBytesToUint8Array, toAddress } from './utilities';
import { OrmClient } from './client';

export type FeeFreeSettings = {
  readonly url?: string;
  readonly header?: Record<string, string | number | boolean>;
};

const axios_header = {
  'Content-Type': 'application/json',
};

export type SerializedOrmTxn = string;

export function serializeOrmTxn(ormtxn: OrmTxn): SerializedOrmTxn {
  if (!ormtxn) throw new Error('ormtxn is undefined');
  const s = new Serializer();
  s.serializeStr(ormtxn.type);
  s.serialize(ormtxn.txn.rawTransaction);
  let length = ormtxn.txn.secondarySignerAddresses?.length || 0;
  s.serializeU64(length);
  for (const addr of ormtxn.txn.secondarySignerAddresses || []) {
    s.serialize(addr);
  }
  s.serializeBool(!!ormtxn.txn.feePayerAddress);
  if (ormtxn.txn?.feePayerAddress) {
    s.serialize(ormtxn.txn.feePayerAddress);
  }

  length = ormtxn.auths?.length || 0;
  s.serializeU64(length);
  for (const auth of ormtxn.auths || []) {
    s.serializeBool(!!auth);
    if (auth) s.serialize(auth);
  }
  s.serializeBool(!!ormtxn.payer_auth);
  if (ormtxn.payer_auth) {
    s.serialize(ormtxn.payer_auth);
  }
  return Buffer.from(s.toUint8Array()).toString('hex');
}

export function deserializeOrmTxn(ormtxnSerialized: SerializedOrmTxn) {
  if (!ormtxnSerialized) throw new Error('ormtxn is undefined');
  const s = Buffer.from(ormtxnSerialized, 'hex');
  let d = new Deserializer(s);
  const type = d.deserializeStr();
  if (type !== 'simple' && type !== 'multiAgent') {
    throw new Error('invalid ormtxn type');
  }
  const txn = RawTransaction.deserialize(d);
  let length = d.deserializeU64();
  let secondarySignerAddresses: AccountAddress[] = [];
  for (let i = 0; i < length; i++) {
    secondarySignerAddresses.push(AccountAddress.deserialize(d));
  }
  let feePayerAddress: AccountAddress;
  if (d.deserializeBool()) {
    feePayerAddress = AccountAddress.deserialize(d);
  }
  length = d.deserializeU64();
  let auths: (AccountAuthenticator | null)[] = [];
  for (let i = 0; i < length; i++) {
    if (d.deserializeBool()) {
      auths.push(AccountAuthenticator.deserialize(d));
    } else {
      auths.push(null);
    }
  }
  let payer_auth: AccountAuthenticator;
  if (d.deserializeBool()) {
    payer_auth = AccountAuthenticator.deserialize(d);
  }
  if (type === 'simple') {
    return {
      type,
      txn: {
        rawTransaction: txn,
        feePayerAddress,
      },
      auths,
      payer_auth,
    } as OrmTxn;
  }
  return {
    type,
    txn: {
      rawTransaction: txn,
      secondarySignerAddresses,
      feePayerAddress,
    },
    auths,
    payer_auth,
  } as OrmTxn;
}

/** OrmFreePrepayClient is a client that can generate transaction and return the signed transaction
 * before user signs it. */
export class OrmFreePrepayClient extends OrmClient {
  private feeFree?: string;
  private feeFreeHeader?: Record<string, string | number | boolean>;

  constructor(config: AptosConfig, settings: FeeFreeSettings) {
    super(config);
    if (settings.url) {
      this.feeFree = settings.url;
    }
    if (settings.header) {
      this.feeFreeHeader = settings.header;
    }
  }

  async createAccount(address: Account | AccountAddressInput) {
    if (!this.feeFree) {
      throw new Error('free fee url is undefined');
    }
    const url = this.feeFree + `/fee_free/create_account/${toAddress(address).toString()}`;
    const resp = await axios.post(url, null);
    return resp.data as PendingTransaction;
  }

  async generateOrmTxn(
    signers: (Account | AccountAddressInput)[],
    payload: OrmFunctionPayload,
    options?: FeeFreeOrmTxnOptions
  ) {
    if (!this.feeFree) {
      throw new Error('free fee url is undefined');
    }
    try {
      const url = this.feeFree + '/fee_free/generate_txn';
      const _options: FeeFreeOrmTxnOptions = {
        accountSequenceNumber: options.accountSequenceNumber,
        expireTimestamp: options.expireTimestamp,
      };
      const functionArguments = payload.functionArguments.map((arg) => {
        return;
      });
      const response = await axios.post(
        url,
        {
          signers: signers.map((s) => {
            return toAddress(s).toString();
          }),
          payload,
          options: _options,
        },
        { headers: axios_header }
      );
      // return response.data as OrmTxn;
      const body = response.data;
      const txn = deserializeOrmTxn(body);
      return this.signOrmTxn(signers, txn);
    } catch (err) {
      if (isAxiosError(err)) {
        console.error(err.response?.data);
        throw new Error(err.response?.data);
      }
      throw err;
    }
  }
}

/** OrmFreePostpayClient is a client that signs and submits the transaction after user signing */
export class OrmFreePostpayClient extends OrmClient {
  private feeFree?: string;
  private feeFreeHeader?: Record<string, string | number | boolean>;

  constructor(config: AptosConfig, settings: FeeFreeSettings) {
    super(config);
    if (settings.url) {
      this.feeFree = settings.url;
    }
    if (settings.header) {
      this.feeFreeHeader = settings.header;
    }
  }

  async createAccount(address: Account | AccountAddressInput) {
    if (!this.feeFree) {
      throw new Error('free fee url is undefined');
    }
    const url = this.feeFree + `/fee_free/create_account/${toAddress(address).toString()}`;
    const resp = await axios.post(url, null);
    return resp.data as PendingTransaction;
  }

  async submitOrmTxn(ormtxn: OrmTxn) {
    if (!this.feeFree) {
      throw new Error('free fee url is undefined');
    }
    const url = this.feeFree + '/fee_free/sign_and_submit_txn';
    const serialized = serializeOrmTxn(ormtxn);
    const body = Buffer.from(serialized).toString('hex');
    try {
      const response = await axios.post(url, body, { headers: axios_header });
      return response.data as PendingTransaction;
    } catch (err) {
      if (isAxiosError(err)) {
        console.error(err.response?.data);
        throw new Error(err.response?.data);
      }
      throw err;
    }
  }

  async retrievePayer() {
    if (!this.feeFree) {
      throw new Error('free fee url is undefined');
    }
    const url = this.feeFree + '/fee_free';
    try {
      const response = await axios.get(url);
      return response.data as { payer: string };
    } catch (err) {
      if (isAxiosError(err)) {
        console.error(err.response?.data);
        throw new Error(err.response?.data);
      }
      throw err;
    }
  }
}
