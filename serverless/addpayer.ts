import { Command } from "commander";
import { HexString, AptosAccount } from "aptos";
import { Payer, mgmt, AptosNodeUri } from "./index";
import { OrmClient } from "apto_orm";
export const program = new Command();
program.version("1.0.0");
program.name("upload-payer");
program.description("upload payers to the target network");
program.option("  , --region <region>", "AWS region", "ap-northeast-2");
program
  .option(
    "-n, --network <network>",
    "The target Aptos network [devnet|testnet|mainnet]",
    process.env.NETWORK || "devnet"
  )
  .option(
    "-k, --keys <keyes...>",
    "The private key strings of the poa account to upload"
  )
  .action(async function () {
    const { keys, network, region } = this.optsWithGlobals();
    const nodeUri = AptosNodeUri[network];
    const client = new OrmClient(nodeUri);
    (keys as string[]).forEach(async (key: string, i: number) => {
      const account = new AptosAccount(HexString.ensure(key).toUint8Array());
      const addr = account.address().toShortString();
      const sequence_number = await client.getAccountSequenceNumber(addr);
      const payer = new Payer(
        i,
        account.address().toShortString(),
        account.pubKey().toString(),
        key,
        sequence_number
      );
      await mgmt.savePayer(payer);
    });
  });

async function main() {
  await program.parseAsync(process.argv);
}

main();
