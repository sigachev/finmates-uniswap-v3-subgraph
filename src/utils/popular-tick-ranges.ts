import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Pool, PopularTickRange, Tick } from '../types/schema'
import { ZERO_BD, ONE_BD } from './constants'
import { safeDiv } from './index'

// Define range types based on tick spacing
export function getRangeType(tickSpacing: i32, rangeWidth: i32): string {
  let spacingMultiplier = rangeWidth / tickSpacing

  if (spacingMultiplier <= 10) {
    return 'narrow'   // Very tight range (e.g., ±1% for 0.01% fee)
  } else if (spacingMultiplier <= 50) {
    return 'medium'   // Medium range (e.g., ±5% for 0.01% fee)
  } else if (spacingMultiplier <= 200) {
    return 'wide'     // Wide range (e.g., ±20% for 0.01% fee)
  } else {
    return 'full'     // Full range (entire pool)
  }
}

// Simplified tick to price ratio calculation
// Each tick represents a 0.01% price change (1.0001^tick)
// For a range, we approximate the price multiplier
export function tickToApproxPriceMultiplier(tickDiff: i32): BigDecimal {
  // Approximate price change for tick differences
  // 1.0001^100 ≈ 1.01 (1% change)
  // 1.0001^1000 ≈ 1.105 (10.5% change)
  // 1.0001^10000 ≈ 2.718 (171.8% change)

  let absDiff = tickDiff
  if (absDiff < 0) {
    absDiff = -absDiff
  }

  // Simple linear approximation for small ranges
  // Each 100 ticks ≈ 1% price change
  let percentChange = BigDecimal.fromString((absDiff / 100).toString())

  if (tickDiff < 0) {
    // Price decrease: divide by (1 + percentChange/100)
    let divisor = ONE_BD.plus(percentChange.div(BigDecimal.fromString('100')))
    return ONE_BD.div(divisor)
  } else {
    // Price increase: multiply by (1 + percentChange/100)
    return ONE_BD.plus(percentChange.div(BigDecimal.fromString('100')))
  }
}

// Calculate price range percentage
export function calculatePriceRangePercent(priceLower: BigDecimal, priceUpper: BigDecimal, priceCenter: BigDecimal): BigDecimal {
  if (priceCenter.equals(ZERO_BD)) {
    return ZERO_BD
  }

  let lowerDiff = priceCenter.minus(priceLower).div(priceCenter).times(BigDecimal.fromString('100'))
  let upperDiff = priceUpper.minus(priceCenter).div(priceCenter).times(BigDecimal.fromString('100'))

  // Return average of both sides
  return lowerDiff.plus(upperDiff).div(BigDecimal.fromString('2'))
}

// Get or create a popular tick range
export function getOrCreatePopularTickRange(
  pool: Pool,
  lowerTick: i32,
  upperTick: i32,
  centerTick: i32,
  rangeType: string,
  tickSpacing: i32,
  blockTimestamp: BigInt
): PopularTickRange {
  let rangeId = pool.id + '-' + rangeType + '-' + centerTick.toString()
  let range = PopularTickRange.load(rangeId)

  if (range == null) {
    range = new PopularTickRange(rangeId)
    range.pool = pool.id
    range.rangeType = rangeType
    range.tickSpacing = tickSpacing
    range.lowerTick = lowerTick
    range.upperTick = upperTick
    range.centerTick = centerTick

    // Calculate prices using simple approximation
    // Use pool's current price as center
    let tickDiffLower = centerTick - lowerTick
    let tickDiffUpper = upperTick - centerTick

    range.priceCenter = pool.token0Price
    range.priceLower = pool.token0Price.times(tickToApproxPriceMultiplier(-tickDiffLower))
    range.priceUpper = pool.token0Price.times(tickToApproxPriceMultiplier(tickDiffUpper))

    range.priceRangePercent = calculatePriceRangePercent(range.priceLower, range.priceUpper, range.priceCenter)

    // Initialize metrics
    range.totalLiquidityUSD = ZERO_BD
    range.volume24h = ZERO_BD
    range.fees24h = ZERO_BD
    range.feeAPR24h = ZERO_BD
    range.impermanentLossRisk = ZERO_BD
    range.lastUpdate = blockTimestamp

    range.save()

    log.info('Created popular tick range {} for pool {}', [rangeId, pool.id])
  }

  return range as PopularTickRange
}

// Update range metrics when a swap occurs within it
export function updateRangeMetrics(
  pool: Pool,
  tick: i32,
  volumeUSD: BigDecimal,
  feesUSD: BigDecimal,
  blockTimestamp: BigInt
): void {
  // Estimate tick spacing from fee tier
  // 100 = 1 bp = 0.01% -> tick spacing ~1
  // 500 = 5 bp = 0.05% -> tick spacing ~10
  // 3000 = 30 bp = 0.3% -> tick spacing ~60
  // 10000 = 100 bp = 1% -> tick spacing ~200
  let feeTierNum = pool.feeTier.toI32()
  let tickSpacing = 1

  if (feeTierNum >= 10000) {
    tickSpacing = 200
  } else if (feeTierNum >= 3000) {
    tickSpacing = 60
  } else if (feeTierNum >= 500) {
    tickSpacing = 10
  } else {
    tickSpacing = 1
  }

  // Define range widths (in ticks)
  let narrowWidth = tickSpacing * 10
  let mediumWidth = tickSpacing * 50
  let wideWidth = tickSpacing * 200

  // Check and update narrow range
  updateSingleRange(pool, tick, narrowWidth, 'narrow', tickSpacing, volumeUSD, feesUSD, blockTimestamp)

  // Check and update medium range
  updateSingleRange(pool, tick, mediumWidth, 'medium', tickSpacing, volumeUSD, feesUSD, blockTimestamp)

  // Check and update wide range
  updateSingleRange(pool, tick, wideWidth, 'wide', tickSpacing, volumeUSD, feesUSD, blockTimestamp)
}

function updateSingleRange(
  pool: Pool,
  currentTick: i32,
  rangeWidth: i32,
  rangeType: string,
  tickSpacing: i32,
  volumeUSD: BigDecimal,
  feesUSD: BigDecimal,
  blockTimestamp: BigInt
): void {
  // Round to nearest tick spacing
  let centerTick = (currentTick / tickSpacing) * tickSpacing
  let lowerTick = centerTick - rangeWidth
  let upperTick = centerTick + rangeWidth

  let range = getOrCreatePopularTickRange(
    pool,
    lowerTick,
    upperTick,
    centerTick,
    rangeType,
    tickSpacing,
    blockTimestamp
  )

  // Update 24h metrics (simple accumulation - would need time-based decay in production)
  range.volume24h = range.volume24h.plus(volumeUSD)
  range.fees24h = range.fees24h.plus(feesUSD)

  // Update liquidity (use pool's current liquidity as proxy)
  range.totalLiquidityUSD = pool.totalValueLockedUSD

  // Calculate APR: (fees24h * 365) / liquidity * 100
  if (range.totalLiquidityUSD.gt(ZERO_BD)) {
    range.feeAPR24h = range.fees24h
      .times(BigDecimal.fromString('365'))
      .div(range.totalLiquidityUSD)
      .times(BigDecimal.fromString('100')) // Convert to percentage
  } else {
    range.feeAPR24h = ZERO_BD
  }

  // Calculate impermanent loss risk (simplified)
  // Higher price range % = higher IL risk
  range.impermanentLossRisk = range.priceRangePercent.div(BigDecimal.fromString('100'))

  range.lastUpdate = blockTimestamp
  range.save()
}

// Reset 24h metrics (should be called daily)
export function resetDailyMetrics(rangeId: string, blockTimestamp: BigInt): void {
  let range = PopularTickRange.load(rangeId)

  if (range != null) {
    range.volume24h = ZERO_BD
    range.fees24h = ZERO_BD
    range.feeAPR24h = ZERO_BD
    range.lastUpdate = blockTimestamp
    range.save()
  }
}