# Uniswap V3 Advanced Analytics Subgraph

Complete analytics subgraph for Uniswap V3 on Arbitrum, tracking liquidity distribution, tick frequency, profitability metrics, and market microstructure.

## 📊 Features

### 1. **Tick Range Analytics**
- Track liquidity and performance for specific price ranges
- Calculate Fee APR (1h, 3h, 6h, 12h, 24h, 3d, 7d, 30d)
- Volume-to-Liquidity ratios for capital efficiency
- Hourly and daily snapshots

### 2. **Tick Frequency Tracking**
- Record which ticks price hits most frequently
- 8 timeframes: 1h, 3h, 6h, 12h, 24h, 3d, 7d, 30d
- Support/resistance identification
- Price consolidation zones

### 3. **Position Tracking**
- All positions tracked (no minimum size)
- Complete liquidity distribution
- Real-time profitability metrics
- Historical performance data

### 4. **Market Microstructure**
- Tick transitions (price movements)
- Liquidity concentration (Gini coefficient)
- Volume patterns
- Price volatility indicators

---

## 🚀 Quick Start Queries

### Query 1: Most Profitable Pools
**Find pools with highest Fee APR in last 24 hours**

```graphql
query TopProfitablePools {
  pools(
    first: 20
    orderBy: feesUSD
    orderDirection: desc
    where: { 
      totalValueLockedUSD_gt: "100000"  # Min $100k TVL
      volumeUSD_gt: "10000"             # Min $10k volume
    }
  ) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
    feesUSD
    token0Price
    
    # Get 24h data
    poolDayData(
      first: 1
      orderBy: date
      orderDirection: desc
    ) {
      volumeUSD
      feesUSD
      tvlUSD
    }
  }
}
```

**Logic:**
- Filter pools by minimum liquidity ($100k) and volume ($10k)
- Sort by total fees generated
- Calculate APR: `(fees_24h / tvl) × 365 × 100`

---

### Query 2: Best LP Ranges (Most Frequent Ticks)
**Find optimal ranges for liquidity provision**

```graphql
query OptimalLPRanges($poolId: ID!, $timeframe: String!) {
  # Get most frequent ticks
  tickActivities(
    where: { 
      pool: $poolId
      # Use: hits1h, hits3h, hits6h, hits12h, hits24h, hits3d, hits7d, or hits30d
      ${timeframe}_gt: "5"
      volume${timeframe}_gt: "10000"
    }
    orderBy: ${timeframe}
    orderDirection: desc
    first: 50
  ) {
    tickIdx
    price
    hits: ${timeframe}
    volume: volume${timeframe}
    totalTimeAtTick        # Stability indicator
    hitCount               # Historical baseline
  }
}

# Variables:
# { "poolId": "0x...", "timeframe": "hits24h" }
```

**Logic:**
1. Get top 50 most frequent ticks
2. Find continuous range (e.g., ticks 100-150)
3. **High `hits` + High `totalTimeAtTick`** = Strong support/resistance
4. **High `volume`** = More fee generation
5. Place liquidity in identified range

**Example Result:**
```
Ticks 202900-202950 (price $3,450-$3,460)
- Hit 145 times in 24h
- $2.5M volume
- Expected fee APR: ~50%
```

---

### Query 3: Support & Resistance Levels
**Identify key price levels**

```graphql
query SupportResistanceLevels($poolId: ID!) {
  pool(id: $poolId) {
    tick
    token0Price
  }
  
  # Support levels (below current price)
  support: tickActivities(
    where: { 
      pool: $poolId
      tickIdx_lt: ${currentTick}
      hits24h_gt: "3"
    }
    orderBy: totalTimeAtTick
    orderDirection: desc
    first: 5
  ) {
    tickIdx
    price
    hits24h
    totalTimeAtTick      # Seconds at this level
    volume24h
  }
  
  # Resistance levels (above current price)
  resistance: tickActivities(
    where: { 
      pool: $poolId
      tickIdx_gt: ${currentTick}
      hits24h_gt: "3"
    }
    orderBy: totalTimeAtTick
    orderDirection: desc
    first: 5
  ) {
    tickIdx
    price
    hits24h
    totalTimeAtTick
    volume24h
  }
}
```

**Logic:**
- **Support** = Price levels below current that held before
- **Resistance** = Price levels above current that rejected before
- **High `totalTimeAtTick`** = Strong level (price consolidated there)
- **High `hits24h`** = Recently confirmed level

**Trading Strategy:**
- Buy near support levels
- Sell near resistance levels
- Place limit orders at these levels

---

### Query 4: Trend Detection
**Determine if market is trending up, down, or ranging**

```graphql
query TrendAnalysis($poolId: ID!, $timeframe: String!) {
  # Most frequent tick transitions
  tickTransitions(
    where: { pool: $poolId }
    orderBy: count${timeframe}
    orderDirection: desc
    first: 20
  ) {
    fromTick
    toTick
    count: count${timeframe}
    priceIncrease          # true = upward, false = downward
    priceChangePercent
    volumeUSD
  }
}

# Variables:
# { "poolId": "0x...", "timeframe": "24h" }
```

**Logic:**
```javascript
// Count upward vs downward transitions
let upCount = 0, downCount = 0;
transitions.forEach(t => {
  if (t.priceIncrease) upCount += t.count;
  else downCount += t.count;
});

if (upCount > downCount * 1.5) return "UPTREND";
if (downCount > upCount * 1.5) return "DOWNTREND";
return "RANGING";
```

**Interpretation:**
- **Uptrend**: Most transitions are upward (price increasing)
- **Downtrend**: Most transitions are downward (price decreasing)
- **Ranging**: Mixed transitions (consolidating)

---

### Query 5: Volatility Check
**Determine if market is volatile or stable**

```graphql
query VolatilityAnalysis($poolId: ID!) {
  # Get latest ranking
  ranking: tickFrequencyRankings(
    where: { 
      pool: $poolId
      timeframe: "1h"
    }
    first: 1
    orderBy: timestamp
    orderDirection: desc
  ) {
    totalUniqueTicksHit    # How many different ticks hit
    mostFrequentTickHits   # Max hits on any single tick
    priceVolatility        # Standard deviation
  }
  
  # Get tick distribution
  recentTicks: tickActivities(
    where: { 
      pool: $poolId
      hits1h_gt: "0"
    }
    first: 1000
  ) {
    tickIdx
    hits1h
  }
}
```

**Logic:**
```javascript
// High volatility indicators:
if (totalUniqueTicksHit > 100) return "HIGH_VOLATILITY";
if (mostFrequentTickHits < 5) return "HIGH_VOLATILITY";

// Low volatility (consolidating):
if (totalUniqueTicksHit < 20) return "LOW_VOLATILITY";
if (mostFrequentTickHits > 20) return "LOW_VOLATILITY";

return "MEDIUM_VOLATILITY";
```

---

### Query 6: Pool Comparison
**Compare multiple pools side-by-side**

```graphql
query CompareP pools {
  pools(
    where: { id_in: [
      "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",  # USDC/ETH 0.05%
      "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",  # USDC/ETH 0.3%
      "0x7bea39867e4169dbe237d55c8242a8f2fcdcc387"   # USDC/ETH 1%
    ]}
  ) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
    feesUSD
    token0Price
    txCount
    
    # 24h metrics
    poolDayData(first: 1, orderBy: date, orderDirection: desc) {
      volumeUSD
      feesUSD
      tvlUSD
      txCount
    }
  }
}
```

**Metrics to Compare:**
- **Volume/TVL Ratio** = Capital efficiency
- **Fees/TVL Ratio** = Direct profitability
- **Fee Tier vs Volume** = Is higher fee justified?

**Example Analysis:**
```
Pool A (0.05% fee): $10M TVL, $5M volume → V/TVL = 0.5
Pool B (0.30% fee): $8M TVL, $12M volume → V/TVL = 1.5

Pool B is more efficient despite higher fees!
```

---

### Query 7: Real-Time Pool Dashboard
**Complete pool overview**

```graphql
query PoolDashboard($poolId: ID!) {
  pool(id: $poolId) {
    id
    token0 { symbol, decimals }
    token1 { symbol, decimals }
    feeTier
    tick
    sqrtPrice
    liquidity
    token0Price
    token1Price
    totalValueLockedUSD
    volumeUSD
    feesUSD
    txCount
    
    # Hourly data (last 24 hours)
    poolHourData(
      first: 24
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      periodStartUnix
      volumeUSD
      feesUSD
      tvlUSD
      high
      low
      close
    }
    
    # Daily data (last 7 days)
    poolDayData(
      first: 7
      orderBy: date
      orderDirection: desc
    ) {
      date
      volumeUSD
      feesUSD
      tvlUSD
      high
      low
      close
    }
  }
  
  # Top liquidity ranges
  topRanges: tickRanges(
    where: { pool: $poolId }
    orderBy: feeAPR24h
    orderDirection: desc
    first: 10
  ) {
    priceLower
    priceUpper
    liquidityUSD
    feeAPR24h
    volumeToLiquidityRatio24h
    isInRange
  }
  
  # Most frequent ticks
  hotTicks: tickActivities(
    where: { 
      pool: $poolId
      hits24h_gt: "0"
    }
    orderBy: hits24h
    orderDirection: desc
    first: 10
  ) {
    tickIdx
    price
    hits24h
    volume24h
  }
}
```

---

### Query 8: Historical Position Performance
**Track a specific position's profitability**

```graphql
query PositionPerformance($positionId: ID!) {
  position(id: $positionId) {
    id
    owner
    pool {
      id
      token0 { symbol }
      token1 { symbol }
      token0Price
    }
    liquidity
    tickLower { tickIdx, price0 }
    tickUpper { tickIdx, price0 }
    
    # Deposits
    depositedToken0
    depositedToken1
    
    # Withdrawals
    withdrawnToken0
    withdrawnToken1
    
    # Fees collected
    collectedFeesToken0
    collectedFeesToken1
    
    # Transaction history
    transaction {
      timestamp
      id
    }
  }
  
  # Get tick range performance
  tickRange(id: "${poolId}-${tickLower}-${tickUpper}") {
    feeAPR24h
    feeAPR7d
    volumeUSD
    feesUSD
    isInRange
  }
}
```

**Calculate Position Returns:**
```javascript
// Total value deposited (USD)
const depositedUSD = 
  (depositedToken0 * token0Price) + 
  (depositedToken1 / token0Price);

// Total fees earned (USD)
const feesUSD = 
  (collectedFeesToken0 * token0Price) + 
  (collectedFeesToken1 / token0Price);

// ROI
const roi = (feesUSD / depositedUSD) * 100;

// Annualized APR
const daysActive = (now - transaction.timestamp) / 86400;
const apr = (roi / daysActive) * 365;
```

---

### Query 9: Underutilized Opportunities
**Find high-volume ranges with low liquidity competition**

```graphql
query Opportunities {
  # High volume but low liquidity = opportunity
  tickRanges(
    where: {
      volumeUSD_gt: "100000"       # High volume (>$100k)
      liquidityUSD_lt: "50000"     # Low liquidity (<$50k)
      isInRange: true              # Currently active
    }
    orderBy: volumeToLiquidityRatio24h
    orderDirection: desc
    first: 20
  ) {
    id
    pool {
      token0 { symbol }
      token1 { symbol }
      feeTier
    }
    priceLower
    priceUpper
    liquidityUSD
    volumeUSD
    feesUSD
    feeAPR24h
    volumeToLiquidityRatio24h
    positionCount              # Low = less competition
  }
}
```

**Opportunity Score:**
```javascript
score = (volumeToLiquidityRatio × 100) - (positionCount × 2)

// High score = good opportunity
if (score > 150) return "EXCELLENT";
if (score > 100) return "GOOD";
return "MODERATE";
```

---

### Query 10: Multi-Timeframe Tick Analysis
**See how tick importance changes over time**

```graphql
query TickEvolution($poolId: ID!, $tick: BigInt!) {
  tickActivity(id: "${poolId}#${tick}") {
    tickIdx
    price
    
    # Short-term (intraday)
    hits1h
    hits3h
    hits6h
    hits12h
    
    # Medium-term (daily)
    hits24h
    hits3d
    
    # Long-term (weekly/monthly)
    hits7d
    hits30d
    
    # Historical context
    hitCount
    totalTimeAtTick
    
    # Volume evolution
    volume1h
    volume12h
    volume24h
    volume7d
    volume30d
  }
}
```

**Pattern Recognition:**
```javascript
// Emerging support/resistance
if (hits7d < 10 && hits24h > 20) {
  return "NEW_LEVEL_FORMING";
}

// Strong persistent level
if (hits30d > 100 && hits7d > 30 && hits24h > 10) {
  return "STRONG_LEVEL";
}

// Decaying level
if (hits30d > 100 && hits7d < 20 && hits24h < 5) {
  return "LEVEL_BREAKING";
}

// Flash consolidation
if (hits30d < 50 && hits24h > 30 && hits1h > 10) {
  return "TEMPORARY_CONSOLIDATION";
}
```

---

## 📐 Key Formulas

### 1. Fee APR Calculation
```
Fee APR = (Fees / Liquidity) × (365 / Days) × 100

Example:
- Fees in 24h: $1,000
- Average liquidity: $50,000
- APR = ($1,000 / $50,000) × 365 × 100 = 730%
```

### 2. Volume-to-Liquidity Ratio
```
V/L Ratio = Volume / Liquidity

Interpretation:
- Ratio > 2.0 = Excellent capital efficiency
- Ratio 1.0-2.0 = Good
- Ratio < 0.5 = Poor (underutilized)
```

### 3. Composite Profitability Score
```
Score = (Fee APR × 0.4) + 
        ((V/L Ratio × 20) × 0.3) + 
        (Utilization% × 0.2) + 
        ((1 / Volatility) × 10 × 0.1)

Score > 80 = Excellent
Score 50-80 = Good
Score < 50 = Poor
```

### 4. Impermanent Loss Estimate
```
IL = 2 × sqrt(price_ratio) / (1 + price_ratio) - 1

Where:
price_ratio = current_price / entry_price

Example:
- Entry price: $3,000
- Current price: $3,300
- Ratio = 1.1
- IL ≈ 0.2% loss
```

### 5. Expected Fees (Next Period)
```
Expected_Fees = 
  Avg_Volume_Per_Period × 
  Fee_Tier × 
  (Your_Liquidity / Total_Liquidity)

Example:
- Avg 24h volume: $5M
- Fee tier: 0.3% = 0.003
- Your liquidity: 5% of total
- Expected = $5M × 0.003 × 0.05 = $750/day
```

---

## 🎯 Use Case Workflows

### Workflow 1: Find Best Pool for LP (Complete Process)

**Step 1: Filter candidate pools**
```graphql
{
  pools(
    where: {
      totalValueLockedUSD_gt: "1000000"
      volumeUSD_gt: "100000"
    }
    orderBy: feesUSD
    orderDirection: desc
    first: 20
  ) { ... }
}
```

**Step 2: Analyze top 5 pools**
- Calculate Fee APR for each
- Check volume stability (compare 24h vs 7d vs 30d)
- Assess competition (number of positions)

**Step 3: Find optimal range in chosen pool**
```graphql
{
  tickActivities(
    where: { pool: $chosenPool, hits7d_gt: "10" }
    orderBy: totalTimeAtTick
    orderDirection: desc
  ) { ... }
}
```

**Step 4: Validate range**
- Check `hits24h` confirms recent activity
- Verify `volume7d` is substantial
- Calculate expected fees

**Step 5: Monitor position**
- Track `feeAPR24h` daily
- Watch for `isInRange` changes
- Rebalance if APR drops >50%

---

### Workflow 2: Day Trading Setup

**Morning Routine:**
1. Check overnight volatility
2. Identify support/resistance for today
3. Set limit orders at key levels
4. Monitor throughout day

**Queries:**
```graphql
# 1. Volatility check
{ tickFrequencyRankings(timeframe: "12h") { totalUniqueTicksHit } }

# 2. S/R levels
{ tickActivities(orderBy: totalTimeAtTick) { price, hits24h } }

# 3. Trend direction
{ tickTransitions(orderBy: count12h) { priceIncrease, count } }
```

---

## 🔧 GraphQL Endpoint

```
https://api.thegraph.com/subgraphs/name/[your-username]/uniswap-v3-arbitrum
```

Or local:
```
http://localhost:8000/subgraphs/name/finmates/uniswap-v3
```

---

## 📚 Additional Resources

- [Full Schema Documentation](./schema.graphql)
- [Tick Range Analytics Guide](./tick_range_guide.md)
- [Tick Frequency Guide](./tick_frequency_guide.md)
- [Deployment Instructions](./deployment_guide.md)

---

## 🤝 Support

For issues or questions:
1. Check the guides in this repository
2. Review example queries above
3. Test queries in GraphQL Playground

---

**Built with ❤️ for DeFi traders and LPs**