import { describe, beforeEach, afterEach, expect, it } from '@jest/globals';
import orm, { OrmClass, OrmTokenClass, OrmField, OrmIndexField, snakeToCamel } from '../sdk';
import path from 'path';
import fs from 'fs';

const package_name = 'rng';
const package_creator = orm.loadAccountFromPrivatekeyFile('../.key/user');
const package_move_path = path.join(__dirname, '.move/rng');

@OrmTokenClass({
  package_name,
  package_creator,
  collection_name: '[FIXME] SuperV Pet Ticket',
  collection_uri:
    'https://e7.pngegg.com/pngimages/841/89/png-clipart-ticket-admit-one-cinema-ticket-miscellaneous-text.png',
  collection_description: '[FIXME] collection description',
  token_use_property_map: true,
  royalty_present: true,
  royalty_payee: package_creator.accountAddress,
  royalty_denominator: 100,
  royalty_numerator: 5,
})
export class PetTicket {
  // Issue PetTicket token with creator's address + :: + collection name + :: + token name for each NFT holder
  // Issue PetTicket token with email for social media campaign
  @OrmIndexField({ immutable: true, type: 'string' })
  origin!: string;

  @OrmField({ immutable: true })
  name!: string;

  @OrmField({
    constant:
      'https://e7.pngegg.com/pngimages/841/89/png-clipart-ticket-admit-one-cinema-ticket-miscellaneous-text.png',
  })
  uri!: string;

  @OrmField({ constant: '[FIXME] Pet Ticket description' })
  description!: string;

  @OrmField({ token_property: true, type: 'address' })
  derived_from!: string;
}

@OrmClass({
  package_name,
  package_creator,
})
export class GachaItem {
  @OrmIndexField({ immutable: true })
  group!: string;

  @OrmIndexField({ immutable: true })
  index!: number;

  @OrmField({ type: 'String' })
  name!: string;

  @OrmField({ type: 'String' })
  uri!: string;

  @OrmField({ type: 'String' })
  description!: string;

  @OrmField({ type: 'u64', timestamp: true })
  updated_at: Date;

  @OrmField({ type: 'vector<string::String>' })
  property_keys!: string[];

  @OrmField({ type: 'vector<string::String>' })
  property_types!: string[];

  @OrmField({ type: 'vector<vector<u8>>' })
  property_values!: any[];

  constructor(fields?: Partial<GachaItem>) {
    if (fields) {
      for (const key in fields) {
        (this as any)[key] = fields[key as keyof GachaItem];
      }
    }
  }
}

@OrmTokenClass({
  package_name,
  package_creator,
  collection_name: '[FIXME] AptoORM Pet',
  collection_uri:
    'https://e7.pngegg.com/pngimages/787/426/png-clipart-recycling-symbol-polyethylene-terephthalate-pet-bottle-recycling-recycling-codes-symbol-miscellaneous-angle.png',
  collection_description: '[FIXME] Pet token for AptoORM users',
  numbered_token: true,
  token_use_property_map: true,
  royalty_present: true,
  royalty_payee: package_creator.accountAddress,
  royalty_denominator: 100,
  royalty_numerator: 5,
})
export class Pet {
  @OrmField({  })
  name!: string;

  @OrmField({ constant: 'https://raw.githubusercontent.com/neoul/apto_orm/main/resource.png' })
  uri!: string;

  @OrmField({ constant: '[FIXME] The description of the token' })
  description!: string;

  @OrmField({ token_property: true })
  grade!: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

  @OrmField({ token_property: true, type: 'address' })
  pet_ticket!: string;

  @OrmField({ type: 'u64', timestamp: true })
  updated_at: Date;

  @OrmField({ type: 'u64' })
  salt: bigint;
}

describe('AptoORM Object', () => {
  beforeEach(() => {});

  afterEach(() => {});

  it('Test to define, generate, compile, publish and create AptoORM Object', async () => {
    const client = new orm.OrmClient('local');

    // 1. create an package account
    let txn = await orm.createPackageTxn(client, package_creator, package_name);
    let txnr = await client.signSubmitAndWaitOrmTxnWithResult([package_creator], txn);
    console.log('createPackageTxn', txnr.hash);

    // 2. create an package
    const package_config: orm.OrmPackageConfig = {
      package_creator: package_creator,
      package_name,
      package_move_path,
      ormobjs: [PetTicket, GachaItem, Pet],
      local_apto_orm_package: path.join(__dirname, '../../../move/apto_orm'),
    };
    orm.generatePackage(package_config);
    expect(fs.existsSync(`${package_move_path}/sources/gacha_item.move`)).toBe(true);
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
    const a = new Pet();
    a.name = 'first pet';
    a.uri = 'https://super.pet/first_pet.png';
    a.description = 'first pet description';
    a.grade = 'common';
    a.pet_ticket = '0x1';
    a.salt = BigInt(0);
    
    // const b: GachaItem = new GachaItem({
    //   title: '2th title',
    //   body: '2th description',
    //   updated_at: new Date(),
    //   like: 1,
    // });
    // expect(b.title).toBe('2th title');

    // const classAddr = orm.getClassAddress(GachaItem).toString();
    // expect(classAddr).toBeDefined();
    // expect(orm.getClassAddress(a).toString()).toBe(classAddr);
    // expect(orm.getClassAddress('GachaItem').toString()).toBe(classAddr);

    // const c: GachaItem = new GachaItem({
    //   title: '3th title',
    //   body: '3th description',
    //   updated_at: new Date(),
    //   like: 1,
    // });
    // expect(c.title).toBe('3th title');

    // 4. create the objects to onchain
    txn = await client.createTxn(package_creator, a);
    let ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, { timeoutSecs: 30, checkSuccess: true });
    const a_address = client.retrieveOrmObjectAddressFromTxnr(txnr);
    console.log('createTxn', txnr.hash);
    console.log('retrieveOrmObjectAddressFromTxnr', a_address);
    expect(async () => {
      await client.getObject({ object: Pet, address: a_address }, true);
    }).not.toThrow();

    // 5. update the objects
    a.grade = 'epic';
    a.name = 'what?';
    txn = await client.updateTxn(package_creator, { object: a, address: a_address });
    ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    txnr = await client.waitForOrmTxnWithResult(ptxn, {
      timeoutSecs: 30,
      checkSuccess: true,
    });
    console.log('updateTxn', txnr.hash);

    // txn = await client.createTxn(package_creator, b);
    // ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    // txnr = await client.waitForOrmTxnWithResult(ptxn);
    // const b_address = client.retrieveOrmObjectAddressFromTxnr(txnr, { object_type: GachaItem });
    // console.log('createTxn', txnr.hash);
    // console.log('retrieveOrmObjectAddressFromTxnr', b_address);
    // expect(async () => {
    //   await client.getObject({ object: GachaItem, address: b_address }, true);
    // }).not.toThrow();

    // txn = await client.createToTxn(package_creator, c, '0xffff');
    // ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    // txnr = await client.waitForOrmTxnWithResult(ptxn);
    // const c_address = client.retrieveOrmObjectAddressFromTxnr(txnr, { change_type: 'write_resource' });
    // console.log('createToTxn', txnr.hash);
    // console.log('retrieveOrmObjectAddressFromTxnr', c_address);
    // expect(async () => {
    //   await client.getObject({ object: GachaItem, address: c_address }, true);
    // }).not.toThrow();



    // // 6. delete the objects
    // // To delete an object, you need to specify the object type and address.
    // txn = await client.deleteTxn(package_creator, {
    //   object: a,
    //   address: a_address,
    // });
    // ptxn = await client.signAndsubmitOrmTxn([package_creator], txn);
    // txnr = await client.waitForOrmTxnWithResult(ptxn, {
    //   timeoutSecs: 30,
    //   checkSuccess: true,
    // });
    // console.log('deleteTxn', txnr.hash);
  });
});
