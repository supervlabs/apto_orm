import 'reflect-metadata';
import {
  MoveType,
  MoveValue,
  Account,
  AccountAddress,
  AccountAddressInput,
  Hex,
  HexInput,
  InputEntryFunctionData,
  InputMultiSigData,
  InputGenerateTransactionPayloadData,
  InputGenerateTransactionOptions,
  PendingTransactionResponse,
  AnyRawTransaction,
  SimpleTransaction,
  MultiAgentTransaction,
  AccountAuthenticator,
  EntryFunctionArgumentTypes,
  Signature,
} from '@aptos-labs/ts-sdk';

export interface Signable {
  readonly accountAddress: AccountAddress;
  sign(data: HexInput): Signature;
  // verifySignature(args: { message: HexInput; signature: Signature }): boolean;
}

export { MoveType, MoveValue };
export { Account, AccountAddress, AccountAddressInput, Hex, HexInput };
export { InputGenerateTransactionPayloadData, InputGenerateTransactionOptions, PendingTransactionResponse };
export { AnyRawTransaction, SimpleTransaction, MultiAgentTransaction, AccountAuthenticator };
export { EntryFunctionArgumentTypes };

export type NamedAddresses = { [named_address: string]: AccountAddress };

export type OrmFieldCommonMoveType =
  | 'address'
  | 'string'
  | 'String'
  | 'bytes'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'u256'
  | 'bool';

export type OrmFieldVectorMoveType =
  | 'vector<address>'
  | 'vector<u8>'
  | 'vector<u16>'
  | 'vector<u32>'
  | 'vector<u64>'
  | 'vector<u128>'
  | 'vector<u256>'
  | 'vector<bool>'
  | 'vector<string::String>'
  | 'vector<string>'
  | 'vector<vector<u8>>';

// [FIXME] - add support for EntryFunctionArgumentTypes
// | EntryFunctionArgumentTypes;

export type OrmFieldTypeString =
  | 'address'
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'u128'
  | 'u256'
  | 'bool'
  | 'string::String'
  | OrmFieldVectorMoveType;

// export interface OrmField extends Types.MoveStructField {}
export interface OrmFieldConfig {
  /** This field will be used to create an object if set. */
  index?: boolean;
  /** The resource field name of onchain AptoOrm object */
  name?: string;
  /** The resource field type of onchain AptoOrm object */
  type?: OrmFieldCommonMoveType | OrmFieldVectorMoveType;
  /** The default value of the field if it is empty value. */
  default?: MoveValue;
  /** Timestamp updated automatically */
  timestamp?: boolean;
  /** This field is unable to updated after created. */
  immutable?: boolean;
  /** The constant value is set to the field. */
  constant?: string;
  /** whether the field is a major field of Aptos Token object. */
  token_field?: boolean;
  /** The field is a Aptos Token property */
  token_property?: boolean;
}

export class OrmFieldData {
  /** This field will be used to create an object if set. */
  public index?: boolean;
  /** The resource field name of onchain AptoOrm object */
  public name: string;
  /** The resource field type of onchain AptoOrm object */
  public type: OrmFieldTypeString;
  /** The default value of the field if it is empty value. */
  public default?: MoveValue;
  /** Timestamp updated automatically */
  public timestamp: boolean;
  /** This field is unable to updated after created. */
  public immutable: boolean;
  /** The constant value is set to the field. */
  public constant?: string;
  /** whether the field is a major field of Aptos Token object. */
  public token_field: boolean;
  /** The field is a Aptos Token property */
  public token_property: boolean;
  /** The resource field name of onchain AptoOrm object */
  /** The field name (property key) in the class */
  public property_key: string;
  /** The field type (property type) in the class */
  public property_type: any;
  /** whether the field is writable by the user */
  public writable: boolean;
}

/** ORM Token configuration */
export type OrmTokenConfig = {
  /** The representative name of the token collection (= Aptos Collection Name) */
  collection_name: string;
  /** The representative URI of the token collection (= Aptos Collection URI) */
  collection_uri: string;
  /** The representative description of the token collection (= Aptos Collection Description) */
  collection_description: string;
  /** The maximum token supply of the AptoORM class (= Aptos Collection Max Supply) */
  max_supply: number | bigint;
  /** Whether the token uses property map */
  token_use_property_map: boolean;
  /** Whether the token has royalty or the collection has royalty itself. */
  royalty_present: boolean;
  /** The payee of the royalty */
  royalty_payee: AccountAddressInput | undefined;
  /** The denominator of the royalty */
  royalty_denominator: number;
  /** The numerator of the royalty */
  royalty_numerator: number;
  /** Whether the token is numbered token */
  numbered_token?: boolean;
};

export type OrmObjectConfig = {
  /** The creator address of the object and package */
  package_creator: Account | AccountAddressInput;
  /** The package name where the objects belongs to */
  package_name: string;
  package_address?: AccountAddressInput; // address of the package
  /** Aptos creates named objects with predictable hash addresses, which are derived
   * from user input and the creator's address. This enables named objects to be indexed
   * and traced based on the user input provided by the creator.
   * AptoORM facilitates the creation of indexable objects by utilizing `index_fields`
   * to organize the fields used in the named object creation.
   * Conversely, if index_fields is not set, OrmObject is created with a random address. */
  index_fields?: string[];
  /** Objects created by the class can be transferred by `object::transfer()`. */
  direct_transfer?: boolean;
  /** The creator (The owner of OrmCreator object) can remove the ORM objects. */
  deletable_by_creator?: boolean;
  /** The owner can remove the ORM objects */
  deletable_by_owner?: boolean;
  /** The creator can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_creator?: boolean;
  /** The owner can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_owner?: boolean;
  /** The creator can extend the ORM objects. */
  extensible_by_creator?: boolean;
  /** The owner can extend the ORM objects. */
  extensible_by_owner?: boolean;
  named_addresses?: NamedAddresses;
  /** The token configuration must be set if the OrmObject is Aptos Token object. */
  token_config?: OrmTokenConfig;
};

export class OrmClassFactory {
  constructor(
    public package_creator: AccountAddress,
    public package_address: AccountAddress,
    public package_name: string,
    public module_name: string,
    public classes: ObjectLiteral[]
  ) {}
}

export interface OrmClassMetadata {
  factory?: OrmClassFactory;
  class: ObjectLiteral;
  package_creator: AccountAddress;
  package_address: AccountAddress;
  package_name: string;
  /** Aptos creates named objects with predictable hash addresses, which are derived
   * from user input and the creator's address. This enables named objects to be indexed
   * and traced based on the user input provided by the creator.
   * AptoORM facilitates the creation of indexable objects by utilizing `index_fields`
   * to organize the fields used in the named object creation.
   * Conversely, if index_fields is not set, OrmObject is created with a random address. */
  index_fields?: string[];
  direct_transfer?: boolean;
  /** The creator (The owner of OrmCreator object) can remove the ORM objects. */
  deletable_by_creator?: boolean;
  /** The owner can remove the ORM objects */
  deletable_by_owner?: boolean;
  /** The creator can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_creator?: boolean;
  /** The owner can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_owner?: boolean;
  /** The creator can extend the ORM objects. */
  extensible_by_creator?: boolean;
  /** The owner can extend the ORM objects. */
  extensible_by_owner?: boolean;
  named_addresses?: NamedAddresses;
  /** The token configuration must be set if the OrmObject is Aptos Token object. */
  token_config?: OrmTokenConfig;
  name: string; // name of the object
  module_name: string; // name of the module
  fields: OrmFieldData[]; // fields of the object
  user_fields: OrmFieldData[]; // user fields of the object
  error_code: Map<string, string>; // error code of the object
  use_modules: string[]; // modules used by the object
}

export const APTOS_COIN = '0x1::aptos_coin::AptosCoin';

export type Seq<T> = T[];
export type Uint8 = number;
export type Uint16 = number;
export type Uint32 = number;
export type Uint64 = bigint;
export type Uint128 = bigint;
export type Uint256 = bigint;
export type AnyNumber = bigint | number;
export type Bytes = Uint8Array;

// export type OrmFunctionPayload = InputGenerateTransactionPayloadData;
// InputEntryFunctionData | InputMultiSigData
// InputScriptData - not supported
export type OrmFunctionPayload = InputEntryFunctionData | InputMultiSigData;

// [FIXME] - payer => boolean으로 변경 - aptos-labs/ts-sdk 구조로 변경 필요
export type OrmTxnOptions = InputGenerateTransactionOptions & { payer?: Account | boolean };
export type FeeFreeOrmTxnOptions = Pick<OrmTxnOptions, 'accountSequenceNumber' | 'expireTimestamp'>;

export type PendingTransaction = PendingTransactionResponse;

export type OrmTxn = {
  type: 'simple' | 'multiAgent';
  txn: AnyRawTransaction;
  auths: (AccountAuthenticator | null)[];
  payer_auth?: AccountAuthenticator | null;
};

export type OrmPackageConfig = {
  /** The creator address of the object and package */
  package_creator: Account | AccountAddressInput;
  /** The package name where the objects belongs to */
  package_move_path: string;
  package_name: string;
  ormobjs: any[];
  named_addresses?: NamedAddresses;
  dependencies?: { name: string; git: string; subdir: string; rev: string }[]; // dependencies of the package
  local_apto_orm_package?: string; // path to local package
  modules_publish_order?: string[]; // modules publish order
};

/**
 * Interface of the simple literal object with any string keys.
 */
export interface ObjectLiteral {
  [key: string]: any;
}
export const object_addr = Symbol.for('orm:object:address');

/**
 * Interface of the simple literal object with account address.
 */
export interface ObjectAddressable extends ObjectLiteral {
  [object_addr]: AccountAddress;
}

/**
 * Represents some Type of the Object.
 */
export type ClassType<T> = { new (): T } | Function;

export type ClassName = string;
/**
 * OrmObject target.
 */
export type OrmObjectTarget<T> =
  | ClassType<T>
  | ObjectLiteral
  | ObjectAddressable
  | {
      address: AccountAddressInput;
      object: ClassType<T> | ObjectLiteral | ClassName;
    };

export type OrmTokenFactoryConfig = {
  /** The creator address of the object and package */
  package_creator: Account | AccountAddressInput;
  /** The package name where the objects belongs to */
  package_name: string;
  /** The name of the factory module */
  module_name: string;
  /** The representative name of the token collection (= Aptos Collection Name) */
  collection_name: string;
  /** The representative URI of the token collection (= Aptos Collection URI) */
  collection_uri: string;
  /** The representative description of the token collection (= Aptos Collection Description) */
  collection_description: string;
  /** The maximum token supply of the AptoORM class (= Aptos Collection Max Supply) */
  max_supply?: number | bigint;
  /** Whether the token uses property map */
  // token_use_property_map: boolean; // Always true
  /** Whether the token has royalty or the collection has royalty itself. */
  royalty_present?: boolean;
  /** The payee of the royalty */
  royalty_payee?: AccountAddressInput;
  /** The denominator of the royalty */
  royalty_denominator?: number;
  /** The numerator of the royalty */
  royalty_numerator?: number;
  /** Whether the token is numbered token */
  numbered_token?: boolean;
  /** Aptos creates named objects with predictable hash addresses, which are derived
   * from user input and the creator's address. This enables named objects to be indexed
   * and traced based on the user input provided by the creator.
   * AptoORM facilitates the creation of indexable objects by utilizing `index_fields`
   * to organize the fields used in the named object creation.
   * Conversely, if index_fields is not set, OrmObject is created with a random address. */
  index_fields?: string[];
  /** Objects created by the class can be transferred by `object::transfer()`. */
  direct_transfer?: boolean;
  /** The creator (The owner of OrmCreator object) can remove the ORM objects. */
  deletable_by_creator?: boolean;
  /** The owner can remove the ORM objects */
  deletable_by_owner?: boolean;
  /** The creator can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_creator?: boolean;
  /** The owner can transfer the ORM objects by AptoORM facilities. */
  indirect_transfer_by_owner?: boolean;
  /** The creator can extend the ORM objects. */
  extensible_by_creator?: boolean;
  /** The owner can extend the ORM objects. */
  extensible_by_owner?: boolean;
  named_addresses?: NamedAddresses;
};
