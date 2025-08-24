# Finmates Uniswap V3 Subgraph

This subgraph indexes Uniswap V3 data on Arbitrum One for Finmates.

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Generate types:
```bash
npm run codegen
```

3. Build the subgraph:
```bash
npm run build
```

## Local Development

1. Run a local Graph Node:
```bash
docker-compose up -d
```

2. Create the subgraph:
```bash
npm run create-local
```

3. Deploy to local node:
```bash
npm run deploy-local
```

## Deployment

### To The Graph Studio
```bash
npm run deploy-studio
```

### To Hosted Service
```bash
npm run deploy
```

## Subgraph Details

- **Network**: Arbitrum One
- **Factory Contract**: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- **Position Manager**: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`
- **Start Block**: 165

## License

GPL-3.0-or-later