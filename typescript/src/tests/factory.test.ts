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
  collection_name: 'Villains',
  collection_uri: 'https://villains.com',
  collection_description: 'Villains Tokens',
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
  @OrmField()
  public expire?: Date;
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
  collection_name: 'Villains2',
  collection_uri: 'https://villains2.com',
  collection_description: 'Villains2 Tokens',
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
  
  constructor(fields?: Partial<MyFirstToken>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof MyFirstToken];
      }
    }
  }
}

describe('Orm Token Factory', () => {
  test('Test to define, generate, compile, publish and create AptoORM Token Factory', async () => {
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
      name: 'Joker',
      uri: 'https://villains.com/joker',
      description: 'Joker Token',
      level: 1,
      grade: 'common',
      comment: 'He is a villain',
      expire: new Date(),
    });

    // const my_hero_token: MyHeroToken = new MyHeroToken();
    // my_hero_token.name = `MyHeroToken ${Math.floor(Math.random() * 1000000)}`;
    // my_hero_token.uri = 'https://example.com/my_hero_token/silver';
    // my_hero_token.description = 'ORM Silver MyHeroToken';
    // my_hero_token.level = 100;
    // my_hero_token.grade = 'epic';
    // my_hero_token.comment = 'This is a comment';
    let txn = await client.createTxn(package_creator, token1);
    let ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    let txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('createTxn', txnr.hash);
    // const address = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: 'MyHeroToken' });

    // console.log('myhero address', address);

    // const myhero = await client.getObject<MyHeroToken>(my_hero_token, true);
    // console.log('myhero address', myhero[object_addr]?.toString());

    // txn = await client.deleteTxn(package_creator, my_hero_token);
    // ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    // txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });

    // expect(client.retrieveOrmObjectAddressFromTxnr(txnr, { event_type: 'deleted' })).toBe(address);
    // console.log('deleteTxn', txnr.hash);
  });
});
