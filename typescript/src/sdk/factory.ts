import { Account, AccountAddress, AccountAddressInput } from '@aptos-labs/ts-sdk';
import {
  NamedAddresses,
  OrmClassMetadata,
  OrmObjectConfig,
  OrmTokenConfig,
  ObjectLiteral,
  OrmFieldData,
} from './types';
import orm, { OrmClass, OrmField, snakeToCamel } from '../sdk';

export function OrmTokenFactory(config: { package_creator: string; package_name: string }) {
  if (!config) {
    throw new Error('config is required');
  }
  if (!config || !config.package_creator) {
    throw new Error('config.package_creator is required');
  }
  if (!config || !config.package_name) {
    throw new Error('config.package_name is required');
  }
  const package_creator = AccountAddress.fromString(config.package_creator);
  const updated_config = {
    factory: true,
    package_creator: package_creator,
    package_name: config.package_name,
  };
  return function <T extends { new (...args: any[]): {} }>(target: T) {
    return class extends target {
      public config = updated_config;
      constructor(...args: any[]) {
        super(...args);
        this.config = updated_config;
      }
    };
  };
}

// onchain function => create(name, uri, description, keys, types, values);
@OrmTokenFactory({ package_creator: '0x1', package_name: 'villains' })
export class MyFirstToken {
  name: string;
  uri: string;
  description: string;
  // all properties becomes token_property_map
  level!: number;
  grade!: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  comment!: string;
  optional?: string;
  constructor(fields?: Partial<MyFirstToken>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof MyFirstToken];
      }
    }
  }
}
