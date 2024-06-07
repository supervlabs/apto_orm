import {
  Serializer,
  Deserializer,
  AptosConfig,
  AccountAddress,
  AccountAddressInput,
  Account,
  AccountAuthenticator,
  RawTransaction,
  AptosSettings,
} from '@aptos-labs/ts-sdk';
import axios, { isAxiosError } from 'axios';
import { OrmTxn, PendingTransaction, OrmFunctionPayload, FeeFreeOrmTxnOptions } from './types';
import { serializeArgument, toAddress } from './utilities';
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
  const d = new Deserializer(s);
  const type = d.deserializeStr();
  if (type !== 'simple' && type !== 'multiAgent') {
    throw new Error('invalid ormtxn type');
  }
  const txn = RawTransaction.deserialize(d);
  let length = d.deserializeU64();
  const secondarySignerAddresses: AccountAddress[] = [];
  for (let i = 0; i < length; i++) {
    secondarySignerAddresses.push(AccountAddress.deserialize(d));
  }
  let feePayerAddress: AccountAddress;
  if (d.deserializeBool()) {
    feePayerAddress = AccountAddress.deserialize(d);
  }
  length = d.deserializeU64();
  const auths: (AccountAuthenticator | null)[] = [];
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

