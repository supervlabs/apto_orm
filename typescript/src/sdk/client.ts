import {
  Aptos,
  AptosConfig,
  Network,
  AccountAddress,
  AccountAddressInput,
  HexInput,
  Account,
  AnyRawTransaction,
  AccountAuthenticator,
  AptosSettings,
  MoveFunctionId,
} from '@aptos-labs/ts-sdk';
import {
  toAddress,
  getOrmAddress,
  loadOrmClassMetadata,
  setOrmObjectAddress,
  toPrimitiveType,
  getOrmObjectAddress,
  isSignable,
  OrmField2TokenProperty,
  ensureAddressString,
  isInstanceOf,
} from './utilities';
import {
  OrmTxn,
  OrmTxnOptions,
  PendingTransaction,
  OrmFunctionPayload,
  ObjectLiteral,
  OrmObjectTarget,
  ClassType,
  OrmClassMetadata,
  ObjectAddressable,
  ClassName,
  OrmObjectWithAddress,
} from './types';
import { getOrmClassMetadata } from './metadata';

export class OrmClient extends Aptos {
  readonly '@instanceof' = Symbol.for('OrmClient');
  private _ORM_ADDRESS: string;
  private _ORM_EVENT_TYPE: string;
  private _ORM_OBJECT_TYPE: string;
  constructor(config: AptosSettings);
  constructor(config: AptosConfig);
  constructor(config: string);
  constructor(config: AptosConfig | AptosSettings | string) {
    let _config: AptosConfig;
    if (config instanceof AptosConfig || isInstanceOf(config, 'AptosConfig')) {
      _config = config as AptosConfig;
    } else if (typeof config === 'string') {
      const lowcase = config.toLowerCase();
      if (lowcase === 'testnet') {
        _config = new AptosConfig({ network: Network.TESTNET });
      } else if (lowcase === 'mainnet') {
        _config = new AptosConfig({ network: Network.MAINNET });
      } else if (lowcase === 'devnet') {
        _config = new AptosConfig({ network: Network.DEVNET });
      } else if (lowcase === 'local') {
        _config = new AptosConfig({ network: Network.LOCAL });
      } else {
        throw new Error('Target network or config is not defined');
      }
    } else if (typeof config === 'object') {
      _config = new AptosConfig(config);
    }
    if (_config === undefined) {
      throw new Error('Target network or config is not defined');
    }
    super(_config);
    this._ORM_ADDRESS = getOrmAddress();
    this._ORM_EVENT_TYPE = `${this._ORM_ADDRESS}::orm_class::OrmEvent`;
    this._ORM_OBJECT_TYPE = `${this._ORM_ADDRESS}::orm_object::OrmObject`;
  }

  private static check(obj: unknown, name: string) {
    return (
      typeof obj === 'object' && obj !== null && (obj as { '@instanceof': symbol })['@instanceof'] === Symbol.for(name)
    );
  }

  get ormAddress() {
    return this._ORM_ADDRESS;
  }

  set ormAddress(address: AccountAddressInput) {
    this._ORM_ADDRESS = toAddress(address).toString();
  }

  get ormEventType() {
    return this._ORM_EVENT_TYPE;
  }

  async getAccountSequenceNumber(address: AccountAddressInput) {
    const data = await this.account.getAccountInfo({ accountAddress: address });
    return BigInt(data.sequence_number);
  }

  async generateOrmTxn(
    signers: (Account | AccountAddressInput)[],
    payload: OrmFunctionPayload,
    options?: OrmTxnOptions
  ): Promise<OrmTxn> {
    if (signers.length === 0) {
      throw new Error('No signers provided');
    }
    const [sender, ...others] = signers;
    const sender_address = toAddress(signers[0]);
    const auths: (AccountAuthenticator | null)[] = [];
    let payer_auth: AccountAuthenticator;
    let type: 'simple' | 'multiAgent';
    let txn: AnyRawTransaction;
    if (signers.length == 1) {
      type = 'simple';
      txn = await this.transaction.build.simple({
        sender: sender_address,
        data: payload,
        options: options,
        withFeePayer: options?.payer ? true : false,
      });
      if (isSignable(sender)) {
        auths.push(this.transaction.sign({ signer: sender, transaction: txn }));
      } else {
        auths.push(null);
      }
    } else {
      type = 'multiAgent';
      txn = await this.transaction.build.multiAgent({
        sender: sender_address,
        secondarySignerAddresses: others.map((o) => toAddress(o)),
        data: payload,
        options: options,
        withFeePayer: options?.payer ? true : false,
      });
      signers.forEach((s) => {
        if (isSignable(s)) {
          auths.push(this.transaction.sign({ signer: s, transaction: txn }));
        } else {
          auths.push(null);
        }
      });
    }
    if (options?.payer) {
      const p = options.payer;
      if (isSignable(p)) {
        payer_auth = this.transaction.signAsFeePayer({ signer: p, transaction: txn });
      }
    }
    return { type, txn, auths, payer_auth };
  }

  async signOrmTxn(signers: (Account | AccountAddressInput)[], ormtxn: OrmTxn, options?: Pick<OrmTxnOptions, 'payer'>) {
    const auths = ormtxn.auths;
    for (let i = 0; i < auths.length; i++) {
      if (auths[i]) continue;
      if (signers.length <= i) continue;
      const s = signers[i];
      if (isSignable(s)) {
        auths[i] = this.transaction.sign({ signer: s, transaction: ormtxn.txn });
      }
    }
    if (options?.payer) {
      const p = options.payer;
      if (isSignable(p)) {
        ormtxn.payer_auth = this.transaction.signAsFeePayer({ signer: p, transaction: ormtxn.txn });
      }
    }
    return ormtxn;
  }

  async submitOrmTxn(ormtxn: OrmTxn): Promise<PendingTransaction> {
    const [sender, ...others] = ormtxn.auths;
    if (!sender) {
      throw new Error(`sender signature missing`);
    }
    for (const auth of others) {
      if (!auth) throw new Error(`secondary signature missing`);
    }
    switch (ormtxn.type) {
      case 'simple':
        return await this.transaction.submit.simple({
          transaction: ormtxn.txn,
          senderAuthenticator: sender,
          feePayerAuthenticator: ormtxn.payer_auth,
        });
      case 'multiAgent':
        return await this.transaction.submit.multiAgent({
          transaction: ormtxn.txn,
          senderAuthenticator: sender,
          additionalSignersAuthenticators: others,
          feePayerAuthenticator: ormtxn.payer_auth,
        });
      default:
        throw new Error(`unknown txn type ${ormtxn.type}`);
    }
  }

  async waitForOrmTxnWithResult(
    pending: { hash: HexInput },
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await this.transaction.waitForTransaction({ transactionHash: pending.hash, ...extrargs });
  }

  async waitForOrmTxnsWithResult(
    pendings: { hash: HexInput }[],
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await Promise.all(
      pendings.map(async (pending) => {
        return await this.transaction.waitForTransaction({ transactionHash: pending.hash, ...extrargs });
      })
    );
  }

  async signAndsubmitOrmTxn(
    signers: (Account | AccountAddressInput)[],
    ormtxn: OrmTxn,
    options?: Pick<OrmTxnOptions, 'payer'>
  ) {
    const signed = await this.signOrmTxn(signers, ormtxn, options);
    return await this.submitOrmTxn(signed);
  }

  async signAndsubmitOrmTxns(
    signers: (Account | AccountAddressInput)[],
    ormtxns: OrmTxn[],
    options?: Pick<OrmTxnOptions, 'payer'>
  ) {
    return await Promise.all(
      ormtxns.map(async (ormtxn) => {
        const signed = await this.signOrmTxn(signers, ormtxn, options);
        return await this.submitOrmTxn(signed);
      })
    );
  }

  async waitForOrmTxn(
    pending: { hash: string },
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await this.waitForTransaction({ transactionHash: pending.hash, ...extrargs });
  }

  async waitForOrmTxns(
    pendings: { hash: string }[],
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await Promise.all(
      pendings.map(async (pending) => {
        return await this.waitForTransaction({ transactionHash: pending.hash, ...extrargs });
      })
    );
  }

  async signSubmitAndWaitOrmTxn(
    signers: (Account | AccountAddressInput)[],
    ormtxn: OrmTxn,
    options?: Pick<OrmTxnOptions, 'payer'>,
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    const signed = await this.signOrmTxn(signers, ormtxn, options);
    const ptxn = await this.submitOrmTxn(signed);
    await this.waitForOrmTxn(ptxn, extrargs);
    return ptxn;
  }

  async signSubmitAndWaitOrmTxns(
    signers: (Account | AccountAddressInput)[],
    ormtxns: OrmTxn[],
    options?: Pick<OrmTxnOptions, 'payer'>,
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await Promise.all(
      ormtxns.map(async (ormtxn) => {
        const signed = await this.signOrmTxn(signers, ormtxn, options);
        const ptxn = await this.submitOrmTxn(signed);
        await this.waitForOrmTxn(ptxn, extrargs);
        return ptxn;
      })
    );
  }

  async signSubmitAndWaitOrmTxnWithResult(
    signers: (Account | AccountAddressInput)[],
    ormtxn: OrmTxn,
    options?: Pick<OrmTxnOptions, 'payer'>,
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    const signed = await this.signOrmTxn(signers, ormtxn, options);
    const ptxn = await this.submitOrmTxn(signed);
    return await this.waitForOrmTxnWithResult(ptxn, extrargs);
  }

  async signSubmitAndWaitOrmTxnsWithResult(
    signers: (Account | AccountAddressInput)[],
    ormtxns: OrmTxn[],
    options?: Pick<OrmTxnOptions, 'payer'>,
    extrargs?: {
      timeoutSecs?: number;
      checkSuccess?: boolean;
    }
  ) {
    return await Promise.all(
      ormtxns.map(async (ormtxn) => {
        const signed = await this.signOrmTxn(signers, ormtxn, options);
        const ptxn = await this.submitOrmTxn(signed);
        return await this.waitForOrmTxnWithResult(ptxn, extrargs);
      })
    );
  }

  initializeTxnPayload<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
    const { metadata } = loadOrmClassMetadata(obj);
    if (!metadata?.factory) {
      throw new Error(`object does not need to be initialized`);
    }
    const args: any[] = [];
    const type_args: string[] = [];
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    args.push(metadata.token_config.collection_name);
    args.push(metadata.token_config.collection_uri);
    args.push(metadata.token_config.collection_description);
    args.push(metadata.token_config.max_supply);
    args.push(metadata.token_config.royalty_present);
    args.push(ensureAddressString(metadata.token_config.royalty_payee));
    args.push(metadata.token_config.royalty_denominator);
    args.push(metadata.token_config.royalty_numerator);
    args.push(metadata.direct_transfer);
    args.push(metadata.deletable_by_creator);
    args.push(metadata.deletable_by_owner);
    args.push(metadata.indirect_transfer_by_creator);
    args.push(metadata.indirect_transfer_by_owner);
    args.push(metadata.extensible_by_creator);
    args.push(metadata.extensible_by_owner);
    args.push([]); // metacmds
    args.push([]); // metadata
    return {
      function: `${metadata.package_address}::${metadata.module_name}::initialize`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async initializeTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.initializeTxnPayload(obj), options);
  }

  private buildCreateTxnArguments(object: ObjectLiteral | ObjectAddressable, metadata: OrmClassMetadata) {
    const fields = metadata.fields;
    const args: any[] = [];
    if (!metadata.factory) {
      throw new Error(`build create txn arguments does not support non-factory object`);
    }
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    args.push(metadata.token_config.collection_name);
    const property_key: string[] = [];
    const property_type: string[] = [];
    const property_values: any[] = [];
    const mcmds: string[] = [];
    const mdata: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      let value: any;
      if (field.constant) {
        value = field.constant;
      } else if (field.timestamp) {
        value = new Date();
      } else {
        value = object[field.property_key];
      }
      if (value === undefined) {
        if (field.default) {
          value = field.default;
        } else if (field.optional) {
          continue;
        } else {
          throw new Error(`OrmField '${field.property_key}' is not defined`);
        }
      }
      if (field.token_field) {
        args.push(value);
      } else if (field.token_property) {
        const [k, t, v] = OrmField2TokenProperty(field, value);
        property_key.push(k);
        property_type.push(t);
        property_values.push(v);
      }
    }
    if (object['@meta'] && Array.isArray(object['@meta'])) {
      for (const meta of object['@meta']) {
        mcmds.push(meta.cmd);
        mdata.push(meta.data ? meta.data : '');
      }
    }
    args.push(property_key);
    args.push(property_type);
    args.push(property_values);
    args.push(mcmds); // metacmds
    args.push(mdata); // metadata
    return args;
  }

  createTxnPayload<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>, to?: AccountAddressInput) {
    const { metadata, object } = loadOrmClassMetadata(obj);
    const args: any[] = [];
    const type_args: string[] = [];
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    if (metadata.factory) {
      args.push(...this.buildCreateTxnArguments(object, metadata));
    } else {
      metadata.fields.forEach((field) => {
        if (!field.writable) return;
        const value = object[field.property_key];
        if (value === undefined) {
          throw new Error(`OrmField '${field.property_key}' is not defined`);
        }
        args.push(object[field.property_key]);
      });
    }
    if (to) {
      args.push(ensureAddressString(to));
    }
    return {
      function: to
        ? `${metadata.package_address}::${metadata.module_name}::create_to`
        : `${metadata.package_address}::${metadata.module_name}::create`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  createToTxnPayload<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>, to: AccountAddressInput) {
    return this.createTxnPayload(obj, to);
  }

  async createTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.createTxnPayload(obj), options);
  }

  async createToTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    to: AccountAddressInput,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.createTxnPayload(obj, to), options);
  }

  batchCreateToTxnPayload(objs: OrmObjectTarget<ObjectLiteral>[], to: AccountAddressInput) {
    const args: any[] = [];
    const type_args: string[] = [];
    const collection_names: string[] = [];
    const names: string[] = [];
    const uris: string[] = [];
    const descriptions: string[] = [];
    const property_keys: string[][] = [];
    const property_types: string[][] = [];
    const property_values: any[][] = [];
    const metacmds: string[][] = [];
    const metadatas: string[][] = [];

    let package_address: string;
    let module_name: string;
    for (const obj of objs) {
      const { metadata, object } = loadOrmClassMetadata(obj);
      if (!metadata.factory) {
        throw new Error(`object is not factory object`);
      }
      if (!metadata.package_address) {
        throw new Error(`package address is not defined`);
      }
      if (!package_address) {
        package_address = metadata.package_address.toString();
      } else if (metadata.package_address.toString() !== package_address) {
        throw new Error(`different package objects are defined in the batch creation`);
      }
      if (!module_name) {
        module_name = metadata.module_name;
      } else if (module_name !== metadata.module_name) {
        throw new Error(`different module objects are defined in the batch creation`);
      }
      const each = this.buildCreateTxnArguments(object, metadata);
      collection_names.push(each[0]);
      names.push(each[1]);
      uris.push(each[2]);
      descriptions.push(each[3]);
      property_keys.push(each[4]);
      property_types.push(each[5]);
      property_values.push(each[6]);
      metacmds.push(each[7]);
      metadatas.push(each[8]);
    }
    args.push(collection_names);
    args.push(names);
    args.push(uris);
    args.push(descriptions);
    args.push(property_keys);
    args.push(property_types);
    args.push(property_values);
    args.push(metacmds); // metacmdslist
    args.push(metadatas); // metadatas
    args.push(to);
    return {
      function: `${package_address}::${module_name}::batch_create_to`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async batchCreateToTxn(
    user: Account | AccountAddressInput,
    objs: OrmObjectTarget<ObjectLiteral>[],
    to: AccountAddressInput,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.batchCreateToTxnPayload(objs, to), options);
  }

  updateTxnPayload<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
    const { address, metadata, object } = loadOrmClassMetadata(obj, true);
    const fields = metadata.fields;
    const args: any[] = [address];
    const type_args: string[] = [];
    fields.forEach((field) => {
      if (field.index || !field.writable || field.immutable) return;
      const value = object[field.property_key as keyof ObjectLiteral];
      if (value === undefined) {
        throw new Error(`OrmField '${field.property_key}' is not defined`);
      }
      args.push(object[field.property_key as keyof ObjectLiteral]);
    });
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    return {
      function: `${metadata.package_address}::${metadata.module_name}::update`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async updateTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.updateTxnPayload(obj), options);
  }

  deleteTxnPayload<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
    const { address, metadata } = loadOrmClassMetadata(obj, true);
    const args: any[] = [address];
    const type_args: string[] = [];
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    return {
      function: `${metadata.package_address}::${metadata.module_name}::delete`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async deleteTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.deleteTxnPayload(obj), options);
  }

  batchDeleteTxnPayload<OrmObject extends ObjectLiteral>(objsDeleted: OrmObjectWithAddress<OrmObject>[]) {
    const obj_addresses: string[] = [];
    const metacmdslist: string[][] = [];
    const metadatas: string[][] = [];
    let package_address: string;
    let module_name: string;
    for (const obj of objsDeleted) {
      const metadata = getOrmClassMetadata(obj.object);
      if (!metadata.factory) {
        throw new Error(`object is not factory object`);
      }
      if (!metadata.package_address) {
        throw new Error(`package address is not defined`);
      }
      if (!package_address) {
        package_address = metadata.package_address.toString();
      } else if (metadata.package_address.toString() !== package_address) {
        throw new Error(`different package objects are defined in the batch creation`);
      }
      if (!module_name) {
        module_name = metadata.module_name;
      } else if (module_name !== metadata.module_name) {
        throw new Error(`different module objects are defined in the batch creation`);
      }
      obj_addresses.push(obj.address.toString());
      metacmdslist.push([]);
      metadatas.push([]);
    }
    console.log(obj_addresses);
    const args: any[] = [obj_addresses, metacmdslist, metadatas];
    const type_args: string[] = [];
    return {
      function: `${package_address}::${module_name}::batch_delete`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async batchDeleteTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    objs: OrmObjectWithAddress<OrmObject>[],
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.batchDeleteTxnPayload(objs), options);
  }

  async transferForciblyTxn<OrmObject extends ObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject> | AccountAddressInput,
    to: AccountAddressInput,
    options?: OrmTxnOptions
  ) {
    let address: AccountAddress;
    if (obj instanceof AccountAddress || isInstanceOf(obj, 'AccountAddress')) {
      address = obj as AccountAddress;
    } else if (typeof obj === 'string') {
      address = AccountAddress.fromString(obj);
    } else {
      const { address: _addr } = loadOrmClassMetadata(obj, true);
      address = _addr;
    }
    return await this.generateOrmTxn(
      [user],
      {
        function: `${this.ormAddress}::orm_object::transfer_forcibly`,
        typeArguments: [`0x1::object::ObjectCore`],
        functionArguments: [address.toString(), to],
      },
      options
    );
  }

  async transferCoinsTxn(
    sender: Account | AccountAddressInput,
    receiver: AccountAddressInput,
    amount: number | bigint,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn(
      [sender],
      {
        function: `0x1::aptos_account::transfer`,
        typeArguments: [],
        functionArguments: [receiver, String(amount)],
      },
      options
    );
  }

  async transferCoinsFromObjectTxn(
    owner: Account | AccountAddressInput,
    object: AccountAddressInput,
    receiver: AccountAddressInput,
    amount: number | bigint,
    options?: OrmTxnOptions
  ) {
    let objtype = `${this.ormAddress}::orm_object::OrmObject`;
    let funcname = `${this.ormAddress}::orm_object::transfer_coins`;
    const resources = await this.getAccountResources({ accountAddress: toAddress(object) });
    for (const resource of resources) {
      if (resource?.type == `${this.ormAddress}::orm_class::OrmClass`) {
        objtype = `${this.ormAddress}::orm_class::OrmClass`;
        funcname = `${this.ormAddress}::orm_class::transfer_coins`;
      } else if (resource?.type == `${this.ormAddress}::orm_creator::OrmCreator`) {
        objtype = `${this.ormAddress}::orm_creator::OrmCreator`;
        funcname = `${this.ormAddress}::orm_creator::transfer_coins`;
      }
    }
    return await this.generateOrmTxn(
      [owner],
      {
        function: funcname as MoveFunctionId,
        typeArguments: [objtype, `0x1::aptos_coin::AptosCoin`],
        functionArguments: [object, receiver, String(amount)],
      },
      options
    );
  }

  async setRoyaltyTxn(
    owner: Account | AccountAddressInput,
    object: AccountAddressInput,
    payee: AccountAddressInput,
    denominator: number | bigint,
    numerator: number | bigint,
    options?: OrmTxnOptions
  ) {
    let objtype = `${this.ormAddress}::orm_object::OrmObject`;
    let funcname = `${this.ormAddress}::orm_object::set_royalty`;
    const resources = await this.getAccountResources({ accountAddress: toAddress(object) });
    for (const resource of resources) {
      if (resource?.type == `${this.ormAddress}::orm_class::OrmClass`) {
        objtype = `${this.ormAddress}::orm_class::OrmClass`;
        funcname = `${this.ormAddress}::orm_class::set_royalty`;
        break;
      }
    }
    return await this.generateOrmTxn(
      [owner],
      {
        function: funcname as MoveFunctionId,
        typeArguments: [objtype],
        functionArguments: [object, payee, String(denominator), String(numerator)],
      },
      options
    );
  }

  async updateModuleTxn<OrmObject extends ObjectLiteral>(
    package_owner: Account | AccountAddressInput,
    target_class: ClassType<OrmObject> | ClassName,
    options?: OrmTxnOptions
  ) {
    const metadata = getOrmClassMetadata(target_class);
    return await this.generateOrmTxn(
      [package_owner],
      {
        function: `${metadata.package_address}::${metadata.module_name}::update_module`,
        typeArguments: [],
        functionArguments: [],
      },
      options
    );
  }

  async getObject<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>, raise_error: boolean = true) {
    try {
      const { address, metadata } = loadOrmClassMetadata(obj, true);
      const fields = metadata.fields;
      if (!metadata.package_address || !metadata.module_name) {
        throw new Error(`package address is not defined`);
      }
      const rvalues = await this.view({
        payload: {
          function: `${metadata.package_address}::${metadata.module_name}::get`,
          typeArguments: [],
          functionArguments: [address.toString()],
        },
      });
      const dataobj = Object.create((metadata.class as any).prototype);
      rvalues.forEach((r, i) => {
        const field = fields[i];
        dataobj[field.property_key as keyof ObjectLiteral] = toPrimitiveType(r, field);
      });
      setOrmObjectAddress(dataobj, address);
      return dataobj as OrmObject & ObjectAddressable;
    } catch (e) {
      if (raise_error) {
        throw e;
      }
      return undefined;
    }
  }

  getAddress<OrmObject extends ObjectLiteral>(obj: OrmObjectTarget<OrmObject>, raise_error: boolean = true) {
    try {
      const addr = getOrmObjectAddress(obj);
      if (!addr) {
        const { address } = loadOrmClassMetadata(obj, true);
        return address;
      }
      return addr as string;
    } catch (e) {
      if (raise_error) {
        throw e;
      }
      return undefined;
    }
  }

  retrieveOrmObjectAddressesFromTxnr<OrmObject extends ObjectLiteral>(
    txnr: any,
    filter?: {
      event_type?: 'created' | 'deleted';
      object_type?: ClassType<OrmObject> | ObjectLiteral | string;
      change_type?: 'write_resource' | 'delete_resource';
    }
  ) {
    const addresses: string[] = [];
    if (filter?.event_type) {
      if (txnr?.events) {
        for (const event of txnr.events) {
          if (event?.type === this.ormEventType) {
            if (event?.data?.event_type === filter.event_type) {
              if (event?.data?.object) {
                addresses.push(event.data.object as string);
              }
            }
          }
        }
      }
      return [...new Set(addresses)];
    }
    let metadata: OrmClassMetadata;
    let search_resource: string;
    const change_type = filter?.change_type;
    if (filter?.object_type) {
      metadata = getOrmClassMetadata(filter.object_type);
      search_resource = `${metadata.package_address}::${metadata.module_name}::${metadata.name}`;
    }
    // [FIXME] delete_resource is not working due to no data in the change.
    if (txnr?.changes) {
      for (const change of txnr.changes) {
        if (!change?.data || !change?.type) continue;
        if (change_type && change.type !== change_type) continue;
        const resource_type = change.data?.type as string;
        let changed: string = undefined;
        if (search_resource && resource_type === search_resource) {
          if (change?.data?.object) {
            changed = change.data.object;
          }
        } else if (resource_type == this._ORM_OBJECT_TYPE) {
          changed = change.address;
        }
        if (changed) {
          addresses.push(changed);
        }
      }
    }
    return [...new Set(addresses)];
  }

  retrieveOrmObjectAddressFromTxnr<OrmObject extends ObjectLiteral>(
    txnr: any,
    filter?: {
      event_type?: 'created' | 'deleted';
      object_type?: ClassType<OrmObject> | ObjectLiteral | string;
      change_type?: 'write_resource' | 'delete_resource';
    }
  ) {
    const addresses = this.retrieveOrmObjectAddressesFromTxnr(txnr, filter);
    if (addresses.length > 1) {
      throw new Error(`multiple addresses found`);
    }
    return addresses[0];
  }
}
