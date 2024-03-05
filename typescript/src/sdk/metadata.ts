import 'reflect-metadata';
import { AccountAddress } from '@aptos-labs/ts-sdk';
import {
  OrmClassMetadata,
  OrmObjectConfig,
  OrmFieldData,
  OrmFieldConfig,
  OrmTokenConfig,
  ObjectLiteral,
  OrmFieldCommonMoveType,
  OrmFieldTypeString,
} from './types';
import { camelToSnake, loadAddresses, toAddress } from './utilities';

const ormObjectKey = Symbol('orm:object');
const ormObjectFieldsKey = Symbol('orm:object:fields');
const ormClasses = new Map<string, ObjectLiteral>();
const ormPackageCreators = new Map<string, AccountAddress>();
const defaultTokenFields: Set<string> = new Set(['name', 'uri', 'description']);

export function getOrmClass(class_name: string) {
  return ormClasses.get(class_name);
}

export function getOrmClasses(package_name: string) {
  const classes: ObjectLiteral[] = [];
  for (const [_, value] of ormClasses) {
    if (getOrmClassMetadata(value).package_name === package_name) {
      classes.push(value);
    }
  }
  return classes;
}

export function getOrmPackageCreator(package_name: string) {
  return ormPackageCreators.get(package_name);
}

export function OrmClass(config: OrmObjectConfig) {
  if (!config) {
    throw new Error('config is required');
  }
  if (!config || !config.package_creator) {
    throw new Error('config.package_creator is required');
  }
  if (!config || !config.package_name) {
    throw new Error('config.package_name is required');
  }
  return function <T extends { new (...args: any[]): {} }>(target: T) {
    // if (!(target.prototype instanceof BaseOrmClass)) {
    //   throw new Error('OrmClass must extends BaseOrmClass');
    // }
    const module_name = camelToSnake(target.name);
    const named_addresses = {
      ...loadAddresses(config),
      ...config.named_addresses,
    };
    const fields: OrmFieldData[] = Reflect.getOwnMetadata(ormObjectFieldsKey, target.prototype) || [];
    const use_modules: string[] = [
      'std::signer',
      'std::error',
      'aptos_framework::object::{Self, Object}',
      'apto_orm::orm_creator',
      'apto_orm::orm_class',
      'apto_orm::orm_object',
      'apto_orm::orm_module',
      'std::option::{Self, Option}',
    ];
    let token_use_property_map = false;
    const index_fields = config?.index_fields || [];
    fields.forEach((field) => {
      if (field.index) {
        if (!index_fields.includes(field.name)) {
          index_fields.push(field.name);
        }
      }
      switch (field.property_type) {
        case 'Date':
          if (!use_modules.includes('aptos_framework::timestamp')) {
            use_modules.push('aptos_framework::timestamp');
          }
          break;
        case 'String':
          if (!use_modules.includes('std::string')) {
            use_modules.push('std::string');
          }
          break;
      }
      if (field.token_property) {
        if (!use_modules.includes('std::bcs')) {
          use_modules.push('std::bcs');
        }
        if (!use_modules.includes('aptos_token_objects::property_map')) {
          use_modules.push('aptos_token_objects::property_map');
        }
        token_use_property_map = true;
        if (!config.token_config) {
          throw new Error(`OrmTokenClass must be declared for token_property [${field.name}]`);
        }
      }
      if (field.timestamp) {
        if (!use_modules.includes('aptos_framework::timestamp')) {
          use_modules.push('aptos_framework::timestamp');
        }
      }
    });
    if (index_fields.length > 3) {
      throw new Error('index_fields must be less than 3');
    }
    for (const index_field of index_fields) {
      const field = fields.find((field) => field.name === index_field);
      if (!field) {
        throw new Error(`index_field [${index_field}] not found`);
      }
    }
    if (index_fields.length > 0) {
      use_modules.push('apto_orm::utilities');
    }
    const user_fields: OrmFieldData[] = [];
    if (config?.token_config) {
      if (!config.token_config.token_use_property_map)
        config.token_config.token_use_property_map = token_use_property_map;
      // set collection name
      if (!config.token_config.collection_name) {
        config.token_config.collection_name = target.name;
      }
      use_modules.push('aptos_token_objects::token');
      const token_fields: Set<string> = new Set(defaultTokenFields);
      fields.forEach((field) => {
        const removed = token_fields.delete(field.name);
        if (removed) {
          field.token_field = true;
        } else {
          user_fields.push(field);
        }
      });
      if (token_fields.size > 0) {
        throw new Error(`OrmTokenClass object must have [${Array.from(token_fields).join(', ')}] fields`);
      }
      if (config.token_config.royalty_present) {
        if (!config.token_config.royalty_payee) {
          // This is not required because the royalty can be set by the collection owner.
          // throw new Error('config.token_config.royalty_payee must be set');
        }
        if (!config.token_config?.royalty_denominator || config.token_config.royalty_denominator <= 0) {
          throw new Error('token_config.royalty_denominator must be greater than 0');
        }
      }
    } else {
      user_fields.push(...fields);
    }
    use_modules.sort();
    const resource: OrmClassMetadata = {
      ...config,
      class: target,
      package_creator: toAddress(config.package_creator),
      package_address: named_addresses[config.package_name],
      name: target.name,
      module_name,
      fields,
      user_fields: user_fields,
      index_fields,
      direct_transfer: config?.direct_transfer || true,
      deletable_by_creator: config?.deletable_by_creator || true,
      deletable_by_owner: config?.deletable_by_owner || false,
      indirect_transfer_by_creator: config?.indirect_transfer_by_creator || true,
      indirect_transfer_by_owner: config?.indirect_transfer_by_owner || false,
      extensible_by_creator: config?.extensible_by_creator || true,
      extensible_by_owner: config?.extensible_by_owner || false,
      error_code: new Map<string, string>([
        ['not_found', `E${target.name.toUpperCase()}_OBJECT_NOT_FOUND`],
        ['not_valid_object', `ENOT_${target.name.toUpperCase()}_OBJECT`],
      ]),
      use_modules,
      named_addresses,
    };
    Reflect.defineMetadata(ormObjectKey, resource, target);
    ormClasses.set(target.name, target);
    ormPackageCreators.set(config.package_name, toAddress(config.package_creator));
    return class extends target {
      public config = config;
      constructor(...args: any[]) {
        super(...args);
        this.config = config;
      }
    };
  };
}

export const OrmTokenClass = (option: OrmObjectConfig & Partial<OrmTokenConfig>) => {
  const token_config: OrmTokenConfig = {
    collection_name: option?.collection_name || '',
    collection_uri: option?.collection_uri || '',
    collection_description: option?.collection_description || '',
    max_supply: option?.max_supply || 0n,
    token_use_property_map: option?.token_use_property_map || false,
    royalty_present: option?.royalty_present || false,
    royalty_payee: option?.royalty_payee,
    royalty_denominator: option?.royalty_denominator || 0,
    royalty_numerator: option?.royalty_numerator || 0,
  };
  return OrmClass({
    token_config,
    ...option,
  });
};

/**
 * OrmField decorator is used to define a field of the OrmClass.
 * @param config is used to set the configuration option of the field.
 */
export function OrmField(config?: OrmFieldConfig): PropertyDecorator {
  return (target: Object, key: string) => {
    // let descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!config) config = {};
    const tsTypeClass = Reflect.getMetadata('design:type', target, key);
    const typeInMove = toTypeStringInMove(tsTypeClass.name, config.type);
    const field = new OrmFieldData();
    field.name = config.name || camelToSnake(key);
    field.type = typeInMove;
    field.property_key = key;
    field.property_type = tsTypeClass.name;
    field.writable = (() => {
      if (config.constant) {
        return false;
      }
      return config.timestamp ? false : true;
    })();
    field.immutable = config.immutable || false;
    field.constant = config.constant;
    field.index = config.index || false;
    field.token_property = config.token_property || false;
    field.timestamp = config.timestamp || false;

    const fields: OrmFieldData[] = Reflect.getOwnMetadata(ormObjectFieldsKey, target) || [];
    fields.push(field);
    Reflect.defineMetadata(ormObjectFieldsKey, fields, target);
    Reflect.defineMetadata(ormObjectKey, field, target, key);
    // let writable = true;
    // if (field.timestamp) writable = false;
    // if (config.constant) {
    //   return {
    //     enumerable: true,
    //     configurable: true,
    //     writable: true,
    //     get: () => config.constant,
    //     set: (_: any) => {},
    //   };
    // }
  };
}

/**
 * OrmIndexField decorator is used to define the index field of the OrmClass.
 * @param config is used to set the configuration option of the field.
 */
export const OrmIndexField = (config?: OrmFieldConfig) => {
  if (!config) config = {};
  config.index = true;
  return OrmField(config);
};

function toTypeStringInMove(typeInTs: string, typeInMove?: OrmFieldCommonMoveType): OrmFieldTypeString {
  if (typeInMove) {
    switch (typeInMove) {
      case 'address':
        return 'address';
      case 'string':
      case 'String':
        if (typeInTs !== 'String') throw new Error('Type mismatch');
        return 'string::String';
      case 'u8':
      case 'u16':
      case 'u32':
        if (typeInTs !== 'Number') throw new Error('Type mismatch');
        return typeInMove;
      case 'u64':
        if (typeInTs === 'Date') return typeInMove;
        if (typeInTs !== 'Bigint' && typeInTs !== 'Number') throw new Error('Type mismatch');
        return typeInMove;
      case 'u128':
      case 'u256':
        if (typeInTs !== 'String') throw new Error('Type mismatch');
        return typeInMove;
      case 'bool':
        if (typeInTs !== 'Boolean') throw new Error('Type mismatch');
        return 'bool';
      case 'u128':
      case 'u256':
        if (typeInTs !== 'String') throw new Error('Type mismatch');
        return typeInMove;
      case 'bytes':
        return 'vector<u8>';
    }
  }
  switch (typeInTs) {
    case 'Number':
      return 'u64';
    case 'Boolean':
      return 'bool';
    case 'String':
      return 'string::String';
    case 'Bigint':
      return 'u64';
    case 'Date':
      return 'u64';
    default:
      return 'u64';
  }
}

export function getOrmClassMetadata(ormobj: ObjectLiteral | Function | string) {
  if (typeof ormobj === 'string') {
    ormobj = ormClasses.get(ormobj);
  } else if (typeof ormobj === 'object') {
    ormobj = ormobj.constructor;
  }
  if (!ormobj) throw new Error('OrmClass is undefined');
  const meta: OrmClassMetadata = Reflect.getMetadata(ormObjectKey, ormobj);
  // const fields = Reflect.getOwnMetadata(ormObjectFieldsKey, user_object.constructor.prototype);
  // const fields = Reflect.getOwnMetadata(ormObjectFieldsKey, userObject);
  if (!meta) throw new Error('OrmClass metadata not found in user class');
  return meta;
}

export function getOrmClassFieldMetadata(ormobj: ObjectLiteral | Function | string, field_name: string) {
  if (typeof ormobj === 'string') {
    ormobj = ormClasses.get(ormobj);
  } else if (typeof ormobj === 'object') {
    ormobj = ormobj.constructor;
  }
  if (!ormobj) throw new Error('OrmClass is undefined');
  const data: OrmFieldData = Reflect.getMetadata(ormObjectKey, ormobj.prototype, field_name);
  return data;
}

export function loadNamedAddresses(ormobj: ObjectLiteral) {
  const meta = getOrmClassMetadata(ormobj);
  return meta.named_addresses;
}
