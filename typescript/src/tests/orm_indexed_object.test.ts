import { describe, beforeEach, afterEach, expect, it } from '@jest/globals';
import orm, { OrmClass, OrmField, OrmIndexField, snakeToCamel } from '../sdk';
import path from 'path';
import fs from 'fs';
import { AptosConfig, Network } from '@aptos-labs/ts-sdk';

const package_name = 'indexed_object_test';
const package_creator = orm.loadAccountFromPrivatekeyFile('../.key/user');
const package_move_path = path.join(__dirname, '.move/indexed_object_test');

@OrmClass({
  package_name,
  package_creator,
  deletable_by_owner: true,
})
export class Board {
  @OrmIndexField()
  id!: number;

  @OrmField({ type: 'String' })
  title!: string;

  @OrmField({ name: 'content', type: 'String' })
  body!: string;

  @OrmField({ type: 'u64', timestamp: true })
  updated_at: Date;

  @OrmField({ type: 'u32' })
  like!: number;

  constructor(fields?: Partial<Board>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof Board];
      }
    }
  }
}

describe('AptoORM Object', () => {
  beforeEach(() => {});

  afterEach(() => {});

  it('Test to define, generate, compile, publish and create AptoORM Object', async () => {
    const config = new AptosConfig({ network: Network.LOCAL });
    const client = new orm.OrmClient(config);

    // 1. create an package account
    let txn = await orm.createPackageTxn(client, package_creator, package_name);
    let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
    console.log('createPackageTxn', txnr.hash);

    // 2. create an package
    const package_config: orm.OrmPackageConfig = {
      package_creator: package_creator,
      package_name,
      package_move_path,
      ormobjs: [Board],
      local_apto_orm_package: path.join(__dirname, '../../../move/apto_orm'),
    };
    orm.generatePackage(package_config);
    expect(fs.existsSync(`${package_move_path}/sources/board.move`)).toBe(true);
    orm.compilePackage({ package_move_path });
    expect(fs.existsSync(`${package_move_path}/build/${snakeToCamel(package_name, true)}/package-metadata.bcs`)).toBe(
      true
    );
    const txns = await orm.publishPackageTxns(client, package_creator, package_config);
    const txnrs = await client.signSubmitAndWaitOrmTxnsWithResult([package_creator], txns);
    for (const txnr of txnrs) {
      console.log('publishPackageTxns', txnr.hash);
    }
    const package_address = orm.getPackageAddress(package_creator.accountAddress, package_name);
    console.log(`package published to ${package_address.toString()}`);

    // 3. create objects
    const a = new Board();
    a.id = Math.floor(Math.random() * 1000000);
    a.title = 'First board title';
    a.body = 'First board description';
    a.like = 10;
    expect(a.title).toBe('First board title');

    const b: Board = new Board({
      id: Math.floor(Math.random() * 1000000),
      title: '2th title',
      body: '2th description',
      updated_at: new Date(),
      like: 1,
    });
    expect(b.title).toBe('2th title');

    const c: Board = new Board({
      id: Math.floor(Math.random() * 1000000),
      title: '3th title',
      body: '3th description',
      updated_at: new Date(),
      like: 1,
    });
    expect(c.title).toBe('3th title');

    // 4. create the objects to onchain
    txn = await client.createTxn(package_creator, a);
    let ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    const a_address = client.retrieveOrmObjectAddressFromTxnr(txnr);
    console.log('createTxn', txnr.hash);
    console.log('retrieveOrmObjectAddressFromTxnr', a_address);
    expect(async () => {
      await client.getObject({ object: Board, address: a_address }, true);
    }).not.toThrow();

    txn = await client.createTxn(package_creator, b);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn);
    const b_address = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: Board });
    console.log('createTxn', txnr.hash);
    console.log('retrieveOrmObjectAddressFromTxnr', b_address);
    expect(async () => {
      await client.getObject({ object: Board, address: b_address }, true);
    }).not.toThrow();

    txn = await client.createToTxn(package_creator, c, '0xffff');
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn);
    const c_address = client.retrieveOrmObjectAddressFromTxnr(txnr, { change_type: 'write_resource' });
    console.log('createToTxn', txnr.hash);
    console.log('retrieveOrmObjectAddressFromTxnr', c_address);
    expect(async () => {
      await client.getObject({ object: Board, address: c_address }, true);
    }).not.toThrow();

    // 5. update the objects
    a.like = 100;
    a.body = 'First board description updated';
    txn = await client.updateTxn(package_creator, { object: a, address: a_address });
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, {
      timeoutSecs: 30,
      checkSuccess: true,
    });
    console.log('updateTxn', txnr.hash);

    // 6. delete the objects
    txn = await client.deleteTxn(package_creator, a);
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, {
      timeoutSecs: 30,
      checkSuccess: true,
    });
    console.log('deleteTxn', txnr.hash);
  });
});
