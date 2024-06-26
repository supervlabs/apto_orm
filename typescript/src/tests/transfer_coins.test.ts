import { describe, expect, test } from '@jest/globals';
import orm, { OrmTokenClass, OrmField, OrmIndexField, snakeToCamel, sleep, debug } from '../sdk';
import path from 'path';
import fs from 'fs';

const package_name = 'orm_token_test';
const package_creator = orm.loadAccountFromPrivatekeyFile('../.key/user');
const package_move_path = path.join(__dirname, '.move/orm_token_test');

@OrmTokenClass({
  package_name,
  package_creator,
  index_fields: ['id'],
  collection_name: 'AptoORM Membership',
  collection_uri: 'https://raw.githubusercontent.com/neoul/apto_orm/main/resource.png',
  collection_description: 'Membership token for AptoORM users 111',
  max_supply: 1000n,
  token_use_property_map: false,
  royalty_present: true,
  royalty_denominator: 100,
  royalty_numerator: 5,
})
export class Membership {
  @OrmIndexField({ immutable: true })
  id!: number;

  @OrmField({ immutable: true })
  name!: string;

  @OrmField({ constant: 'https://raw.githubusercontent.com/neoul/apto_orm/main/resource.png' })
  uri!: string;

  @OrmField({ constant: 'The description of the token' })
  description!: string;
}

describe('AptoORM Token', () => {
  test('Test to define, generate, compile, publish and create AptoORM Token', async () => {
    const client = new orm.OrmClient({ fullnode: 'http://localhost:8080/v1' });
    const package_config: orm.OrmPackageConfig = {
      package_creator: package_creator,
      package_name,
      package_move_path,
      ormobjs: [Membership],
      local_apto_orm_package: path.join(__dirname, '../../../move/apto_orm'),
    };

    orm.generatePackage(package_config);
    expect(fs.existsSync(`${package_move_path}/sources/membership.move`)).toBe(true);
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

    {
      const txn = await client.updateModuleTxn(package_creator, Membership);
      const ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
      const txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
      console.log('updateModuleTxn', txnr.hash);
    }

    const membership: Membership = new Membership();
    membership.id = Math.floor(Math.random() * 1000000);
    membership.name = 'ORM Silver Membership';
    membership.uri = 'https://example.com/membership/silver';
    membership.description = 'ORM Silver Membership';

    const classAddr = orm.getClassAddress(Membership).toString();
    expect(classAddr).toBeDefined();
    expect(orm.getClassAddress(membership).toString()).toBe(classAddr);
    expect(orm.getClassAddress('Membership').toString()).toBe(classAddr);

    let txn = await client.createTxn(package_creator, membership);
    let ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    let txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('createTxn', txnr.hash);
    const membership_address = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: 'Membership' });

    txn = await client.transferForciblyTxn(package_creator, membership, '0x0');
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    console.log('transferForciblyTxn', txnr.hash);

    console.log('membership_address', membership_address);

    // check transfer_coins (crm class; collection)
    {
      const class_addr = orm.getClassAddress(Membership).toString();
      let txn = await client.transferCoinsTxn(package_creator, class_addr, 100000000);
      let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      txn = await client.transferCoinsFromObjectTxn(
        package_creator,
        class_addr,
        package_creator.accountAddress,
        100000000
      );
      txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      console.log('transfer_coins (crm class; collection)', txnr.hash);
    }

    // check transfer_coins (orm creator)
    {
      const class_addr = orm.getPackageAddress(package_creator, package_name).toString();
      let txn = await client.transferCoinsTxn(package_creator, class_addr, 100000000);
      let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      txn = await client.transferCoinsFromObjectTxn(
        package_creator,
        class_addr,
        package_creator.accountAddress,
        100000000
      );
      txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      console.log('transfer_coins (orm creator)', txnr.hash);
    }

    // check transfer_coins (orm object)
    {
      const obj_addr = membership_address;
      let txn = await client.transferCoinsTxn(package_creator, obj_addr, 100000000);
      let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      txn = await client.transferCoinsFromObjectTxn(
        package_creator,
        obj_addr,
        package_creator.accountAddress,
        100000000
      );
      txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      console.log('transfer_coins (orm object)', txnr.hash);
    }


    // check royalty in collection
    {
      const class_addr = orm.getClassAddress(Membership).toString();
      let txn = await client.setRoyaltyTxn(package_creator, class_addr, '0x1', 100, 10);
      let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      console.log('setRoyaltyTxn', txnr.hash);
      const resource = await client.getAccountResource({
        accountAddress: class_addr,
        resourceType: '0x4::royalty::Royalty',
      });
      expect(resource.numerator).toBe('10');
      expect(resource.denominator).toBe('100');
      expect(resource.payee_address).toBe('0x1');
    }

    // check royalty in token
    {
      const object_addr = membership_address;
      let txn = await client.setRoyaltyTxn(package_creator, object_addr, '0x2', 88, 18);
      let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
      console.log('setRoyaltyTxn(token)', txnr.hash);
      const resource = await client.getAccountResource({
        accountAddress: object_addr,
        resourceType: '0x4::royalty::Royalty',
      });
      console.log('resource', resource);
      expect(resource.numerator).toBe('18');
      expect(resource.denominator).toBe('88');
      expect(resource.payee_address).toBe('0x2');
    }
  });
});
