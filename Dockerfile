# http file server
FROM golang:1.19 AS file-server-builder
RUN go install github.com/neoul/simple-file-server@latest

# apto_orm localnet
FROM ubuntu:22.04 AS apto_orm-builer
ENV DEBIAN_FRONTEND noninteractive
RUN apt update && apt install -y sudo wget curl python3 build-essential jq git unzip postgresql postgresql-contrib && rm -rf /var/lib/apt/lists/*
RUN wget https://github.com/mikefarah/yq/releases/download/v4.30.8/yq_linux_amd64.tar.gz -O /tmp/yq_linux_amd64.tar.gz && \
  tar xvfz /tmp/yq_linux_amd64.tar.gz --directory /tmp && mv /tmp/yq_linux_amd64 /usr/local/bin/yq
# RUN curl -fsSL "https://aptos.dev/scripts/install_cli.py" | python3 && mv /root/.local/bin/aptos /usr/local/bin/
RUN wget https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v3.0.2/aptos-cli-3.0.2-Ubuntu-22.04-x86_64.zip \
  -O aptos-cli-3.0.2-Ubuntu-22.04-x86_64.zip && unzip aptos-cli-3.0.2-Ubuntu-22.04-x86_64.zip && mv aptos /usr/local/bin/
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash \
  && export NVM_DIR="/root/.nvm" \
  && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" \
  && [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion" \
  && nvm install --lts \
  && nvm alias default node \
  && corepack enable
COPY --from=file-server-builder /go/bin/simple-file-server /usr/local/bin/file-server
COPY ./move /root/move
COPY resource.png .key* /root/.key/
COPY --chmod=644 ./run-container.sh ./run.sh /root/
RUN mv /root/.key/resource.png /root/resource.png
RUN echo 'export NVM_DIR="$HOME/.nvm"' >> /root/run-container.sh
RUN echo ". ~/.nvm/nvm.sh" >> /root/run-container.sh
RUN echo "export APTOS_NODE_URL=http://localhost:8080" >> /root/run-container.sh
RUN echo "export PAYER=/root/.key/payer" >> /root/run-container.sh
RUN chmod +x /root/run-container.sh
RUN chmod +x /root/run.sh
WORKDIR /root
# RUN ./run-container.sh

# # fee_free server
# FROM node:18 AS apto_orm_api-builder
# ENV PNPM_HOME="/pnpm"
# ENV PATH="$PNPM_HOME:$PATH"
# RUN corepack enable
# COPY ./server /root/server
# COPY ./typescript /root/typescript
# WORKDIR /root/typescript
# RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile # --prod
# RUN pnpm run build
# WORKDIR /root/server
# RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# RUN pnpm run build

# FROM apto_orm-builer AS apto_orm-testing
# SHELL ["/bin/bash", "-c"]
# COPY --from=apto_orm_api-builder /root/typescript /root/typescript
# COPY --from=apto_orm_api-builder /root/server /root/server
# RUN echo 'source .env' >> run-container.sh
# RUN echo "cd /root/server && node dist/server.js &" >> run-container.sh
# RUN echo 'sleep 1 && cd /root/typescript && pnpm test && cd /root/server && pnpm test && touch .test-done' >> run-container.sh
# RUN ./run-container.sh

# FROM apto_orm-builer as aptos_orm
# COPY --from=apto_orm_api-builder /root/typescript /root/typescript
# COPY --from=apto_orm_api-builder /root/server /root/server
# EXPOSE 5678 8070 8080-8082 8090 9101 50051
# RUN echo "file-server --port 8082 --path ./config &" >> /root/run-container.sh
# RUN echo "cd /root/server && node dist/server.js" >> /root/run-container.sh
# CMD [ "./run-container.sh" ]

# # # [How to build, test and run]
# # # testing
# # `docker build --target apto_orm-testing -t apto_orm-testing .`
# # # Building
# # `docker build -t apto_orm .`
# # `docker build -t apto_orm . &> build.log`
# # # Running
# # `docker run -d -p 8080-8082:8080-8082 -p 8090:8090 -p 9101:9101 -p 50051:50051 -p 5678:5678 --name apto_orm apto_orm`
# # # Downloading keys and .env
# # `curl http://localhost:8082/download.sh | sh`
