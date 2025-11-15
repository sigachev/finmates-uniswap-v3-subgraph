import { BigDecimal, BigInt, ethereum, log, Address } from '@graphprotocol/graph-ts'
import {
  Burn as BurnEvent,
  Initialize as InitializeEvent,
  Mint as MintEvent,
  Swap as SwapEvent,
  Flash as FlashEvent,
  Collect as CollectEvent,
  Pool
} from '../types/templates/Pool/Pool'
import {
  Bundle,
  Burn,
  Collect,
  Factory,
  Flash,
  Mint,
  Pool as PoolEntity,
  Tick,
  Token,
  Transaction,
  MintContext,
  Swap
} from '../types/schema'
import { convertTokenToDecimal, loadTransaction, safeDiv } from '../utils'
import { FACTORY_ADDRESS, ONE_BI, ZERO_BD, ZERO_BI } from '../utils/constants'
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTickDayData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData
} from '../utils/intervalUpdates'
import { createTick, feeTierToTickSpacing } from '../utils/tick'
import {
  findEthPerToken,
  getEthPriceInUSD,
  getTrackedAmountUSD,
  sqrtPriceX96ToTokenPrices
} from '../utils/pricing'

// Threshold for safe eth_call usage (blocks after this can use eth_call)
const SAFE_ETH_CALL_BLOCK = BigInt.fromI32(400000000)

// ========================================================================
// PERFORMANCE OPTIMIZATION: Price Update Throttling
// ========================================================================
// Update prices every N blocks instead of every swap to reduce expensive
// findEthPerToken() calls which loop through all whitelisted pools
const PRICE_UPDATE_BLOCK_INTERVAL = BigInt.fromI32(10)

// Simple modulo-based throttling (works in AssemblyScript)
// Returns true if we should update prices for this block number
function shouldUpdatePrices(blockNumber: BigInt): boolean {
  // Update prices every 10 blocks (blocks ending in 0)
  return blockNumber.mod(PRICE_UPDATE_BLOCK_INTERVAL).equals(ZERO_BI)
}
// ========================================================================

export function handleInitialize(event: InitializeEvent): void {
  let pool = PoolEntity.load(event.address.toHexString())
  if (pool === null) {
    log.error('Pool not found on initialize: {}', [event.address.toHexString()])
    return
  }

  pool.sqrtPrice = event.params.sqrtPriceX96
  pool.tick = BigInt.fromI32(event.params.tick)

  // Update token prices
  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)
  if (token0 !== null && token1 !== null) {
    let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
    pool.token0Price = prices[0]
    pool.token1Price = prices[1]
  }

  pool.save()

  // Update ETH price now that prices could have changed
  let bundle = Bundle.load('1')
  if (bundle !== null) {
    bundle.ethPriceUSD = getEthPriceInUSD()
    bundle.save()
  }
}

export function handleMint(event: MintEvent): void {
  let bundle = Bundle.load('1')!
  let poolAddress = event.address.toHexString()
  let pool = PoolEntity.load(poolAddress)
  let factory = Factory.load(FACTORY_ADDRESS)

  if (pool === null || factory === null) {
    log.error('Pool or factory not found in handleMint', [])
    return
  }

  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 === null || token1 === null) {
    log.error('Tokens not found in handleMint', [])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  let amount0USD = amount0.times(token0.derivedETH.times(bundle.ethPriceUSD))
  let amount1USD = amount1.times(token1.derivedETH.times(bundle.ethPriceUSD))

  // Reset tvl aggregates until new amounts calculated
  factory.totalValueLockedETH = factory.totalValueLockedETH.minus(pool.totalValueLockedETH)

  // Update globals
  factory.txCount = factory.txCount.plus(ONE_BI)

  // Update token0 data
  token0.txCount = token0.txCount.plus(ONE_BI)
  token0.totalValueLocked = token0.totalValueLocked.plus(amount0)
  token0.totalValueLockedUSD = token0.totalValueLocked.times(token0.derivedETH.times(bundle.ethPriceUSD))

  // Update token1 data
  token1.txCount = token1.txCount.plus(ONE_BI)
  token1.totalValueLocked = token1.totalValueLocked.plus(amount1)
  token1.totalValueLockedUSD = token1.totalValueLocked.times(token1.derivedETH.times(bundle.ethPriceUSD))

  // Pool data
  pool.txCount = pool.txCount.plus(ONE_BI)

  // Pools liquidity tracks the currently active liquidity given pools current tick
  // We only want to update it on mint if the position being minted includes the current tick
  if (
    pool.tick !== null &&
    BigInt.fromI32(event.params.tickLower).le(pool.tick as BigInt) &&
    BigInt.fromI32(event.params.tickUpper).gt(pool.tick as BigInt)
  ) {
    pool.liquidity = pool.liquidity.plus(event.params.amount)
  }

  pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0)
  pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1)
  pool.totalValueLockedETH = pool.totalValueLockedToken0
    .times(token0.derivedETH)
    .plus(pool.totalValueLockedToken1.times(token1.derivedETH))
  pool.totalValueLockedUSD = pool.totalValueLockedETH.times(bundle.ethPriceUSD)

  // Reset aggregates with new amounts
  factory.totalValueLockedETH = factory.totalValueLockedETH.plus(pool.totalValueLockedETH)
  factory.totalValueLockedUSD = factory.totalValueLockedETH.times(bundle.ethPriceUSD)

  // Create Mint entity
  let transaction = loadTransaction(event)
  let mint = new Mint(transaction.id + '#' + pool.txCount.toString())
  mint.transaction = transaction.id
  mint.timestamp = transaction.timestamp
  mint.pool = pool.id
  mint.token0 = pool.token0
  mint.token1 = pool.token1
  mint.owner = event.params.owner
  mint.sender = event.params.sender
  mint.origin = event.transaction.from
  mint.amount = event.params.amount
  mint.amount0 = amount0
  mint.amount1 = amount1
  mint.amountUSD = amount0USD.plus(amount1USD)
  mint.tickLower = BigInt.fromI32(event.params.tickLower)
  mint.tickUpper = BigInt.fromI32(event.params.tickUpper)
  mint.logIndex = event.logIndex

  // Tick entities
  let lowerTickIdx = event.params.tickLower
  let upperTickIdx = event.params.tickUpper

  let lowerTickId = poolAddress + '#' + BigInt.fromI32(lowerTickIdx as i32).toString()
  let upperTickId = poolAddress + '#' + BigInt.fromI32(upperTickIdx as i32).toString()

  let lowerTick = Tick.load(lowerTickId)
  let upperTick = Tick.load(upperTickId)

  if (lowerTick === null) {
    lowerTick = createTick(lowerTickId, lowerTickIdx, pool.id, event)
  }

  if (upperTick === null) {
    upperTick = createTick(upperTickId, upperTickIdx, pool.id, event)
  }

  lowerTick.liquidityGross = lowerTick.liquidityGross.plus(event.params.amount)
  lowerTick.liquidityNet = lowerTick.liquidityNet.plus(event.params.amount)
  upperTick.liquidityGross = upperTick.liquidityGross.plus(event.params.amount)
  upperTick.liquidityNet = upperTick.liquidityNet.minus(event.params.amount)

  // Tick entities
  updateTickDayData(lowerTick!, event)
  updateTickDayData(upperTick!, event)

  // Update day and hour data
  let uniswapDayData = updateUniswapDayData(event)
  let poolDayData = updatePoolDayData(event)
  let poolHourData = updatePoolHourData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)
  let token0HourData = updateTokenHourData(token0 as Token, event)
  let token1HourData = updateTokenHourData(token1 as Token, event)

  // Update TVL metrics
  token0DayData.totalValueLocked = token0.totalValueLocked
  token0DayData.totalValueLockedUSD = token0.totalValueLockedUSD
  token0HourData.totalValueLocked = token0.totalValueLocked
  token0HourData.totalValueLockedUSD = token0.totalValueLockedUSD

  token1DayData.totalValueLocked = token1.totalValueLocked
  token1DayData.totalValueLockedUSD = token1.totalValueLockedUSD
  token1HourData.totalValueLocked = token1.totalValueLocked
  token1HourData.totalValueLockedUSD = token1.totalValueLockedUSD

  uniswapDayData.tvlUSD = factory.totalValueLockedUSD
  poolDayData.tvlUSD = pool.totalValueLockedUSD
  poolHourData.tvlUSD = pool.totalValueLockedUSD

  // Save entities
  token0.save()
  token1.save()
  pool.save()
  factory.save()
  mint.save()

  // Update interval data
  token0DayData.save()
  token1DayData.save()
  uniswapDayData.save()
  poolDayData.save()
  poolHourData.save()
  token0HourData.save()
  token1HourData.save()

  lowerTick!.save()
  upperTick!.save()
}

export function handleBurn(event: BurnEvent): void {
  let bundle = Bundle.load('1')!
  let poolAddress = event.address.toHexString()
  let pool = PoolEntity.load(poolAddress)
  let factory = Factory.load(FACTORY_ADDRESS)

  if (pool === null || factory === null) {
    log.error('Pool or factory not found in handleBurn', [])
    return
  }

  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 === null || token1 === null) {
    log.error('Tokens not found in handleBurn', [])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  let amount0USD = amount0.times(token0.derivedETH.times(bundle.ethPriceUSD))
  let amount1USD = amount1.times(token1.derivedETH.times(bundle.ethPriceUSD))

  // Reset tvl aggregates until new amounts calculated
  factory.totalValueLockedETH = factory.totalValueLockedETH.minus(pool.totalValueLockedETH)

  // Update globals
  factory.txCount = factory.txCount.plus(ONE_BI)

  // Update token0 data
  token0.txCount = token0.txCount.plus(ONE_BI)
  token0.totalValueLocked = token0.totalValueLocked.minus(amount0)
  token0.totalValueLockedUSD = token0.totalValueLocked.times(token0.derivedETH.times(bundle.ethPriceUSD))

  // Update token1 data
  token1.txCount = token1.txCount.plus(ONE_BI)
  token1.totalValueLocked = token1.totalValueLocked.minus(amount1)
  token1.totalValueLockedUSD = token1.totalValueLocked.times(token1.derivedETH.times(bundle.ethPriceUSD))

  // Pool data
  pool.txCount = pool.txCount.plus(ONE_BI)

  // Pools liquidity tracks the currently active liquidity given pools current tick
  // We only want to update it on burn if the position being burnt includes the current tick
  if (
    pool.tick !== null &&
    BigInt.fromI32(event.params.tickLower).le(pool.tick as BigInt) &&
    BigInt.fromI32(event.params.tickUpper).gt(pool.tick as BigInt)
  ) {
    pool.liquidity = pool.liquidity.minus(event.params.amount)
  }

  pool.totalValueLockedToken0 = pool.totalValueLockedToken0.minus(amount0)
  pool.totalValueLockedToken1 = pool.totalValueLockedToken1.minus(amount1)
  pool.totalValueLockedETH = pool.totalValueLockedToken0
    .times(token0.derivedETH)
    .plus(pool.totalValueLockedToken1.times(token1.derivedETH))
  pool.totalValueLockedUSD = pool.totalValueLockedETH.times(bundle.ethPriceUSD)

  // Reset aggregates with new amounts
  factory.totalValueLockedETH = factory.totalValueLockedETH.plus(pool.totalValueLockedETH)
  factory.totalValueLockedUSD = factory.totalValueLockedETH.times(bundle.ethPriceUSD)

  // Burn entity
  let transaction = loadTransaction(event)
  let burn = new Burn(transaction.id + '#' + pool.txCount.toString())
  burn.transaction = transaction.id
  burn.timestamp = transaction.timestamp
  burn.pool = pool.id
  burn.token0 = pool.token0
  burn.token1 = pool.token1
  burn.owner = event.params.owner
  burn.origin = event.transaction.from
  burn.amount = event.params.amount
  burn.amount0 = amount0
  burn.amount1 = amount1
  burn.amountUSD = amount0USD.plus(amount1USD)
  burn.tickLower = BigInt.fromI32(event.params.tickLower)
  burn.tickUpper = BigInt.fromI32(event.params.tickUpper)
  burn.logIndex = event.logIndex

  // Update tick entities
  let lowerTickId = poolAddress + '#' + BigInt.fromI32(event.params.tickLower).toString()
  let upperTickId = poolAddress + '#' + BigInt.fromI32(event.params.tickUpper).toString()
  let lowerTick = Tick.load(lowerTickId)
  let upperTick = Tick.load(upperTickId)

  if (lowerTick !== null && upperTick !== null) {
    lowerTick.liquidityGross = lowerTick.liquidityGross.minus(event.params.amount)
    lowerTick.liquidityNet = lowerTick.liquidityNet.minus(event.params.amount)
    upperTick.liquidityGross = upperTick.liquidityGross.minus(event.params.amount)
    upperTick.liquidityNet = upperTick.liquidityNet.plus(event.params.amount)

    lowerTick.save()
    upperTick.save()
  }

  // Update day and hour data
  let uniswapDayData = updateUniswapDayData(event)
  let poolDayData = updatePoolDayData(event)
  let poolHourData = updatePoolHourData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)
  let token0HourData = updateTokenHourData(token0 as Token, event)
  let token1HourData = updateTokenHourData(token1 as Token, event)

  // Update TVL metrics
  token0DayData.totalValueLocked = token0.totalValueLocked
  token0DayData.totalValueLockedUSD = token0.totalValueLockedUSD
  token0HourData.totalValueLocked = token0.totalValueLocked
  token0HourData.totalValueLockedUSD = token0.totalValueLockedUSD

  token1DayData.totalValueLocked = token1.totalValueLocked
  token1DayData.totalValueLockedUSD = token1.totalValueLockedUSD
  token1HourData.totalValueLocked = token1.totalValueLocked
  token1HourData.totalValueLockedUSD = token1.totalValueLockedUSD

  uniswapDayData.tvlUSD = factory.totalValueLockedUSD
  poolDayData.tvlUSD = pool.totalValueLockedUSD
  poolHourData.tvlUSD = pool.totalValueLockedUSD

  // Save entities
  token0.save()
  token1.save()
  pool.save()
  factory.save()
  burn.save()

  // Interval data
  uniswapDayData.save()
  poolDayData.save()
  poolHourData.save()
  token0DayData.save()
  token1DayData.save()
  token0HourData.save()
  token1HourData.save()
}

export function handleSwap(event: SwapEvent): void {
  let bundle = Bundle.load('1')!
  let factory = Factory.load(FACTORY_ADDRESS)!
  let pool = PoolEntity.load(event.address.toHexString())

  // Return if pool doesn't exist (shouldn't happen)
  if (pool === null) {
    log.warning('Pool not found for swap event: {}', [event.address.toHexString()])
    return
  }

  // Hot fix for bad pricing
  if (pool.id == '0x9663f2ca0454accad3e094448ea6f77443880454') {
    return
  }

  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for pool: {}', [pool.id])
    return
  }

  // Amounts from event - token0 amount
  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  // Token1 amount
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // Need absolute amounts for volume
  let amount0Abs = amount0
  if (amount0.lt(ZERO_BD)) {
    amount0Abs = amount0.times(BigInt.fromI32(-1).toBigDecimal())
  }
  let amount1Abs = amount1
  if (amount1.lt(ZERO_BD)) {
    amount1Abs = amount1.times(BigInt.fromI32(-1).toBigDecimal())
  }

  let amount0ETH = amount0Abs.times(token0.derivedETH)
  let amount1ETH = amount1Abs.times(token1.derivedETH)
  let amount0USD = amount0ETH.times(bundle.ethPriceUSD)
  let amount1USD = amount1ETH.times(bundle.ethPriceUSD)

  // Get amount that should be tracked only - div 2 because cant count both input and output as volume
  let amountTotalUSDTracked = getTrackedAmountUSD(amount0Abs, token0 as Token, amount1Abs, token1 as Token).div(
    BigInt.fromI32(2).toBigDecimal()
  )
  let amountTotalETHTracked = safeDiv(amountTotalUSDTracked, bundle.ethPriceUSD)
  let amountTotalUSDUntracked = amount0USD.plus(amount1USD).div(BigInt.fromI32(2).toBigDecimal())

  let feesETH = amountTotalETHTracked.times(pool.feeTier.toBigDecimal()).div(BigInt.fromI32(1000000).toBigDecimal())
  let feesUSD = amountTotalUSDTracked.times(pool.feeTier.toBigDecimal()).div(BigInt.fromI32(1000000).toBigDecimal())

  // Global updates
  factory.txCount = factory.txCount.plus(ONE_BI)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(amountTotalETHTracked)
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(amountTotalUSDTracked)
  factory.untrackedVolumeUSD = factory.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
  factory.totalFeesETH = factory.totalFeesETH.plus(feesETH)
  factory.totalFeesUSD = factory.totalFeesUSD.plus(feesUSD)

  // Pool volume
  pool.volumeToken0 = pool.volumeToken0.plus(amount0Abs)
  pool.volumeToken1 = pool.volumeToken1.plus(amount1Abs)
  pool.volumeUSD = pool.volumeUSD.plus(amountTotalUSDTracked)
  pool.untrackedVolumeUSD = pool.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
  pool.feesUSD = pool.feesUSD.plus(feesUSD)
  pool.txCount = pool.txCount.plus(ONE_BI)

  // Update the pool with new active liquidity, price, and tick - from event params
  pool.liquidity = event.params.liquidity
  pool.tick = BigInt.fromI32(event.params.tick as i32)
  pool.sqrtPrice = event.params.sqrtPriceX96

  // Update token prices based on swap
  let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
  pool.token0Price = prices[0]
  pool.token1Price = prices[1]

  // ========================================================================
  // BLOCK-AWARE FEE GROWTH UPDATE
  // ========================================================================
  // Only query pool contract for fee growth on recent blocks
  // Old blocks will fail with "missing trie node" or "l2 gas depth limit exceeded"
  if (event.block.number.gt(SAFE_ETH_CALL_BLOCK)) {
    // Recent blocks: safe to use eth_call
    let poolContract = Pool.bind(event.address)

    // Try to get feeGrowthGlobal0X128
    let feeGrowth0Result = poolContract.try_feeGrowthGlobal0X128()
    if (!feeGrowth0Result.reverted) {
      pool.feeGrowthGlobal0X128 = feeGrowth0Result.value
    } else {
      log.warning('feeGrowthGlobal0X128 call reverted for pool {} at block {}', [
        pool.id,
        event.block.number.toString()
      ])
    }

    // Try to get feeGrowthGlobal1X128
    let feeGrowth1Result = poolContract.try_feeGrowthGlobal1X128()
    if (!feeGrowth1Result.reverted) {
      pool.feeGrowthGlobal1X128 = feeGrowth1Result.value
    } else {
      log.warning('feeGrowthGlobal1X128 call reverted for pool {} at block {}', [
        pool.id,
        event.block.number.toString()
      ])
    }
  }
  // ========================================================================

  pool.save()

  // Update token volumes
  token0.volume = token0.volume.plus(amount0Abs)
  token0.totalValueLocked = token0.totalValueLocked.plus(amount0)
  token0.volumeUSD = token0.volumeUSD.plus(amountTotalUSDTracked)
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
  token0.feesUSD = token0.feesUSD.plus(feesUSD)
  token0.txCount = token0.txCount.plus(ONE_BI)

  token1.volume = token1.volume.plus(amount1Abs)
  token1.totalValueLocked = token1.totalValueLocked.plus(amount1)
  token1.volumeUSD = token1.volumeUSD.plus(amountTotalUSDTracked)
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(amountTotalUSDUntracked)
  token1.feesUSD = token1.feesUSD.plus(feesUSD)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // ========================================================================
  // PERFORMANCE OPTIMIZATION: Conditional Price Updates
  // ========================================================================
  // Only update derivedETH prices every 10 blocks (blocks ending in 0)
  // This avoids expensive findEthPerToken() calls on every swap
  if (shouldUpdatePrices(event.block.number)) {
    // Update USD pricing
    bundle.ethPriceUSD = getEthPriceInUSD()
    bundle.save()
    token0.derivedETH = findEthPerToken(token0 as Token)
    token1.derivedETH = findEthPerToken(token1 as Token)
  }
  // ========================================================================

  // Get tracked liquidity - will be used for fee APR calculations
  pool.totalValueLockedETH = pool.totalValueLockedToken0
    .times(token0.derivedETH)
    .plus(pool.totalValueLockedToken1.times(token1.derivedETH))
  pool.totalValueLockedUSD = pool.totalValueLockedETH.times(bundle.ethPriceUSD)

  // Reset aggregates with new amounts
  factory.totalValueLockedETH = factory.totalValueLockedETH.plus(pool.totalValueLockedETH)
  factory.totalValueLockedUSD = factory.totalValueLockedETH.times(bundle.ethPriceUSD)

  token0.totalValueLockedUSD = token0.totalValueLocked.times(token0.derivedETH).times(bundle.ethPriceUSD)
  token1.totalValueLockedUSD = token1.totalValueLocked.times(token1.derivedETH).times(bundle.ethPriceUSD)

  // Create Swap event
  let transaction = loadTransaction(event)
  let swap = new Swap(transaction.id + '#' + pool.txCount.toString())
  swap.transaction = transaction.id
  swap.timestamp = transaction.timestamp
  swap.pool = pool.id
  swap.token0 = pool.token0
  swap.token1 = pool.token1
  swap.sender = event.params.sender
  swap.origin = event.transaction.from
  swap.recipient = event.params.recipient
  swap.amount0 = amount0
  swap.amount1 = amount1
  swap.amountUSD = amountTotalUSDTracked
  swap.tick = BigInt.fromI32(event.params.tick as i32)
  swap.sqrtPriceX96 = event.params.sqrtPriceX96
  swap.logIndex = event.logIndex

  // Interval data
  let uniswapDayData = updateUniswapDayData(event)
  let poolDayData = updatePoolDayData(event)
  let poolHourData = updatePoolHourData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)
  let token0HourData = updateTokenHourData(token0 as Token, event)
  let token1HourData = updateTokenHourData(token1 as Token, event)

  // Update volume metrics
  uniswapDayData.volumeETH = uniswapDayData.volumeETH.plus(amountTotalETHTracked)
  uniswapDayData.volumeUSD = uniswapDayData.volumeUSD.plus(amountTotalUSDTracked)
  uniswapDayData.feesUSD = uniswapDayData.feesUSD.plus(feesUSD)

  poolDayData.volumeUSD = poolDayData.volumeUSD.plus(amountTotalUSDTracked)
  poolDayData.volumeToken0 = poolDayData.volumeToken0.plus(amount0Abs)
  poolDayData.volumeToken1 = poolDayData.volumeToken1.plus(amount1Abs)
  poolDayData.feesUSD = poolDayData.feesUSD.plus(feesUSD)

  poolHourData.volumeUSD = poolHourData.volumeUSD.plus(amountTotalUSDTracked)
  poolHourData.volumeToken0 = poolHourData.volumeToken0.plus(amount0Abs)
  poolHourData.volumeToken1 = poolHourData.volumeToken1.plus(amount1Abs)
  poolHourData.feesUSD = poolHourData.feesUSD.plus(feesUSD)

  token0DayData.volume = token0DayData.volume.plus(amount0Abs)
  token0DayData.volumeUSD = token0DayData.volumeUSD.plus(amountTotalUSDTracked)
  token0DayData.untrackedVolumeUSD = token0DayData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
  token0DayData.feesUSD = token0DayData.feesUSD.plus(feesUSD)

  token0HourData.volume = token0HourData.volume.plus(amount0Abs)
  token0HourData.volumeUSD = token0HourData.volumeUSD.plus(amountTotalUSDTracked)
  token0HourData.untrackedVolumeUSD = token0HourData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
  token0HourData.feesUSD = token0HourData.feesUSD.plus(feesUSD)

  token1DayData.volume = token1DayData.volume.plus(amount1Abs)
  token1DayData.volumeUSD = token1DayData.volumeUSD.plus(amountTotalUSDTracked)
  token1DayData.untrackedVolumeUSD = token1DayData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
  token1DayData.feesUSD = token1DayData.feesUSD.plus(feesUSD)

  token1HourData.volume = token1HourData.volume.plus(amount1Abs)
  token1HourData.volumeUSD = token1HourData.volumeUSD.plus(amountTotalUSDTracked)
  token1HourData.untrackedVolumeUSD = token1HourData.untrackedVolumeUSD.plus(amountTotalUSDTracked)
  token1HourData.feesUSD = token1HourData.feesUSD.plus(feesUSD)

  // Update TVL metrics
  uniswapDayData.tvlUSD = factory.totalValueLockedUSD
  poolDayData.tvlUSD = pool.totalValueLockedUSD
  poolHourData.tvlUSD = pool.totalValueLockedUSD
  poolDayData.liquidity = pool.liquidity
  poolHourData.liquidity = pool.liquidity
  poolDayData.sqrtPrice = pool.sqrtPrice
  poolHourData.sqrtPrice = pool.sqrtPrice
  poolDayData.token0Price = pool.token0Price
  poolHourData.token0Price = pool.token0Price
  poolDayData.token1Price = pool.token1Price
  poolHourData.token1Price = pool.token1Price
  poolDayData.tick = pool.tick
  poolHourData.tick = pool.tick
  poolDayData.feeGrowthGlobal0X128 = pool.feeGrowthGlobal0X128
  poolHourData.feeGrowthGlobal0X128 = pool.feeGrowthGlobal0X128
  poolDayData.feeGrowthGlobal1X128 = pool.feeGrowthGlobal1X128
  poolHourData.feeGrowthGlobal1X128 = pool.feeGrowthGlobal1X128
  poolDayData.txCount = poolDayData.txCount.plus(ONE_BI)
  poolHourData.txCount = poolHourData.txCount.plus(ONE_BI)

  token0DayData.totalValueLocked = token0.totalValueLocked
  token0DayData.totalValueLockedUSD = token0.totalValueLockedUSD
  token0HourData.totalValueLocked = token0.totalValueLocked
  token0HourData.totalValueLockedUSD = token0.totalValueLockedUSD

  token1DayData.totalValueLocked = token1.totalValueLocked
  token1DayData.totalValueLockedUSD = token1.totalValueLockedUSD
  token1HourData.totalValueLocked = token1.totalValueLocked
  token1HourData.totalValueLockedUSD = token1.totalValueLockedUSD

  // Save entities in optimal order (most frequently accessed first)
  token0.save()
  token1.save()
  pool.save()
  factory.save()
  swap.save()

  // Save interval data
  uniswapDayData.save()
  poolDayData.save()
  poolHourData.save()
  token0DayData.save()
  token1DayData.save()
  token0HourData.save()
  token1HourData.save()
}

export function handleFlash(event: FlashEvent): void {
  // Update txn counts
  let pool = PoolEntity.load(event.address.toHexString())
  if (pool === null) {
    log.warning('Pool not found for flash event: {}', [event.address.toHexString()])
    return
  }

  let factory = Factory.load(FACTORY_ADDRESS)
  if (factory === null) {
    log.warning('Factory not found for flash event', [])
    return
  }

  // Update txn counts
  pool.txCount = pool.txCount.plus(ONE_BI)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // Get amounts
  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for flash event in pool: {}', [pool.id])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)
  let paid0 = convertTokenToDecimal(event.params.paid0, token0.decimals)
  let paid1 = convertTokenToDecimal(event.params.paid1, token1.decimals)

  // Create Flash entity
  let transaction = loadTransaction(event)
  let flash = new Flash(transaction.id + '#' + pool.txCount.toString())
  flash.transaction = transaction.id
  flash.timestamp = transaction.timestamp
  flash.pool = pool.id
  flash.sender = event.params.sender
  flash.recipient = event.params.recipient
  flash.amount0 = amount0
  flash.amount1 = amount1
  flash.amount0Paid = paid0
  flash.amount1Paid = paid1
  flash.logIndex = event.logIndex

  // Save entities
  flash.save()
  pool.save()
  factory.save()
}

export function handleCollect(event: CollectEvent): void {
  let pool = PoolEntity.load(event.address.toHexString())

  if (pool === null) {
    log.warning('Pool not found for collect event: {}', [event.address.toHexString()])
    return
  }

  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for collect event in pool: {}', [pool.id])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // Create Collect entity
  let transaction = loadTransaction(event)
  let collect = new Collect(transaction.id + '#' + pool.txCount.toString())
  collect.transaction = transaction.id
  collect.timestamp = transaction.timestamp
  collect.pool = pool.id
  collect.owner = event.params.owner
  collect.tickLower = BigInt.fromI32(event.params.tickLower)
  collect.tickUpper = BigInt.fromI32(event.params.tickUpper)
  collect.amount0 = amount0
  collect.amount1 = amount1
  collect.logIndex = event.logIndex

  // Save entity
  collect.save()
}