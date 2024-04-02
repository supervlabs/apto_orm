#!/usr/bin/env node
import { Command } from 'commander';
import { loadOrmClient } from './utilities';
import { AccountAddressInput, Account } from '@aptos-labs/ts-sdk';
import { getOrmPackageCreator, getPackageAddress, loadAccountFromPrivatekeyFile, toAddress } from '../sdk';
import path from 'path';
import YAML from 'yaml';

export function loadPackageAddress(program: Command) {
  const { key, address, creator, name } = program.optsWithGlobals();
  const package_path = program.opts()?.path || program.args[0];

  const package_name = name || package_path ? path.basename(package_path) : undefined;
  let package_creator = creator;
  let package_address: AccountAddressInput = address as string;
  if (!package_address) {
    if (creator && name) {
      package_address = getPackageAddress(creator, name);
    } else if (package_name) {
      let package_owner: Account;
      if (key) {
        package_owner = loadAccountFromPrivatekeyFile(key);
        console.log('!!!!');
        package_address = getPackageAddress(package_owner.accountAddress, package_name);
      } else {
        if (!package_creator) package_creator = getOrmPackageCreator(package_name);
        package_address = getPackageAddress(package_creator, package_name);
      }
    }
    // console.log({ package_address });
  }
  if (!package_creator) {
    if (package_name) package_creator = getOrmPackageCreator(package_name);
  }
  if (!package_address) {
    throw new Error(`package address not specified`);
  }
  return [toAddress(package_creator).toString(), package_name, toAddress(package_address).toString()];
}

export const retrieve = new Command('retrieve');
retrieve
  .description('retrieve your AptoORM package information')
  .option('-a, --address <ADDRESS>', 'The package address')
  .option('-c, --creator <ADDRESS>', 'The package creator')
  .option('-n, --name <PACKAGE_NAME>', 'The name of the package')
  .action(async function () {
    const client = loadOrmClient(retrieve);
    const { name, creator, address } = this.optsWithGlobals();
    let package_address: AccountAddressInput = address as string;
    if (creator && name) {
      package_address = getPackageAddress(creator, name);
    }
    const output: any = {};
    const resources = await client.getAccountResources({ accountAddress: package_address });
    for (const resource of resources) {
      if (resource.type.startsWith(`${client.ormAddress}::orm_module::OrmModule<`)) {
        const full_class_type = resource.type.split('<')[1].split('>')[0];
        const class_address = (resource?.data as any)?.class?.inner;
        const signer_address = (resource?.data as any)?.signer?.inner;
        const class_type = full_class_type.split('::')[2];
        output[class_type] = {
          class_address,
          signer_address,
        };
      }
    }
    console.log(YAML.stringify({ retrieved: output }));
  });

export default retrieve;
