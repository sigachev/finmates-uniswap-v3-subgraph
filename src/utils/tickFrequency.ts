import { BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import {
  TickActivity,
  GlobalTickRanking,
  PoolTickActivity,
  Pool,
} from "../types/schema";

// Time constants (in seconds)
export const ONE_HOUR: i32 = 3600;
export const THREE_HOURS: i32 = 10800;
export const SIX_HOURS: i32 = 21600;
export const TWELVE_HOURS: i32 = 43200;
export const ONE_DAY: i32 = 86400;
export const THREE_DAYS: i32 = 259200;
export const SEVEN_DAYS: i32 = 604800;
export const THIRTY_DAYS: i32 = 2592000;

// Top N ticks to track for rankings
const TOP_TICKS_COUNT: i32 = 100;

/**
 * Get or create TickActivity entity
 */
export function getOrCreateTickActivity(
  poolAddress: string,
  tickIdx: BigInt,
  pool: Pool,
  price: BigDecimal
): TickActivity {
  const id = poolAddress + "-" + tickIdx.toString();
  let tickActivity = TickActivity.load(id);

  if (tickActivity === null) {
    tickActivity = new TickActivity(id);
    tickActivity.pool = pool.id;
    tickActivity.tickIdx = tickIdx;
    tickActivity.price = price;

    // Initialize all hit counters
    tickActivity.hits1h = BigInt.fromI32(0);
    tickActivity.hits3h = BigInt.fromI32(0);
    tickActivity.hits6h = BigInt.fromI32(0);
    tickActivity.hits12h = BigInt.fromI32(0);
    tickActivity.hits24h = BigInt.fromI32(0);
    tickActivity.hits3d = BigInt.fromI32(0);
    tickActivity.hits7d = BigInt.fromI32(0);
    tickActivity.hits30d = BigInt.fromI32(0);

    // Initialize all volume counters
    tickActivity.volume1h = BigDecimal.fromString("0");
    tickActivity.volume3h = BigDecimal.fromString("0");
    tickActivity.volume6h = BigDecimal.fromString("0");
    tickActivity.volume12h = BigDecimal.fromString("0");
    tickActivity.volume24h = BigDecimal.fromString("0");
    tickActivity.volume3d = BigDecimal.fromString("0");
    tickActivity.volume7d = BigDecimal.fromString("0");
    tickActivity.volume30d = BigDecimal.fromString("0");

    // Initialize other fields
    tickActivity.liquidityAdded = BigInt.fromI32(0);
    tickActivity.liquidityRemoved = BigInt.fromI32(0);
    tickActivity.feesCollected = BigDecimal.fromString("0");
    tickActivity.lastUpdateTimestamp = BigInt.fromI32(0);
  }

  return tickActivity;
}

/**
 * Record a tick crossing event
 */
export function recordTickCrossing(
  tickActivity: TickActivity,
  volume: BigDecimal,
  timestamp: BigInt
): void {
  const currentTime = timestamp.toI32();
  const lastUpdateTime = tickActivity.lastUpdateTimestamp.toI32();

  // Reset counters that have expired
  if (lastUpdateTime > 0) {
    const timeDiff = currentTime - lastUpdateTime;

    if (timeDiff >= ONE_HOUR) {
      tickActivity.hits1h = BigInt.fromI32(0);
      tickActivity.volume1h = BigDecimal.fromString("0");
    }
    if (timeDiff >= THREE_HOURS) {
      tickActivity.hits3h = BigInt.fromI32(0);
      tickActivity.volume3h = BigDecimal.fromString("0");
    }
    if (timeDiff >= SIX_HOURS) {
      tickActivity.hits6h = BigInt.fromI32(0);
      tickActivity.volume6h = BigDecimal.fromString("0");
    }
    if (timeDiff >= TWELVE_HOURS) {
      tickActivity.hits12h = BigInt.fromI32(0);
      tickActivity.volume12h = BigDecimal.fromString("0");
    }
    if (timeDiff >= ONE_DAY) {
      tickActivity.hits24h = BigInt.fromI32(0);
      tickActivity.volume24h = BigDecimal.fromString("0");
    }
    if (timeDiff >= THREE_DAYS) {
      tickActivity.hits3d = BigInt.fromI32(0);
      tickActivity.volume3d = BigDecimal.fromString("0");
    }
    if (timeDiff >= SEVEN_DAYS) {
      tickActivity.hits7d = BigInt.fromI32(0);
      tickActivity.volume7d = BigDecimal.fromString("0");
    }
    if (timeDiff >= THIRTY_DAYS) {
      tickActivity.hits30d = BigInt.fromI32(0);
      tickActivity.volume30d = BigDecimal.fromString("0");
    }
  }

  // Increment all counters
  tickActivity.hits1h = tickActivity.hits1h.plus(BigInt.fromI32(1));
  tickActivity.hits3h = tickActivity.hits3h.plus(BigInt.fromI32(1));
  tickActivity.hits6h = tickActivity.hits6h.plus(BigInt.fromI32(1));
  tickActivity.hits12h = tickActivity.hits12h.plus(BigInt.fromI32(1));
  tickActivity.hits24h = tickActivity.hits24h.plus(BigInt.fromI32(1));
  tickActivity.hits3d = tickActivity.hits3d.plus(BigInt.fromI32(1));
  tickActivity.hits7d = tickActivity.hits7d.plus(BigInt.fromI32(1));
  tickActivity.hits30d = tickActivity.hits30d.plus(BigInt.fromI32(1));

  tickActivity.volume1h = tickActivity.volume1h.plus(volume);
  tickActivity.volume3h = tickActivity.volume3h.plus(volume);
  tickActivity.volume6h = tickActivity.volume6h.plus(volume);
  tickActivity.volume12h = tickActivity.volume12h.plus(volume);
  tickActivity.volume24h = tickActivity.volume24h.plus(volume);
  tickActivity.volume3d = tickActivity.volume3d.plus(volume);
  tickActivity.volume7d = tickActivity.volume7d.plus(volume);
  tickActivity.volume30d = tickActivity.volume30d.plus(volume);

  tickActivity.lastUpdateTimestamp = timestamp;
  tickActivity.save();

  // Update global rankings
  updateGlobalRankings(tickActivity, timestamp);
}

/**
 * Update global tick rankings
 */
function updateGlobalRankings(
  tickActivity: TickActivity,
  timestamp: BigInt
): void {
  const timeframes = [
    "1h",
    "3h",
    "6h",
    "12h",
    "24h",
    "3d",
    "7d",
    "30d",
  ];

  for (let i = 0; i < timeframes.length; i++) {
    const timeframe = timeframes[i];
    let hitCount: BigInt;
    let volume: BigDecimal;

    // Get the appropriate hit count and volume for this timeframe
    if (timeframe == "1h") {
      hitCount = tickActivity.hits1h;
      volume = tickActivity.volume1h;
    } else if (timeframe == "3h") {
      hitCount = tickActivity.hits3h;
      volume = tickActivity.volume3h;
    } else if (timeframe == "6h") {
      hitCount = tickActivity.hits6h;
      volume = tickActivity.volume6h;
    } else if (timeframe == "12h") {
      hitCount = tickActivity.hits12h;
      volume = tickActivity.volume12h;
    } else if (timeframe == "24h") {
      hitCount = tickActivity.hits24h;
      volume = tickActivity.volume24h;
    } else if (timeframe == "3d") {
      hitCount = tickActivity.hits3d;
      volume = tickActivity.volume3d;
    } else if (timeframe == "7d") {
      hitCount = tickActivity.hits7d;
      volume = tickActivity.volume7d;
    } else {
      // 30d
      hitCount = tickActivity.hits30d;
      volume = tickActivity.volume30d;
    }

    // Only create ranking if there are hits
    if (hitCount.gt(BigInt.fromI32(0))) {
      // For simplicity, we'll track top 100 per timeframe
      // In production, you'd query existing rankings and insert appropriately
      const rankingId = timeframe + "-" + tickActivity.id;
      let ranking = GlobalTickRanking.load(rankingId);

      if (ranking === null) {
        ranking = new GlobalTickRanking(rankingId);
        ranking.timeframe = timeframe;
        ranking.rank = 0; // Would need proper ranking logic
        ranking.tickActivity = tickActivity.id;
      }

      ranking.hitCount = hitCount;
      ranking.volume = volume;
      ranking.timestamp = timestamp;
      ranking.save();
    }
  }
}

/**
 * Get or create PoolTickActivity
 */
export function getOrCreatePoolTickActivity(
  poolAddress: string,
  pool: Pool
): PoolTickActivity {
  let poolTickActivity = PoolTickActivity.load(poolAddress);

  if (poolTickActivity === null) {
    poolTickActivity = new PoolTickActivity(poolAddress);
    poolTickActivity.pool = pool.id;
    poolTickActivity.totalTicksCrossed = BigInt.fromI32(0);

    // Initialize all count fields
    poolTickActivity.count1h = BigInt.fromI32(0);
    poolTickActivity.count3h = BigInt.fromI32(0);
    poolTickActivity.count6h = BigInt.fromI32(0);
    poolTickActivity.count12h = BigInt.fromI32(0);
    poolTickActivity.count24h = BigInt.fromI32(0);
    poolTickActivity.count3d = BigInt.fromI32(0);
    poolTickActivity.count7d = BigInt.fromI32(0);
    poolTickActivity.count30d = BigInt.fromI32(0);

    poolTickActivity.lastUpdateTimestamp = BigInt.fromI32(0);
  }

  return poolTickActivity;
}

/**
 * Update pool tick activity counters
 */
export function updatePoolTickActivity(
  poolTickActivity: PoolTickActivity,
  timestamp: BigInt
): void {
  const currentTime = timestamp.toI32();
  const lastUpdateTime = poolTickActivity.lastUpdateTimestamp.toI32();

  // Reset counters that have expired
  if (lastUpdateTime > 0) {
    const timeDiff = currentTime - lastUpdateTime;

    if (timeDiff >= ONE_HOUR) {
      poolTickActivity.count1h = BigInt.fromI32(0);
    }
    if (timeDiff >= THREE_HOURS) {
      poolTickActivity.count3h = BigInt.fromI32(0);
    }
    if (timeDiff >= SIX_HOURS) {
      poolTickActivity.count6h = BigInt.fromI32(0);
    }
    if (timeDiff >= TWELVE_HOURS) {
      poolTickActivity.count12h = BigInt.fromI32(0);
    }
    if (timeDiff >= ONE_DAY) {
      poolTickActivity.count24h = BigInt.fromI32(0);
    }
    if (timeDiff >= THREE_DAYS) {
      poolTickActivity.count3d = BigInt.fromI32(0);
    }
    if (timeDiff >= SEVEN_DAYS) {
      poolTickActivity.count7d = BigInt.fromI32(0);
    }
    if (timeDiff >= THIRTY_DAYS) {
      poolTickActivity.count30d = BigInt.fromI32(0);
    }
  }

  // Increment all counters
  poolTickActivity.count1h = poolTickActivity.count1h.plus(BigInt.fromI32(1));
  poolTickActivity.count3h = poolTickActivity.count3h.plus(BigInt.fromI32(1));
  poolTickActivity.count6h = poolTickActivity.count6h.plus(BigInt.fromI32(1));
  poolTickActivity.count12h = poolTickActivity.count12h.plus(BigInt.fromI32(1));
  poolTickActivity.count24h = poolTickActivity.count24h.plus(BigInt.fromI32(1));
  poolTickActivity.count3d = poolTickActivity.count3d.plus(BigInt.fromI32(1));
  poolTickActivity.count7d = poolTickActivity.count7d.plus(BigInt.fromI32(1));
  poolTickActivity.count30d = poolTickActivity.count30d.plus(BigInt.fromI32(1));

  poolTickActivity.lastUpdateTimestamp = timestamp;
  poolTickActivity.save();
}

/**
 * Record liquidity change on a tick
 */
export function recordLiquidityChange(
  tickActivity: TickActivity,
  liquidityDelta: BigInt,
  isAdd: boolean
): void {
  if (isAdd) {
    tickActivity.liquidityAdded = tickActivity.liquidityAdded.plus(liquidityDelta);
  } else {
    tickActivity.liquidityRemoved = tickActivity.liquidityRemoved.plus(liquidityDelta);
  }
  tickActivity.save();
}

/**
 * Record fees collected on a tick
 */
export function recordFeesCollected(
  tickActivity: TickActivity,
  fees: BigDecimal
): void {
  tickActivity.feesCollected = tickActivity.feesCollected.plus(fees);
  tickActivity.save();
}