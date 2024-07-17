import { describe, expect, test } from '@jest/globals';
import orm, { OrmField, snakeToCamel, OrmTokenFactory } from '../sdk';

import path from 'path';
import fs from 'fs';

const package_creator = orm.loadAccountFromPrivatekeyFile('../.key/user');
const package_name = 'apto_orm_company';
const module_name = 'asset_factory';
const package_move_path = path.join(__dirname, '.move/apto_orm_company');

// onchain function => create(name, uri, description, keys, types, values);
@OrmTokenFactory({
  package_creator,
  package_name,
  module_name,
  collection_name: 'My First Token',
  collection_uri: 'https://my-first-token.com',
  collection_description: 'They are my My First Tokens',
})
export class MyFirstToken {
  @OrmField({ type: 'string' })
  public name: string;
  @OrmField({ type: 'string' })
  public uri: string;
  @OrmField({ type: 'string' })
  public description: string;
  @OrmField({ type: 'u64' })
  public level!: number;
  @OrmField({ type: 'string' })
  public grade!: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  @OrmField({ type: 'string' })
  public comment!: string;
  @OrmField({ optional: true })
  public expire?: Date;

  '@meta'?: {
    cmd: 'soulbound' | 'named' | 'numbered';
    data?: string;
  }[];

  constructor(fields?: Partial<MyFirstToken>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof MyFirstToken];
      }
    }
  }
}

@OrmTokenFactory({
  package_creator,
  package_name,
  module_name,
  collection_name: 'My Second Token',
  collection_uri: 'https://my-second-token.com',
  collection_description: 'They are my My Second Tokens',
})
export class MySecondToken {
  @OrmField({ type: 'string' })
  name: string;
  @OrmField({ type: 'string' })
  uri: string;
  @OrmField({ type: 'string' })
  description: string;
  @OrmField({ type: 'u32' })
  seclevel!: number;

  constructor(fields?: Partial<MySecondToken>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof MySecondToken];
      }
    }
  }
}

@OrmTokenFactory({
  package_creator,
  package_name,
  module_name,
  collection_name: 'My Second Token',
  collection_uri: 'https://my-second-token.com',
  collection_description: 'They are my My Second Tokens',
})
export class MyCopyToken {
  @OrmField({ type: 'string' })
  name: string;
  @OrmField({ type: 'string' })
  uri: string;
  @OrmField({ type: 'string' })
  description: string;
  @OrmField({ type: 'u32' })
  seclevel!: number;

  constructor(fields?: Partial<MyCopyToken>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof MyCopyToken];
      }
    }
  }
}

export class MyXToken extends MySecondToken {
  constructor() {
    const name = 'Gold & Diamonds Bundle';
    const uri = 'https://public.vir.supervlabs.io/virweb/nft/items/package_smarter.png';
    const description =
      'A special package containing valuable Gold and Diamond items for use in the Supervillain Wanted game.';
    super({
      name,
      uri,
      description,
      seclevel: 99,
    });
  }
}

describe('Orm Token Factory', () => {
  test('Test to define, generate, compile, publish and create AptoORM Token Factory', async () => {
    const to = orm.createAccount();
    const client = new orm.OrmClient('local');
    const package_config: orm.OrmPackageConfig = {
      package_creator: package_creator,
      package_name,
      package_move_path,
      ormobjs: [MyFirstToken, MySecondToken],
      local_apto_orm_package: path.join(__dirname, '../../../move/apto_orm'),
    };

    orm.generatePackage(package_config);
    expect(fs.existsSync(`${package_move_path}/sources/${module_name}.move`)).toBe(true);
    orm.compilePackage(package_config);
    expect(fs.existsSync(`${package_move_path}/build/${snakeToCamel(package_name, true)}/package-metadata.bcs`)).toBe(
      true
    );
    const txns = await orm.publishPackageTxns(client, package_creator, package_config);
    const txnrs = await client.signSubmitAndWaitOrmTxnsWithResult(
      [package_creator],
      txns,
      {},
      { timeoutSecs: 30, checkSuccess: true }
    );
    for (const txnr of txnrs) {
      console.log('publishPackageTxns', txnr.hash);
    }
    const token1 = new MyFirstToken({
      name: 'First Joker',
      uri: 'https://my-first-token/joker',
      description: 'Joker Token',
      level: 1,
      grade: 'epic',
      comment: 'He is a villain',
      '@meta': [
        {
          cmd: 'soulbound',
        },
      ],
    });

    let txn = await client.initializeTxn(package_creator, MyFirstToken);
    let ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    let txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('initializeTxn', txnr.hash);

    txn = await client.createTxn(package_creator, token1);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('createTxn', txnr.hash);
    const address = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: 'MyFirstToken' });
    console.log('MyFirstToken address', address);

    txn = await client.initializeTxn(package_creator, MySecondToken);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('initializeTxn', txnr.hash);

    const token2 = new MyXToken();
    // token2.name = 'Second Joker';
    // token2.uri = 'https://my-second-token/joker';
    // token2.description = 'Joker Token';
    // token2.seclevel = 100;
    txn = await client.createTxn(package_creator, token2);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('createTxn', txnr.hash);
    const addresses = client.retrieveOrmObjectAddressesFromTxnr(txnr, { object_type: MySecondToken });
    console.log('MySecondToken address', addresses);

    const tokens = [
      new MyFirstToken({
        name: 'First Joker 1',
        uri: 'https://my-first-token/joker',
        description: 'Joker Token',
        level: 1,
        grade: 'epic',
        comment: 'He is a villain',
        expire: new Date(),
        '@meta': [
          {
            cmd: 'soulbound',
          },
        ],
      }),
      new MyFirstToken({
        name: 'First Joker 1x',
        uri: 'https://my-first-token/joker',
        description: 'Joker Token',
        level: 2,
        grade: 'epic',
        comment: 'He is a villain',
        expire: new Date(),
      }),
      new MySecondToken({
        name: 'Second Joker 1',
        uri: 'https://my-second-token/joker',
        description: 'Joker Token',
        seclevel: 99,
      }),
      new MyXToken(),
    ];

    txn = await client.batchCreateToTxn(package_creator, tokens, to.accountAddress);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('batchCreateToTxn', txnr.hash);

    const batched_addresses = client.retrieveOrmObjectAddressesFromTxnr(txnr, { object_type: MySecondToken });
    console.log(batched_addresses);
    // const deleting_tokens = batched_addresses.map((address) => {
    //   return {
    //     address,
    //     object: MySecondToken,
    //   };
    // });
    // txn = await client.batchDeleteTxn(package_creator, deleting_tokens);
    // ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    // txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    // console.log('deleteTxn', txnr.hash);
    // const deleted_addresses = client.retrieveOrmObjectAddressesFromTxnr(txnr, { event_type: 'deleted' });
    // expect(deleted_addresses).toEqual(batched_addresses);
  });
});
