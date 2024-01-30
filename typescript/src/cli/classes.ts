import { getPackageAddress, toAddress } from '../sdk';
import { AccountAddressInput, Account } from '@aptos-labs/ts-sdk';

export function loadBaseObjectString(
  package_creator: Account | AccountAddressInput,
  package_name: string,
  class_name: string
) {
  return `
import { OrmClass, OrmField, OrmIndexField } from 'apto_orm';

@OrmClass({
  package_address: '${getPackageAddress(package_creator, package_name).toString()}',
  package_creator: '${toAddress(package_creator).toString()}',
  package_name: '${package_name}',
})
export class ${class_name} {
  @OrmIndexField()
  id!: number;

  @OrmField({ type: 'String' })
  name!: string;

  constructor(fields?: Partial<${class_name}>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof ${class_name}];
      }
    }
  }
}
`;
}

export function loadBaseTokenString(
  package_creator: Account | AccountAddressInput,
  package_name: string,
  class_name: string
) {
  return `
import { OrmTokenClass, OrmField, OrmIndexField } from 'apto_orm';

@OrmTokenClass({
  package_address: '${getPackageAddress(package_creator, package_name).toString()}',
  package_creator: '${toAddress(package_creator).toString()}',
  package_name: '${package_name}',
  collection_name: 'AptoORM ${class_name}',
  collection_uri: 'https://raw.githubusercontent.com/neoul/apto_orm/main/resource.png',
  collection_description: 'Sample AptoORM Token',
  max_supply: 1000n,
  token_use_property_map: false,
  royalty_present: false,
  royalty_denominator: 100,
  royalty_numerator: 1,
})
export class ${class_name} {
  @OrmIndexField({ immutable: true })
  name!: string;

  @OrmIndexField({ immutable: true })
  id!: number;

  @OrmField()
  uri!: string;

  @OrmField()
  description!: string;
}`;
}
