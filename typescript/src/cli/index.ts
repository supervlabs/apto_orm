#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import orm, {
  getOrmPackageCreator,
  getPackageAddress,
  getShortAddress,
  loadAccountFromPrivatekeyFile,
  toAddress,
} from '../sdk';
import { Account, Ed25519Account } from '@aptos-labs/ts-sdk';

import { loadBaseObjectString, loadBaseTokenString } from './classes';
import { loadOrmClient, checkPackagePath, loadPackageClasses } from './utilities';
import { poa } from './poa';
import { loadPackageAddress, retrieve } from './retrieve';

export const program = new Command();
program.name('apto_orm');
program.description('Aptos Onchain Move ORM (Object–relational mapping)');
program.option('-n, --network <network>', 'The Aptos network to connect to');

program
  .command('init')
  .description('Initialize onchain move package and create a sample class')
  .argument('<package_path>', 'The AptoORM package path and name')
  .option('-c, --classes [classes...]', 'The class names to create e.g. -c BaseObject')
  .option('-k, --key <key_file>', 'The private key file of the package owner')
  .option('-r, --random_key', 'Randomly generate the private key file of the package owner', true)
  .option('-t, --token', 'Generate a sample token class in the package instead of a sample object class', false)
  .option('  , --update_tsconfig', 'Update tsconfig.json file for AptoORM usage', false)
  .action(async function () {
    const { classes, random_key, key, token, update_tsconfig } = this.opts();
    const update_profile = false;
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    let package_owner: Ed25519Account;
    if (key) {
      package_owner = loadAccountFromPrivatekeyFile(key);
    } else if (random_key) {
      if (fs.existsSync(path.resolve(process.cwd(), `.key/${package_name}`))) {
        package_owner = loadAccountFromPrivatekeyFile(`.key/${package_name}`);
      } else {
        package_owner = Account.generate();
      }
    }
    // load previous classes
    await loadPackageClasses(package_name, package_path, []);
    const package_creator = getOrmPackageCreator(package_name) || package_owner.accountAddress;
    if (random_key && !key) {
      const dotkey = path.resolve(process.cwd(), `.key`);
      if (!fs.existsSync(dotkey)) {
        fs.mkdirSync(dotkey, { recursive: true });
      }
      fs.writeFileSync(
        path.resolve(dotkey, `${package_name}`),
        package_owner.privateKey.toString().toUpperCase().slice(2)
      );
      fs.writeFileSync(
        path.resolve(dotkey, `${package_name}.pub`),
        package_owner.publicKey.toString().toUpperCase().slice(2)
      );
      console.log(`The package key file is generated to ${path.resolve(dotkey, `${package_name}`)}.`);
    }
    if (update_profile) {
      const dotaptos = path.resolve(process.cwd(), `.aptos`);
      if (!fs.existsSync(dotaptos)) {
        fs.mkdirSync(dotaptos, { recursive: true });
      }
      let content: any;
      try {
        const configyaml = YAML.parseDocument(fs.readFileSync(path.resolve(dotaptos, `config.yaml`), 'utf8'));
        content = configyaml.toJSON();
        content['profiles'] = content['profiles'] || {};
      } catch (e) {
        content = {
          profiles: {},
        };
      }
      content['profiles'][package_name] = {
        private_key: package_owner.privateKey.toString(),
        public_key: package_owner.publicKey.toString(),
        account: toAddress(package_creator).toString(),
      };
      fs.writeFileSync(path.resolve(dotaptos, `config.yaml`), '---\n' + YAML.stringify(content));
    }
    if (!fs.existsSync(package_path)) {
      fs.mkdirSync(package_path, { recursive: true });
    }
    const sample = token ? 'BaseToken' : 'BaseObject';
    const classlist = classes || [sample];
    for (const c of classlist) {
      const contents = token
        ? loadBaseTokenString(package_creator, package_name, c)
        : loadBaseObjectString(package_creator, package_name, c);
      fs.writeFileSync(`${package_path}/${c}.ts`, contents, { flag: 'w', encoding: 'utf8' });
    }

    if (update_tsconfig) {
      const tsconfig_path = path.resolve(process.cwd(), `tsconfig.json`);
      if (fs.existsSync(tsconfig_path)) {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfig_path, 'utf8'));
        tsconfig['compilerOptions'] = tsconfig['compilerOptions'] || {};
        tsconfig['compilerOptions']['experimentalDecorators'] = true;
        tsconfig['compilerOptions']['emitDecoratorMetadata'] = true;
        fs.writeFileSync(tsconfig_path, JSON.stringify(tsconfig, null, 2));
      } else {
        const tsconfig = {
          compilerOptions: {
            baseUrl: 'src',
            rootDir: 'src',
            allowSyntheticDefaultImports: true,
            allowJs: true,
            declaration: true,
            declarationMap: true,
            esModuleInterop: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            module: 'commonjs',
            noImplicitAny: true,
            outDir: 'dist',
            sourceMap: true,
            target: 'es2020',
            moduleResolution: 'node',
            skipLibCheck: true,
            pretty: true,
            types: ['node'],
          },
          include: ['src'],
          exclude: ['node_modules', '**/*.spec.ts', '**/*.test.ts'],
        };
        fs.writeFileSync(tsconfig_path, JSON.stringify(tsconfig, null, 2));
      }
    }
    console.log(`classes '${classlist}' are created to the package '${package_name}'`);
    console.log(` - creator: ${package_creator}`);
    console.log(` - address: ${getPackageAddress(package_creator, package_name)}`);
    console.log(` - path: ${package_path}`);
  });

program
  .command('generate')
  .description('Generate onchain move codes')
  .argument('<package_path>', 'The AptoORM package path and name')
  .option('-c, --classes [classes...]', 'The class names to be generated')
  .option('-d, --dependencies [dependencies...]', 'The module dependencies to be included')
  .option('-a, --addresses [module=addr...]', 'The static named addresses used in the package')
  .action(async function () {
    const { classes, dependencies, addresses } = this.opts();
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    if (!fs.existsSync(package_path)) {
      fs.mkdirSync(package_path, { recursive: true });
    }
    const ormclasses = await loadPackageClasses(package_name, package_path, classes);
    const package_creator = getOrmPackageCreator(package_name);
    const package_config: orm.OrmPackageConfig = {
      package_creator,
      package_name,
      package_move_path: `${package_path}/move`,
      ormobjs: ormclasses,
      dependencies: dependencies ? JSON.parse(dependencies) : undefined,
      named_addresses: addresses,
    };
    orm.generatePackage(package_config);
    console.log(`package '${package_name}' generated`);
    console.log(` - path: ${package_path}`);
    console.log(` - creator: ${package_creator}`);
    console.log(` - address: ${getPackageAddress(package_creator, package_name)}`);
  });

program
  .command('compile')
  .description('Compile the target onchain package')
  .argument('<package_path>', 'The AptoORM package path and name to compile')
  .option('-a, --addresses [module=addr...]', 'The named addresses used in the package')
  .action(async function () {
    const package_path = this.args[0];
    const { addresses } = this.opts();
    const package_move_path = `${package_path}/move`;
    if (!fs.existsSync(package_move_path)) {
      throw new Error(`package_move_path '${package_move_path}' not exists`);
    }
    orm.compilePackage({ package_move_path, named_addresses: addresses });
  });

program
  .command('publish')
  .description('Publish the target onchain package')
  .argument('<package_path>', 'The AptoORM package path and name to publish')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .option('-a, --addresses [module=addr...]', 'The named addresses used in the package')
  .action(async function () {
    const client = loadOrmClient(program);
    const package_path = this.args[0];
    const { addresses, key } = this.opts();
    const package_move_path = `${package_path}/move`;
    if (!key) {
      throw new Error(`key file not specified`);
    } else {
      if (!fs.existsSync(key)) {
        throw new Error(`key file '${key}' not exists`);
      }
    }
    const package_name = path.basename(package_path);
    const package_owner = loadAccountFromPrivatekeyFile(key);
    const package_creator = getOrmPackageCreator(package_name) || package_owner.accountAddress;
    const txns = await orm.publishPackageTxns(client, package_owner, {
      package_creator,
      package_name,
      package_move_path,
      named_addresses: addresses,
    });
    const pendings = await client.signAndsubmitOrmTxns([package_owner], txns);
    const txnrs = await client.waitForOrmTxnsWithResult(pendings, { timeoutSecs: 30, checkSuccess: true });
    txnrs.map((txnr, index) => console.log(`${index}th txn: ${txnr.hash}`));
    console.log(`package '${package_name}' published`);
    console.log(` - path: ${package_path}`);
    console.log(` - creator: ${package_creator}`);
    console.log(` - address: ${getPackageAddress(package_creator, package_name)}`);
  });

program
  .command('update-module')
  .description('Patch the target module')
  .argument('<package_path>', 'The AptoORM package path and name to publish')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .requiredOption('-c, --class <CLASS_NAME>', 'The class to be created e.g. -c BaseObject')
  .action(async function () {
    const client = loadOrmClient(program);
    const { key } = this.opts();
    const class_name = this.opts()?.class;
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    if (!key) {
      throw new Error(`key file not specified`);
    }
    const package_owner: Account = loadAccountFromPrivatekeyFile(key);
    const ormclasses = await loadPackageClasses(package_name, package_path, [class_name]);
    if (ormclasses.length === 0) {
      throw new Error(`class '${class_name}' not found`);
    }
    if (ormclasses.length > 1) {
      throw new Error(`class '${class_name}' is ambiguous`);
    }
    const target_class = ormclasses[0];
    if (!target_class) {
      throw new Error(`class '${class_name}' not found`);
    }
    const txn = await client.generateOrmTxn([package_owner], {
      function: `${client.ormAddress}::${package_name}::update_module`,
      typeArguments: [],
      functionArguments: [],
    });
    const ptxn = await client.signAndsubmitOrmTxn([package_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
  });

program
  .command('create')
  .description('Create the target class object')
  .argument('<package_path>', 'The AptoORM package path and name')
  .option('-t, --to <ADDRESS>', 'The address received the creating object')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .requiredOption('-c, --class <CLASS_NAME>', 'The class to be created e.g. -c BaseObject')
  .requiredOption(
    '-d, --data <JSON_DATA>',
    `The class data to be published e.g. -d '{ "id": 1004, "name": "willing" }'`
  )
  .action(async function () {
    const client = loadOrmClient(program);
    const { key, data, to } = this.opts();
    const class_name = this.opts()?.class;
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    if (!key) {
      throw new Error(`key file not specified`);
    }
    const package_owner: Account = loadAccountFromPrivatekeyFile(key);
    const ormclasses = await loadPackageClasses(package_name, package_path, [class_name]);
    if (ormclasses.length === 0) {
      throw new Error(`class '${class_name}' not found`);
    }
    if (ormclasses.length > 1) {
      throw new Error(`class '${class_name}' is ambiguous`);
    }
    const target_class = ormclasses[0];
    if (!target_class) {
      throw new Error(`class '${class_name}' not found`);
    }
    const dataobj = Object.create((target_class as any).prototype);
    Object.assign(dataobj, JSON.parse(data));
    const txn = to
      ? await client.createToTxn(package_owner, dataobj, to)
      : await client.createTxn(package_owner, dataobj);
    const ptxn = await client.signAndsubmitOrmTxn([package_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
    const address = client.retrieveOrmObjectAddressFromTxnr(txnr);
    console.log(`created address:`, address);
  });

program
  .command('update')
  .description('Update the target class object')
  .argument('<package_path>', 'The AptoORM package path and name')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .requiredOption('-c, --class <CLASS_NAME>', 'The class to be created e.g. -c BaseObject')
  .option('-a, --address <ADDRESS>', 'The address of the object to be updated')
  .requiredOption(
    '-d, --data <JSON_DATA>',
    `The class data to be published e.g. -d '{ "id": 1004, "name": "willing" }'`
  )
  .action(async function () {
    const client = loadOrmClient(program);
    const { key, data } = this.opts();
    const class_name = this.opts()?.class;
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    if (!key) {
      throw new Error(`key file not specified`);
    }
    const package_owner = loadAccountFromPrivatekeyFile(key);
    const ormclasses = await loadPackageClasses(package_name, package_path, [class_name]);
    if (ormclasses.length === 0) {
      throw new Error(`class '${class_name}' not found`);
    }
    if (ormclasses.length > 1) {
      throw new Error(`class '${class_name}' is ambiguous`);
    }
    const target_class = ormclasses[0];
    const dataobj = Object.create((target_class as any).prototype);
    Object.assign(dataobj, JSON.parse(data));
    const txn = await client.updateTxn(package_owner, dataobj);
    const ptxn = await client.signAndsubmitOrmTxn([package_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
    const objects = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: target_class });
    console.log(`updated objects:`, objects);
  });

program
  .command('delete')
  .description('Delete the target class object')
  .argument('<package_path>', 'The AptoORM package path and name')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .requiredOption('-c, --class <CLASS_NAME>', 'The class to be created e.g. -c BaseObject')
  .option('-a, --address <ADDRESS>', 'The address of the object to be updated')
  .action(async function () {
    const client = loadOrmClient(program);
    const { key } = this.opts();
    const class_name = this.opts()?.class;
    let package_path: string = this.args[0];
    const [_package_path, package_name] = checkPackagePath(package_path);
    package_path = _package_path;
    if (!key) {
      throw new Error(`key file not specified`);
    }
    const package_owner = loadAccountFromPrivatekeyFile(key);
    const ormclasses = await loadPackageClasses(package_name, package_path, [class_name]);
    if (ormclasses.length === 0) {
      throw new Error(`class '${class_name}' not found`);
    }
    if (ormclasses.length > 1) {
      throw new Error(`class '${class_name}' is ambiguous`);
    }
    const target_class = ormclasses[0];
    const txn = await client.deleteTxn(package_owner, { object: target_class, address: this.opts()?.address });
    const ptxn = await client.signAndsubmitOrmTxn([package_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
    const objects = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: target_class });
    console.log(`created objects:`, objects);
  });

program
  .command('transfer-by-force')
  .description('Transfer a target object using indirect transfer method')
  .requiredOption('-a, --address <ADDRESS>', 'The address of the object to transfer')
  .requiredOption('-t, --to <ADDRESS>', 'The address received the object')
  .requiredOption('-k, --key <key_file>', 'The private key file of the object owner or the creator')
  .action(async function () {
    const client = loadOrmClient(program);
    const { key, address, to } = this.opts();
    if (!key) {
      throw new Error(`key file not specified`);
    }
    const creator_or_owner = loadAccountFromPrivatekeyFile(key);
    const txn = await client.transferForciblyTxn(creator_or_owner, address, to);
    const ptxn = await client.signAndsubmitOrmTxn([creator_or_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
  });

program
  .command('set-royalty')
  .description('Change the royalty of the target object')
  .requiredOption('-a, --address <ADDRESS>', 'The address of the object to update')
  .requiredOption('-p, --payee <ADDRESS>', 'The address received the object')
  .requiredOption('  , --numerator <NUMBER>', 'The numerator of the royalty', '5')
  .requiredOption('  , --denominator <NUMBER>', 'The denominator of the royalty', '100')
  .requiredOption('-k, --key <key_file>', 'The private key file of the object owner or the creator')
  .action(async function () {
    const client = loadOrmClient(program);
    const { key, address, payee, denominator, numerator } = this.opts();
    if (!key) {
      throw new Error(`key file not specified`);
    }

    const creator_or_owner = loadAccountFromPrivatekeyFile(key);
    const txn = await client.setRoyaltyTxn(creator_or_owner, address, payee, denominator, numerator);
    const ptxn = await client.signAndsubmitOrmTxn([creator_or_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(`txn: ${txnr.hash}`);
  });

program
  .command('batch-set-royalty')
  .description('Change the royalty of all the target objects')
  .requiredOption('-c, --collection <address>', 'The collection address')
  .requiredOption('-p, --payee <address>', 'The royalty payee address')
  .requiredOption('  , --denominator <denominator>', 'The denominator of the royalty', '100')
  .requiredOption('  , --numerator <numerator>', 'The numerator of the royalty', '5')
  .option('  , --offset <offset>', 'Offset to start from', '0')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .action(async function () {
    const client = loadOrmClient(program);
    const { key, collection, payee, denominator, numerator, offset } = this.optsWithGlobals();
    const owner = loadAccountFromPrivatekeyFile(key);
    const classAddr = getShortAddress(collection);
    const payeeAddr = getShortAddress(payee);

    let _offset = Number(offset);
    const limit = 100;
    do {
      const query = `query MyQuery {
        current_token_datas_v2(
          where: {collection_id: {_eq: "${classAddr}"}}
          order_by: {token_data_id: asc}
          limit: ${limit}
          offset: ${_offset}
        ) {
          token_data_id
        }
      }
      `;
      const r: any = await client.queryIndexer({
        query: {
          query,
        },
      });
      if (!r.current_token_datas_v2) break;
      const current_token_datas_v2: any[] = r.current_token_datas_v2;
      const tokenAddrs = current_token_datas_v2.map((t: any): string => String(t.token_data_id));
      console.log(`offset=${_offset}, tokenAddrs length: ${tokenAddrs.length}`);
      console.log(tokenAddrs);
      const txn = await client.generateOrmTxn([owner], {
        function: `${client.ormAddress}::orm_object::batch_set_royalty`,
        typeArguments: [],
        functionArguments: [tokenAddrs, payeeAddr, denominator, numerator],
      });
      const txnr = await client.signSubmitAndWaitOrmTxnWithResult([owner], txn);
      console.log(`offset=${_offset} ${txnr.hash}, ${txnr.success}`);
      if (r.current_token_datas_v2.length < limit) break;
      _offset += limit;
    } while (true);
  });

export const orm_class = new Command('class')
  .description('Update the fields of a AptoORM Class (Collection)')
  .argument('[set-uri|set-description]', 'Update the uri or description of a AptoORM Class (Collection)')
  .requiredOption('-k, --key <key_file>', 'The private key file of the package owner')
  .option('-p, --path <package_path>', 'The package path')
  .option('-a, --address <ADDRESS>', 'The package address')
  .option('-c, --creator <ADDRESS>', 'The package creator')
  .option('-n, --name <PACKAGE_NAME>', 'The name of the package')
  .option('  , --class_address <CLASS_ADDRESS>', 'The class address to be updated')
  .option('  , --class_name <CLASS_NAME>', 'The class name included in the package')
  .requiredOption('-d, --data <uri|description>', 'The uri or description of the ORM Token class')
  .action(async function () {
    const client = loadOrmClient(this);
    const { key, class_address, class_name, data } = this.opts();
    let target_class_address = class_address;
    if (!class_address) {
      const [, , package_address] = loadPackageAddress(this);
      const resources = await client.getAccountResources({ accountAddress: package_address });
      for (const resource of resources) {
        if (resource.type.startsWith(`${client.ormAddress}::orm_module::OrmModule<`)) {
          const class_type = resource.type.split('<')[1].split('>')[0];
          const class_address = (resource?.data as any)?.class?.inner;
          if (class_type.includes(class_name)) {
            target_class_address = class_address;
            break;
          }
        }
      }
    }

    const package_owner = loadAccountFromPrivatekeyFile(key);
    const txn = await client.generateOrmTxn([package_owner], {
      function: `${client.ormAddress}::orm_class::${this.args[0] == 'set-uri' ? 'set_uri' : 'set_description'}`,
      typeArguments: [`0x1::object::ObjectCore`],
      functionArguments: [target_class_address, data],
    });
    const ptxn = await client.signAndsubmitOrmTxn([package_owner], txn);
    const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log(
      YAML.stringify({ result: { txn: txnr.hash, command: this.args[0], class_address: target_class_address } })
    );
  });

program.addCommand(poa);
program.addCommand(orm_class);
program.addCommand(retrieve);

async function main() {
  await program.parseAsync(process.argv);
}

main();
