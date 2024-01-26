// import {
//   Aptos,
//   AptosConfig,
//   ClientConfig,
//   Network,
//   MoveType,
//   MoveValue,
//   AccountAddress,
//   AccountAddressInput,
//   Hex,
//   HexInput,
//   Account,
//   InputGenerateTransactionPayloadData,
//   InputGenerateTransactionOptions,
//   PendingTransactionResponse,
//   AnyRawTransaction,
//   SimpleTransaction,
//   MultiAgentTransaction,
//   AccountAuthenticator,
//   EntryFunctionArgumentTypes,
// } from '@aptos-labs/ts-sdk';
// import axios, { isAxiosError } from 'axios';
// import { OrmTxn, PendingTransaction, OrmFunctionPayload, OrmTxnOptions, FeeFreeOrmTxnOptions } from './types';
// import { serializeArgument, hexEncodedBytesToUint8Array, toAddress } from './utilities';
// import { OrmClient } from './client';

// export type FeeFreeConfig = {
//   url: string;
//   headers: Record<string, string | number | boolean>;
// };

// const axios_header = {
//   'Content-Type': 'application/json',
// };

// export function serializeOrmTxn(ormtxn: OrmTxn) {
//   if (!ormtxn) throw new Error('ormtxn is undefined');
//   const txn_serializer = new BCS.Serializer();
//   ormtxn.txn.serialize(txn_serializer);
//   const payer_auth_serializer = new BCS.Serializer();
//   if (ormtxn.payer_auth) ormtxn.payer_auth.serialize(payer_auth_serializer);
//   const serialized: OrmTxnSerialized = {
//     type: ormtxn.type,
//     txn: HexString.fromUint8Array(txn_serializer.getBytes()).toString(),
//     auths: ormtxn.auths.map((auth) => {
//       if (!auth) return null;
//       const s = new BCS.Serializer();
//       auth.serialize(s);
//       return HexString.fromUint8Array(s.getBytes()).toString();
//     }),
//     payer_auth: ormtxn?.payer_auth ? HexString.fromUint8Array(payer_auth_serializer.getBytes()).toString() : null,
//   };
//   return serialized;
// }

// export function deserializeOrmTxn(ormtxn: OrmTxnSerialized) {
//   if (!ormtxn) throw new Error('ormtxn is undefined');
//   const payer_auth = (() => {
//     if (!ormtxn.payer_auth) return null;
//     const u8a = hexEncodedBytesToUint8Array(ormtxn.payer_auth);
//     if (u8a.length === 0) return null;
//     const payer_auth_deserializer = new BCS.Deserializer(u8a);
//     return TxnBuilderTypes.AccountAuthenticatorEd25519.deserialize(payer_auth_deserializer);
//   })();
//   const auths = (() => {
//     return ormtxn.auths.map((auth) => {
//       if (!auth) return null;
//       const u8a = hexEncodedBytesToUint8Array(auth);
//       if (u8a.length === 0) return null;
//       const auth_deserializer = new BCS.Deserializer(u8a);
//       return TxnBuilderTypes.AccountAuthenticatorEd25519.deserialize(auth_deserializer);
//     });
//   })();
//   const u8a = hexEncodedBytesToUint8Array(ormtxn.txn);
//   if (u8a.length === 0) throw new Error('txn is empty');
//   const deserializer = new BCS.Deserializer(u8a);
//   switch (ormtxn.type) {
//     case 'fee-payer':
//       return {
//         type: ormtxn.type,
//         txn: TxnBuilderTypes.FeePayerRawTransaction.deserialize(deserializer),
//         auths,
//         payer_auth,
//       } as OrmTxn;
//     case 'multi-agent':
//       return {
//         type: ormtxn.type,
//         txn: TxnBuilderTypes.MultiAgentRawTransaction.deserialize(deserializer),
//         auths,
//         payer_auth,
//       } as OrmTxn;
//     case 'raw':
//       return {
//         type: ormtxn.type,
//         txn: TxnBuilderTypes.RawTransaction.deserialize(deserializer),
//         auths,
//         payer_auth,
//       } as OrmTxn;
//     default:
//       throw new Error(`unknown ormtxn type ${ormtxn.type}`);
//   }
// }

// /** OrmFreePrepayClient is a client that can generate transaction and return the signed transaction
//  * before user signs it. */
// export class OrmFreePrepayClient extends OrmClient {
//   private FEE_FREE_URL?: string;
//   private FEE_FREE_HEADERS?: Record<string, string | number | boolean>;

//   constructor(config: AptosConfig, ffconfig: FeeFreeConfig) {
//     super(config);
//     if (ffconfig.url) {
//       this.FEE_FREE_URL = ffconfig.url;
//     }
//     if (ffconfig.headers) {
//       this.FEE_FREE_HEADERS = ffconfig.headers;
//     }
//   }

//   async createAccount(address: Account | AccountAddressInput) {
//     if (!this.FEE_FREE_URL) {
//       throw new Error('free fee url is undefined');
//     }
//     const url = this.FEE_FREE_URL + `/fee_free/create_account/${toAddress(address).toString()}`;
//     const resp = await axios.post(url, null);
//     return resp.data as PendingTransaction;
//   }

//   async generateOrmTxn(
//     signers: (Account | AccountAddressInput)[],
//     payload: OrmFunctionPayload,
//     options?: FeeFreeOrmTxnOptions
//   ) {
//     if (!this.FEE_FREE_URL) {
//       throw new Error('free fee url is undefined');
//     }
//     try {
//       const url = this.FEE_FREE_URL + '/fee_free/generate_txn';
//       const _options: FeeFreeOrmTxnOptions = {
//         accountSequenceNumber: options.accountSequenceNumber,
//         expireTimestamp: options.expireTimestamp,
//       };
//       const response = await axios.post(
//         url,
//         {
//           signers: signers.map((s) => {
//             return toAddress(s).toString();
//           }),
//           payload: {
//             function: payload.function,
//             typeArguments: payload.typeArguments,
//             functionArguments: payload.functionArguments.map((arg) => {
//               return serializeArgument(arg);
//             }),
//           },
//           options: _options,
//         },
//         { headers: axios_header }
//       );
//       const txn = deserializeOrmTxn(response.data as OrmTxnSerialized);
//       return this.signOrmTxn(signers, txn);
//     } catch (err) {
//       if (isAxiosError(err)) {
//         console.error(err.response?.data);
//         throw new Error(err.response?.data);
//       }
//       throw err;
//     }
//   }
// }

// /** OrmFreePostpayClient is a client that signs and submits the transaction after user signing */
// export class OrmFreePostpayClient extends OrmClient {
//   private FEE_FREE_URL?: string;
//   private FEE_FREE_HEADERS?: Record<string, string | number | boolean>;

//   constructor(config: FeeFreeConfig) {
//     super(config.aptos_node_url, config?.aptos_node_config);
//     if (config.url) {
//       this.FEE_FREE_URL = config.url;
//     }
//     if (config.fee_free_headers) {
//       this.FEE_FREE_HEADERS = config.fee_free_headers;
//     }
//   }

//   async createAccount(address: AptosAccount | MaybeHexString) {
//     if (!this.FEE_FREE_URL) {
//       throw new Error('free fee url is undefined');
//     }
//     const url = this.FEE_FREE_URL + `/fee_free/create_account/${toAddress(address).toShortString()}`;
//     const resp = await axios.post(url, null);
//     return resp.data as Types.PendingTransaction;
//   }

//   async submitOrmTxn(ormtxn: OrmTxn) {
//     if (!this.FEE_FREE_URL) {
//       throw new Error('free fee url is undefined');
//     }
//     const url = this.FEE_FREE_URL + '/fee_free/sign_and_submit_txn';
//     const serialized = serializeOrmTxn(ormtxn);
//     try {
//       const response = await axios.post(url, serialized, { headers: axios_header });
//       return response.data as Types.PendingTransaction;
//     } catch (err) {
//       if (isAxiosError(err)) {
//         console.error(err.response?.data);
//         throw new Error(err.response?.data);
//       }
//       throw err;
//     }
//   }

//   async retrievePayer() {
//     if (!this.FEE_FREE_URL) {
//       throw new Error('free fee url is undefined');
//     }
//     const url = this.FEE_FREE_URL + '/fee_free';
//     try {
//       const response = await axios.get(url);
//       return response.data as { payer: string };
//     } catch (err) {
//       if (isAxiosError(err)) {
//         console.error(err.response?.data);
//         throw new Error(err.response?.data);
//       }
//       throw err;
//     }
//   }
// }
