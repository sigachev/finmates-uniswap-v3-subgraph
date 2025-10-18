import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { TickRange, Pool } from "../types/schema";

/**
 * Get or create a TickRange entity
 */
export function getOrCreateTickRange(
  poolAddress: string,
  lowerTick: BigInt,
  upperTick: BigInt,
  pool: Pool
): TickRange {
  const id = poolAddress + "-" + lowerTick.toString() + "-" + upperTick.toString();
  let tickRange = TickRange.load(id);

  if (tickRange === null) {
    tickRange = new TickRange(id);
    tickRange.pool = pool.id;
    tickRange.lowerTick = lowerTick;
    tickRange.upperTick = upperTick;
    tickRange.priceLower = BigDecimal.fromString("0");
    tickRange.priceUpper = BigDecimal.fromString("0");
    tickRange.priceCurrent = BigDecimal.fromString("0");
    tickRange.liquidityActive = BigInt.fromI32(0);
    tickRange.totalLiquidity = BigInt.fromI32(0);
    tickRange.liquidityUSD = BigDecimal.fromString("0");
    tickRange.activePositions = BigInt.fromI32(0);
    tickRange.avgLiquidityPerPosition = BigDecimal.fromString("0");
    tickRange.volumeToken0 = BigDecimal.fromString("0");
    tickRange.volumeToken1 = BigDecimal.fromString("0");
    tickRange.volumeUSD = BigDecimal.fromString("0");
    tickRange.totalFeesCollected = BigDecimal.fromString("0");
    tickRange.feesToken0 = BigDecimal.fromString("0");
    tickRange.feesToken1 = BigDecimal.fromString("0");
    tickRange.feeAPR24h = BigDecimal.fromString("0");
    tickRange.feeAPR7d = BigDecimal.fromString("0");
    tickRange.volumeToLiquidityRatio24h = BigDecimal.fromString("0");
    tickRange.crossingCount = BigInt.fromI32(0);
    tickRange.isInRange = false;
    tickRange.lastUpdateTimestamp = BigInt.fromI32(0);
    tickRange.lastUpdateBlock = BigInt.fromI32(0);
  }

  return tickRange;
}

/**
 * Update tick range when position is added
 */
export function updateTickRangeOnPositionAdd(
  tickRange: TickRange,
  liquidity: BigInt,
  timestamp: BigInt
): void {
  tickRange.activePositions = tickRange.activePositions.plus(BigInt.fromI32(1));
  tickRange.totalLiquidity = tickRange.totalLiquidity.plus(liquidity);

  // Update average liquidity per position
  if (tickRange.activePositions.gt(BigInt.fromI32(0))) {
    const totalLiquidityDecimal = new BigDecimal(tickRange.totalLiquidity);
    const activePositionsDecimal = new BigDecimal(tickRange.activePositions);
    tickRange.avgLiquidityPerPosition = totalLiquidityDecimal.div(activePositionsDecimal);
  }

  tickRange.lastUpdateTimestamp = timestamp;
  tickRange.save();
}

/**
 * Update tick range when position is removed
 */
export function updateTickRangeOnPositionRemove(
  tickRange: TickRange,
  liquidity: BigInt,
  timestamp: BigInt
): void {
  tickRange.activePositions = tickRange.activePositions.minus(BigInt.fromI32(1));
  tickRange.totalLiquidity = tickRange.totalLiquidity.minus(liquidity);

  // Update average liquidity per position
  if (tickRange.activePositions.gt(BigInt.fromI32(0))) {
    const totalLiquidityDecimal = new BigDecimal(tickRange.totalLiquidity);
    const activePositionsDecimal = new BigDecimal(tickRange.activePositions);
    tickRange.avgLiquidityPerPosition = totalLiquidityDecimal.div(activePositionsDecimal);
  } else {
    tickRange.avgLiquidityPerPosition = BigDecimal.fromString("0");
  }

  tickRange.lastUpdateTimestamp = timestamp;
  tickRange.save();
}

/**
 * Record fees collected in a tick range
 */
export function recordTickRangeFees(tickRange: TickRange, fees: BigDecimal): void {
  tickRange.totalFeesCollected = tickRange.totalFeesCollected.plus(fees);
  tickRange.save();
}

/**
 * Record a crossing through this tick range
 */
export function recordTickRangeCrossing(tickRange: TickRange, timestamp: BigInt): void {
  tickRange.crossingCount = tickRange.crossingCount.plus(BigInt.fromI32(1));
  tickRange.lastUpdateTimestamp = timestamp;
  tickRange.save();
}