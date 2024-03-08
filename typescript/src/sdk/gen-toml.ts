import fs from 'fs';
import { ensureAddressString, getOrmAddress, snakeToCamel, toAddress } from './utilities';
import { Account, AccountAddress, AccountAddressInput } from '@aptos-labs/ts-sdk';

export function generateMoveToml(
  package_path: string,
  package_name: string,
  package_address: AccountAddress,
  local_apto_orm_package?: string
) {
  generateToml(package_path, undefined, package_name, package_address, local_apto_orm_package);
}

export function generateToml(
  package_path: string,
  package_creator: Account | AccountAddressInput | undefined,
  package_name: string,
  package_address: AccountAddressInput,
  local_apto_orm_package?: string
) {
  const dpath = package_path;
  const fpath = `${package_path}/Move.toml`;
  if (!fs.existsSync(dpath)) {
    fs.mkdirSync(dpath, { recursive: true });
  }
  const apto_orm_address = getOrmAddress() || '_';
  const apto_orm_local_package = local_apto_orm_package
    ? `{ local = "${local_apto_orm_package}" }`
    : `{ git = "https://github.com/supervlabs/apto_orm", subdir = "move/apto_orm", rev = "main" }`;
  const package_creator_str = package_creator ? `package_creator = "${toAddress(package_creator)}"` : ``;

  const movetoml = `[package]
name = '${snakeToCamel(package_name, true)}'
version = '1.0.0'

[addresses]
apto_orm = "${apto_orm_address}"
${package_name} = "${ensureAddressString(package_address)}"
${package_creator_str}

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-framework", rev = "9bae15401e" }
AptosToken = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-token", rev = "9bae15401e" }
AptosTokenObjects = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-token-objects", rev = "9bae15401e" }
AptoORM = ${apto_orm_local_package}
`;

  fs.writeFileSync(fpath, movetoml);
}
