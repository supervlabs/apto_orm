import {
  Aptos,
  AptosConfig,
  ClientConfig,
  Network,
  MoveType,
  MoveValue,
  AccountAddress,
  AccountAddressInput,
  Hex,
  HexInput,
  Account,
  InputGenerateTransactionPayloadData,
  InputGenerateTransactionOptions,
  PendingTransactionResponse,
  AnyRawTransaction,
  SimpleTransaction,
  MultiAgentTransaction,
  AccountAuthenticator,
  EntryFunctionArgumentTypes,
} from '@aptos-labs/ts-sdk';
import {
  toAddress,
  getOrmAddress,
  loadAddresses,
  // hexEncodedBytesToUint8Array,
  areUint8ArraysEqual,
  getNamedObjectAddress,
  loadOrmClassMetadata,
  setOrmObjectAddress,
  toPrimitiveType,
  getOrmObjectAddress,
} from './utilities';
import {
  OrmTxn,
  OrmTxnOptions,
  PendingTransaction,
  OrmFunctionPayload,
  OrmObjectLiteral,
  OrmObjectTarget,
  OrmObjectType,
  OrmClassMetadata,
  OrmObjectAddressable,
} from './types';
import { getOrmClassMetadata } from './metadata';

export class OrmClient extends Aptos {
  readonly '@instanceof' = Symbol.for('OrmClient');
  private _ORM_ADDRESS: string;
  private _ORM_EVENT_TYPE: string;
  private _ORM_OBJECT_TYPE: string;
  constructor(network_or_url: string);
  constructor(config: AptosConfig);
  constructor(config: AptosConfig | string | undefined) {
    let _config: AptosConfig;
    if (config === undefined) {
      throw new Error('Target network or config is not defined');
    } else if (config instanceof AptosConfig) {
      _config = config;
    } else if (typeof config === 'string') {
      const lowcase = config.toLowerCase();
      if (lowcase === 'testnet') {
        _config = new AptosConfig({ network: Network.TESTNET });
      } else if (lowcase === 'mainnet') {
        _config = new AptosConfig({ network: Network.MAINNET });
      } else if (lowcase === 'devnet') {
        _config = new AptosConfig({ network: Network.DEVNET });
      } else if (lowcase === 'randomnet') {
        _config = new AptosConfig({ network: Network.RANDOMNET });
      } else {
        _config = new AptosConfig({ fullnode: config });
      }
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
      typeof obj === 'object' && obj !== null && (obj as { '@instanceof': Symbol })['@instanceof'] === Symbol.for(name)
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
      if (sender instanceof Account) {
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
        if (s instanceof Account) {
          auths.push(this.transaction.sign({ signer: s, transaction: txn }));
        } else {
          auths.push(null);
        }
      });
    }
    if (options?.payer && options.payer instanceof Account) {
      payer_auth = this.transaction.signAsFeePayer({ signer: options.payer, transaction: txn });
    }
    return { type, txn, auths, payer_auth };
  }

  async signOrmTxn(signers: (Account | AccountAddressInput)[], ormtxn: OrmTxn, options?: Pick<OrmTxnOptions, 'payer'>) {
    const auths = ormtxn.auths;
    for (let i = 0; i < auths.length; i++) {
      if (auths[i]) continue;
      if (signers.length <= i) continue;
      const s = signers[i];
      if (s instanceof Account) {
        auths.push(this.transaction.sign({ signer: s, transaction: ormtxn.txn }));
      }
    }
    if (options?.payer && options.payer instanceof Account) {
      ormtxn.payer_auth = this.transaction.signAsFeePayer({ signer: options.payer, transaction: ormtxn.txn });
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

  createTxnPayload<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
    const { metadata, object } = loadOrmClassMetadata(obj);
    const fields = metadata.fields;
    const args: any[] = [];
    const type_args: string[] = [];
    fields.forEach((field) => {
      if (!field.writable) return;
      const value = object[field.property_key];
      if (value === undefined) {
        throw new Error(`OrmField '${field.property_key}' is not defined`);
      }
      args.push(object[field.property_key]);
    });
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }
    return {
      function: `${metadata.package_address}::${metadata.module_name}::create`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async createTxn<OrmObject extends OrmObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.createTxnPayload(obj), options);
  }

  createToTxnPayload<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>, to: AccountAddressInput) {
    const { metadata, object } = loadOrmClassMetadata(obj);
    const fields = metadata.fields;
    const args: any[] = [];
    const type_args: string[] = [];
    fields.forEach((field) => {
      if (!field.writable) return;
      const value = object[field.property_key];
      if (value === undefined) {
        throw new Error(`OrmField '${field.property_key}' is not defined`);
      }
      args.push(object[field.property_key]);
    });
    args.push(to);
    if (!metadata.package_address) {
      throw new Error(`package address is not defined`);
    }

    // type InputEntryFunctionData = {
    //   function: MoveFunctionId;
    //   typeArguments?: Array<TypeTag | string>;
    //   functionArguments: Array<EntryFunctionArgumentTypes | SimpleEntryFunctionArgumentTypes>;
    // };
    return {
      function: `${metadata.package_address}::${metadata.module_name}::create_to`,
      typeArguments: type_args,
      functionArguments: args,
    } as OrmFunctionPayload;
  }

  async createToTxn<OrmObject extends OrmObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    to: AccountAddressInput,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.createToTxnPayload(obj, to), options);
  }

  updateTxnPayload<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
    const { address, metadata, object } = loadOrmClassMetadata(obj, true);
    const fields = metadata.fields;
    const args: any[] = [address];
    const type_args: string[] = [];
    fields.forEach((field) => {
      if (field.index || !field.writable || field.immutable) return;
      const value = object[field.property_key as keyof OrmObjectLiteral];
      if (value === undefined) {
        throw new Error(`OrmField '${field.property_key}' is not defined`);
      }
      args.push(object[field.property_key as keyof OrmObjectLiteral]);
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

  async updateTxn<OrmObject extends OrmObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.updateTxnPayload(obj), options);
  }

  deleteTxnPayload<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>) {
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

  async deleteTxn<OrmObject extends OrmObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    options?: OrmTxnOptions
  ) {
    return await this.generateOrmTxn([user], this.deleteTxnPayload(obj), options);
  }

  async transferForciblyTxn<OrmObject extends OrmObjectLiteral>(
    user: Account | AccountAddressInput,
    obj: OrmObjectTarget<OrmObject>,
    to: AccountAddressInput,
    options?: OrmTxnOptions
  ) {
    const { address, metadata } = loadOrmClassMetadata(obj, true);
    return await this.generateOrmTxn(
      [user],
      {
        function: `${this.ormAddress}::orm_object::transfer_forcibly`,
        typeArguments: [`0x1::object::ObjectCore`],
        functionArguments: [address, to],
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

  async getObject<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>, raise_error: boolean = true) {
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
        dataobj[field.property_key as keyof OrmObjectLiteral] = toPrimitiveType(r, field);
      });
      setOrmObjectAddress(dataobj, address);
      return dataobj as OrmObject & OrmObjectAddressable;
    } catch (e) {
      if (raise_error) {
        throw e;
      }
      return undefined;
    }
  }

  getAddress<OrmObject extends OrmObjectLiteral>(obj: OrmObjectTarget<OrmObject>, raise_error: boolean = true) {
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

  retrieveOrmObjectAddressesFromTxnr<OrmObject extends OrmObjectLiteral>(
    txnr: any,
    filter?: {
      event_type?: 'created' | 'deleted';
      object_type?: OrmObjectType<OrmObject> | OrmObjectLiteral | string;
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

  retrieveOrmObjectAddressFromTxnr<OrmObject extends OrmObjectLiteral>(
    txnr: any,
    filter?: {
      event_type?: 'created' | 'deleted';
      object_type?: OrmObjectType<OrmObject> | OrmObjectLiteral | string;
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
