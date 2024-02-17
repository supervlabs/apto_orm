// power_of_attorney API
import {
  AnyNumber,
  Serializer,
  MoveFunctionId,
  AccountAddress,
  AccountAddressInput,
  HexInput,
  Account,
} from '@aptos-labs/ts-sdk';
import { getOrmAccountAddress, toAddress } from './utilities';
import { OrmClient } from './client';
import { OrmTxnOptions } from './types';

export enum AccountScheme {
  ED25519_SCHEME = 0,
  MULTI_ED25519_SCHEME = 1,
}

export type PowerOfAttorneyProofTicket = {
  address: AccountAddressInput;
  module: string;
  struct: string;
  chain_id: number;
  delegator_address: AccountAddressInput;
  delegator_sequence_number: AnyNumber;
  expiration_date: AnyNumber;
  designator: AccountAddressInput;
  designator_account_scheme: AccountScheme;
  designator_account_public_key_bytes: Uint8Array;
  designator_signed_proof_challenge: Uint8Array;
};

// /// The proof challenge to become the authorized account on behalf of original owner.
// struct PowerOfAttorneyProof has drop {
//   chain_id: u8,
//   delegator_address: address,
//   delegator_sequence_number: u64,
//   designator: address,
//   expiration_date: u64,
// }

export class PowerOfAttorneyProof {
  address: AccountAddress = getOrmAccountAddress();
  module: string = 'power_of_attorney';
  struct: string = 'PowerOfAttorneyProof';
  designator_signed_proof_challenge: HexInput;
  constructor(
    public readonly chain_id: number,
    public readonly delegator_address: AccountAddressInput,
    public readonly delegator_sequence_number: AnyNumber,
    public readonly designator: AccountAddressInput,
    public readonly expiration_date: AnyNumber
  ) {}

  serialize(serializer: Serializer) {
    serializer.serialize(this.address);
    serializer.serializeStr(this.module);
    serializer.serializeStr(this.struct);
    serializer.serializeU8(this.chain_id);
    serializer.serialize(toAddress(this.delegator_address));
    serializer.serializeU64(this.delegator_sequence_number);
    serializer.serialize(toAddress(this.designator));
    serializer.serializeU64(this.expiration_date);
  }

  generate(designator: Account): PowerOfAttorneyProofTicket {
    const serializer = new Serializer();
    this.serialize(serializer);
    const proofSignedByPrivateKey = designator.sign(serializer.toUint8Array());
    return {
      ...this,
      designator_account_scheme: AccountScheme.ED25519_SCHEME,
      designator_account_public_key_bytes: designator.publicKey.toUint8Array(),
      designator_signed_proof_challenge: proofSignedByPrivateKey.toUint8Array(),
    };
  }
}

/**
 * initPoaTxn initializes a power of attorney for the given `poa` account (worker account).
 * @param client OrmClient
 * @param poa AptosAccount
 * @param ticket PowerOfAttorneyProofTicket
 * @param options OrmTxnOptions
 * @returns
 */
export async function initPoaTxn(
  client: OrmClient,
  delegator: Account | AccountAddressInput,
  ticket: PowerOfAttorneyProofTicket,
  options?: OrmTxnOptions
) {
  const fname: MoveFunctionId = `${client.ormAddress}::power_of_attorney::init_poa`;
  const args: any[] = [
    ticket.expiration_date,
    ticket.designator,
    ticket.designator_account_scheme,
    ticket.designator_account_public_key_bytes,
    ticket.designator_signed_proof_challenge,
  ];
  const type_args: string[] = [];
  return await client.generateOrmTxn(
    [delegator],
    {
      function: fname,
      typeArguments: type_args,
      functionArguments: args,
    },
    options
  );
}

export async function registerPoaTxn(
  client: OrmClient,
  designator: Account | AccountAddressInput,
  delegator: Account | AccountAddressInput,
  config: { expiration_date: AnyNumber; amount: AnyNumber },
  options?: OrmTxnOptions
) {
  const fname: MoveFunctionId = `${client.ormAddress}::power_of_attorney::register_poa`;
  const args: any[] = [config.expiration_date, config.amount];
  const type_args: string[] = [];
  return await client.generateOrmTxn(
    [designator, delegator],
    {
      function: fname,
      typeArguments: type_args,
      functionArguments: args,
    },
    options
  );
}

export async function revokePoaTxn(
  client: OrmClient,
  designator: Account | AccountAddressInput,
  delegator: AccountAddressInput,
  options?: OrmTxnOptions
) {
  const fname: MoveFunctionId = `${client.ormAddress}::power_of_attorney::revoke_poa`;
  const args: any[] = [delegator];
  const type_args: string[] = [];
  return await client.generateOrmTxn(
    [designator],
    {
      function: fname,
      typeArguments: type_args,
      functionArguments: args,
    },
    options
  );
}

export async function pauseTxn(client: OrmClient, designator: Account | AccountAddressInput, options?: OrmTxnOptions) {
  const fname: MoveFunctionId = `${client.ormAddress}::power_of_attorney::pause`;
  const args: any[] = [];
  const type_args: string[] = [];
  return await client.generateOrmTxn(
    [designator],
    {
      function: fname,
      typeArguments: type_args,
      functionArguments: args,
    },
    options
  );
}

export async function resumeTxn(client: OrmClient, designator: Account | AccountAddressInput, options?: OrmTxnOptions) {
  const fname: MoveFunctionId = `${client.ormAddress}::power_of_attorney::resume`;
  const args: any[] = [];
  const type_args: string[] = [];
  return await client.generateOrmTxn(
    [designator],
    {
      function: fname,
      typeArguments: type_args,
      functionArguments: args,
    },
    options
  );
}
