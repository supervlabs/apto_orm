#!/usr/bin/env bash

run_sh_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
project_dir=$(dirname "$run_sh_path")
config_yaml=$project_dir/.aptos/config.yaml

if ! command -v aptos &> /dev/null; then
   echo aptos not found, installing...
   curl -fsSL "https://aptos.dev/scripts/install_cli.py" | python3
   echo you may need to restart the terminal.
   exit 1
fi
if ! command -v jq &> /dev/null; then
   echo jq not found, installing...
   sudo apt install -y jq
   echo $(jq --version) installed
fi
if ! command -v yq &> /dev/null; then
   echo yq not found, installing...
   wget https://github.com/mikefarah/yq/releases/download/v4.30.8/yq_linux_amd64.tar.gz -O /tmp/yq_linux_amd64.tar.gz && \
      tar xvfz /tmp/yq_linux_amd64.tar.gz --directory /tmp && sudo mv /tmp/yq_linux_amd64 /usr/local/bin/yq
   echo $(yq --version) installed
fi

create_accounts() {
   local NETWORK=$1
   [ -z "$1" ] && NETWORK=local
   create_account default $NETWORK
   create_account user $NETWORK
   create_account payer $NETWORK
   generate_env $1
}

rm_accounts() {
   rm .env; rm -f .aptos/config.yaml; rm .key/ -fR
}

generate_env() {
   rm -f .env
   {
      echo "set -a"
      echo "APTOS_NETWORK=$1"
      echo "APTO_ORM_ADDR=$(yq '.profiles.default.account' $config_yaml)"
      echo "set +a"
   } >> .env
}

create_account() {
   echo "=> create account $1"
   # create account if not exist
   [ -z "$1" ] && {
      echo account name not specified
      exit 1
   }
   if [ ! -f ".key/$1" ]; then
      mkdir -p .key
      aptos key generate --assume-yes --output-file ".key/$1" >> /dev/null 2>&1
      chmod go-wrx .key
   fi
   local NETWORK=$2
   [ -z "$2" ] && NETWORK=local
   aptos init --assume-yes --network "$NETWORK" --profile "$1" --private-key-file ".key/$1" >> /dev/null  2>&1
   [ $? -ne 0 ] && echo failed to account init $1 && exit 1
   [ "x$1" == "xmainnet" ] && exit 0
   # fund account
   if [ "$1" == "default" ]; then
      aptos account fund-with-faucet --account "$1" --amount 10000000000000 >> /dev/null 2>&1
      [ $? -ne 0 ] && echo failed to fund default account && exit 1
   else
      aptos account transfer --account $(yq .profiles.$1.account $config_yaml) --profile default \
         --amount 100000000000 --assume-yes | jq -r .Result.transaction_hash >> /dev/null  2>&1
      [ $? -ne 0 ] && echo failed to transfer from default to $1 && exit 1
   fi
   echo "=>" $1 $(yq ".profiles.$1.account" "$config_yaml")
}

compile() {
   for f in $(find move -maxdepth 1 -mindepth 1 -type d); do
      compile_move "$f"
      # compile_move "${f#move/}"
   done
}

test() {
   for f in $(find move -maxdepth 1 -mindepth 1 -type d); do
      test_move "$f"
   done
}

publish() {
   publish_move move/utilities
   publish_move move/apto_orm
}

clean() {
   rm -fr $(find ./move -type d -name build -print)
}

_check_move_package() {
   [ -z "$1" ] && {
      echo package not specified
      exit 1
   }
   [ -d "$1" ] || {
      echo $1 not found
      exit 1
   }
   [ -z "$APTO_ORM_ADDR" ] && {
      echo \$APTO_ORM_ADDR not configured
      exit 1
   }
}

compile_move() {
   _check_move_package $1
   cd $1
   aptos move compile --save-metadata --named-addresses apto_orm=$APTO_ORM_ADDR
   # aptos move build-publish-payload --json-output-file json_output.json --named-addresses apto_orm=$APTO_ORM_ADDR --assume-yes
   cd - >> /dev/null
}

test_move() {
   _check_move_package $1
   cd $1
   aptos move test --named-addresses apto_orm=0x1e51 --ignore-compile-warnings || exit 1
   cd - >> /dev/null
}

publish_move() {
   _check_move_package $1
   cd $1 || { echo "$1 not found"; exit 1; }
   # aptos move publish --override-size-check --profile default --named-addresses apto_orm=$APTO_ORM_ADDR --assume-yes
   aptos move publish --profile default --named-addresses apto_orm=$APTO_ORM_ADDR --assume-yes || exit 1
   cd - >> /dev/null
}

function check_running() {
   sleep 1s
   while :
   do
      sleep 1s
      ready=$(curl -s http://localhost:8081)
      if [[ $ready == "tap:ok" ]];
      then
         echo -e "> running ... ok!"
         break
      fi
   done
   sleep 1s
}

function node_start() {
  aptos node run-local-testnet --with-faucet --faucet-port 8081 --force-restart --assume-yes --with-indexer-api &
   # aptos node run-local-testnet --with-faucet --faucet-port 8081 --force-restart --assume-yes &
}

function node_stop() {
  killall -q aptos >> /dev/null 2>&1
  docker kill local-testnet-indexer-api >> /dev/null 2>&1
  docker kill local-testnet-postgres >> /dev/null 2>&1
}

function node_restart() {
  aptos node run-local-testnet --with-faucet --faucet-port 8081 --assume-yes --with-indexer-api &
   # aptos node run-local-testnet --with-faucet --faucet-port 8081 --assume-yes &
}

function node_reset() {
  node_stop
  rm -rf $(find .aptos -maxdepth 1 -mindepth 1 -name "*" ! -name "config.yaml")
}

function orm_publish_local() {
   APTO_ORM_ADDR=$(yq '.profiles.default.account' $config_yaml) || exit 1

   cd "move/utilities"
   aptos move publish --assume-yes --private-key-file ../../.key/default \
   --url http://localhost:8080 --named-addresses apto_orm=$APTO_ORM_ADDR || exit 1
   cd - >> /dev/null

   cd "move/apto_orm"
   aptos move publish --assume-yes --private-key-file ../../.key/default \
   --url http://localhost:8080 --named-addresses apto_orm=$APTO_ORM_ADDR || exit 1
   cd - >> /dev/null
}

function orm_test_local() {
   APTO_ORM_ADDR=$(yq '.profiles.default.account' $config_yaml) || exit 1

   # utilities move test
   cd "move/utilities"
   aptos move test --named-addresses apto_orm=0x1e51 --ignore-compile-warnings || exit 1
   cd - >> /dev/null

   # apto_orm move test
   cd "move/apto_orm"
   aptos move test --named-addresses apto_orm=0x1e51 --ignore-compile-warnings || exit 1
   cd - >> /dev/null

   # # typescript test
   # cd typescript
   # pnpm install
   # pnpm build
   # pnpm test
   # cd - >> /dev/null
   
   # # server test
   # cd server
   # pnpm install && pnpm build
   # pnpm start:dev &
   # SERVER=$!
   # echo $!
   # sleep 1s
   # pnpm test
   # kill $SERVER
   # cd - >> /dev/null
}

current_dir=${PWD}
cd "$project_dir"
case $1 in
   start) node_start && check_running && create_accounts local && orm_publish_local;;
   restart) node_restart;;
   stop) node_stop;;
   reset) node_reset;;
   test) orm_test_local;;
   *) "$@";;
esac
cd "$current_dir" >> /dev/null
