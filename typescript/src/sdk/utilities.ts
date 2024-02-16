import path from 'path';
import fs from 'fs';
import util from 'util';
import {
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
  Ed25519PrivateKey,
  GenerateAccount,
} from '@aptos-labs/ts-sdk';
import {
  OrmObjectConfig,
  NamedAddresses,
  OrmObjectLiteral,
  OrmObjectTarget,
  OrmObjectType,
  OrmClassMetadata,
  OrmFieldData,
  object_addr,
  OrmObjectAddressable,
} from './types';
import { sha3_256 as sha3Hash } from '@noble/hashes/sha3';
import toml from 'toml';
import { getOrmClassFieldMetadata, getOrmClassMetadata } from './metadata';

export const camelToSnake = (str: string) =>
  str[0].toLowerCase() + str.slice(1, str.length).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function snakeToCamel(input: string, capitalize?: boolean): string {
  return input
    .split(/_|-/)
    .reduce(
      (res, word, i) =>
        i === 0
          ? capitalize
            ? `${word.charAt(0).toUpperCase()}${word.substring(1).toLowerCase()}`
            : word.toLowerCase()
          : `${res}${word.charAt(0).toUpperCase()}${word.substring(1).toLowerCase()}`,
      ''
    );
}

export function retrieveFilesInDir(dir: string, excluded: string[]) {
  const files = fs.readdirSync(dir);
  const found: string[] = [];
  files.forEach(function (file) {
    for (const exclude of excluded) {
      if (file.indexOf(exclude) > 0) return;
    }
    if (!fs.statSync(dir + '/' + file).isDirectory()) {
      found.push(path.join(dir, '/', file));
    }
  });
  return found;
}

export function loadAccountFromPrivatekeyFile(filepath: string): Account {
  const keyStr = fs.readFileSync(filepath, 'utf8');
  const privateKey = new Ed25519PrivateKey(keyStr);
  return Account.fromPrivateKey({ privateKey });
}

export function createAccount(arg?: GenerateAccount): Account {
  return Account.generate(arg);
}

export function ensureAddressString(address: AccountAddressInput) {
  return AccountAddress.from(address).toString();
}

export function toAddress(account: Account | AccountAddressInput): AccountAddress {
  if (account instanceof Account) {
    return account.accountAddress;
  }
  return AccountAddress.from(account);
}

// [FIXME] This is a temporary solution to get the address of AptoORM.
export function getOrmAccountAddress() {
  return toAddress(process.env.APTO_ORM_ADDR || '0xfacedd48d64a2ee04cbdf5c17608bd7a5ea9144fa1fe65320c588fffea131de3');
}

// [FIXME] This is a temporary solution to get the address of AptoORM.
export function getOrmAddress() {
  return getOrmAccountAddress().toString();
}

export function debug(arg: any) {
  console.log(util.inspect(arg, false, null, true));
}

export function loadToml(tomlPath: string) {
  const data = fs.readFileSync(tomlPath, 'utf8');
  return toml.parse(data);
}

export function loadMoveToml(path: string) {
  return loadToml(path);
}

export function getNamedObjectAddress(creator: Account | AccountAddressInput, name: string[]) {
  // let seed = *string::bytes(collection);
  // vector::append(&mut seed, b"::");
  // vector::append(&mut seed, *string::bytes(name));
  const creatorAddress = AccountAddress.from(toAddress(creator));
  const source = creatorAddress.bcsToBytes();
  const buffer = Buffer.from(name.join('::'));
  const seed = Uint8Array.from(buffer);
  const bytes = new Uint8Array([...source, ...seed, 0xfe]);
  const hash = sha3Hash.create();
  hash.update(bytes);
  return AccountAddress.from(hash.digest());
  // return Hex.fromHexInput(hash.digest());
}

export function getPackageAddress(pkgCreator: Account | AccountAddressInput, pkgName: string) {
  return getNamedObjectAddress(pkgCreator, [pkgName]);
}

export function loadAddresses(config: OrmObjectConfig, throw_error = false) {
  const named_addresses: NamedAddresses = config?.named_addresses || {};
  try {
    named_addresses[config.package_name] = getPackageAddress(config.package_creator, config.package_name);
    named_addresses['apto_orm'] = getOrmAccountAddress();
    return named_addresses;
  } catch (err) {
    if (throw_error) {
      throw err;
    }
  }
  // [Read it from Move.toml]
  // try {
  //   const move_toml_path = path.join(package_move_path, 'Move.toml');
  //   const move_toml = loadToml(move_toml_path);
  //   if (move_toml?.addresses) {
  //     return move_toml.addresses as NamedAddresses;
  //   }
  // } catch (err) {
  //   if (throw_error) {
  //     throw err;
  //   }
  // }
  return {};
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hexEncodedBytesToUint8Array(b: string) {
  if (b === '0x') {
    return new Uint8Array(0);
  }
  try {
    return Hex.fromString(b).toUint8Array();
  } catch (err) {
    throw new Error(`invalid hex-encoded bytes: ${b}`);
  }
}

export function uint8ArrayToHexEncodedBytes(arr: Uint8Array) {
  return Hex.fromHexInput(arr).toString();
}

export function serializeArgument(arg: any): any {
  if (arg instanceof Hex) {
    return arg.toString();
  } else if (arg instanceof Uint8Array) {
    return 'vector<u8>::' + uint8ArrayToHexEncodedBytes(arg);
  } else if (Array.isArray(arg)) {
    return arg.map(serializeArgument) as any;
  }
  return arg;
}

export function deserializeArgument(arg: any): any {
  if (typeof arg === 'string' && arg.startsWith('vector<u8>::')) {
    return hexEncodedBytesToUint8Array(arg.slice('vector<u8>::'.length));
  } else if (Array.isArray(arg)) {
    return arg.map(deserializeArgument) as any;
  }
  return arg;
}

export function stringifyJson(obj: any, space: string | number = 0) {
  return JSON.stringify(
    obj,
    function (key, value) {
      if (value instanceof Uint8Array) {
        return 'vector<u8>::' + uint8ArrayToHexEncodedBytes(value);
      }
      return value;
    },
    space
  );
}

export function parseJson(str: string) {
  return JSON.parse(str, function (key, value) {
    if (typeof value === 'string' && value.startsWith('vector<u8>::')) {
      return hexEncodedBytesToUint8Array(value.slice('vector<u8>::'.length));
    }
    return value;
  });
}

export function areUint8ArraysEqual(arr1: Uint8Array, arr2: Uint8Array) {
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false;
    }
  }
  return true;
}

export function loadOrmClassMetadata<OrmObject extends OrmObjectLiteral>(
  target: OrmObjectTarget<OrmObject>,
  acquire_address: boolean = false
) {
  if (!target) {
    throw new Error('target is required');
  }
  let object: OrmObjectLiteral | OrmObjectAddressable;
  let address: AccountAddress;
  let metadata: OrmClassMetadata;
  if (typeof target === 'function') {
    const orm_class = target as OrmObjectType<OrmObject>;
    metadata = getOrmClassMetadata(orm_class);
  } else {
    const any_target = target as any;
    if (any_target?.address && any_target?.object) {
      metadata = getOrmClassMetadata(any_target.object);
      if (acquire_address) address = toAddress(any_target.address);
      if (typeof any_target.object === 'object') {
        object = any_target.object;
      }
    } else {
      // typeof target === 'object'
      object = target as OrmObjectLiteral;
      metadata = getOrmClassMetadata(object.constructor);
    }
  }
  if (acquire_address) {
    if (!address) {
      if (metadata.index_fields.length <= 0) {
        throw new Error(`unable to specify object address because it has no index fields`);
      }
      const index_fields = metadata.index_fields.map((field_name) => {
        const field = getOrmClassFieldMetadata(metadata.name, field_name);
        if (field?.constant) {
          return field.constant;
        }
        return (target as any)[field_name];
      });
      if (metadata.token_config) {
        address = getNamedObjectAddress(metadata.package_address, [
          metadata.token_config.collection_name,
          ...index_fields,
        ]);
      } else {
        address = getNamedObjectAddress(metadata.package_address, index_fields);
      }
    }
    if (typeof object === 'object') {
      object = setOrmObjectAddress(object, address);
    }
  }
  return {
    object,
    address,
    metadata,
  };
}

export function toPrimitiveType(value: any, t: OrmFieldData) {
  if (t.property_type === 'Number') {
    return Number(value);
  } else if (t.property_type === 'BigInt') {
    return BigInt(value);
  } else if (t.property_type === 'Boolean') {
    return !!value;
  } else if (t.property_type === 'String') {
    return String(value);
  }
  return value;
}

export function setOrmObjectAddress(ormobj: OrmObjectLiteral, address: AccountAddress) {
  if (typeof ormobj !== 'object') {
    throw new Error(`ormobj must be an object`);
  }
  const o = ormobj as any;
  Object.defineProperty(o, object_addr, {
    value: address,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return o as OrmObjectAddressable;
}

export function getOrmObjectAddress(ormobj: OrmObjectLiteral) {
  return getOrmObjectAccountAddress(ormobj)?.toString();
}

export function getOrmObjectAccountAddress(ormobj: OrmObjectLiteral) {
  if (typeof ormobj !== 'object') {
    throw new Error(`ormobj must be an object`);
  }
  const address = (ormobj as any)[object_addr];
  if (address) {
    return address instanceof AccountAddress ? address : AccountAddress.from(address);
  }
}

export function getClassAddress<OrmObject extends OrmObjectLiteral>(
  target: OrmObjectType<OrmObject> | OrmObjectLiteral | OrmObjectAddressable | string
) {
  if (!target) {
    throw new Error('target is required');
  }
  let address: HexString;
  let metadata: OrmClassMetadata;
  if (typeof target === 'function') {
    const orm_class = target as OrmObjectType<OrmObject>;
    metadata = getOrmClassMetadata(orm_class);
  } else {
    metadata = getOrmClassMetadata(target);
  }
  if (metadata.token_config) {
    address = getNamedObjectAddress(metadata.package_address, [metadata.token_config.collection_name]);
  } else {
    address = getNamedObjectAddress(metadata.package_address, [metadata.name]);
  }
  return address;
}
