import { ZERO_BD, ZERO_BI, ONE_BI } from './constants'
/* eslint-disable prefer-const */
import {
  UniswapDayData,
  Factory,
  Pool,
  PoolDayData,
  Token,
  TokenDayData,
  TokenHourData,
  Bundle,
  PoolHourData,
  TickDayData,
  Tick
} from './../types/schema'
import { FACTORY_ADDRESS } from './constants'
import { ethereum } from '@graphprotocol/graph-ts'

/**
 * Tracks global aggregate data over daily windows
 * @param event
 */
export function updateUniswapDayData(event: ethereum.Event): UniswapDayData {
  let uniswap = Factory.load(FACTORY_ADDRESS)
  if (uniswap == null) {
    // This should not happen, but we need to handle it
    uniswap = new Factory(FACTORY_ADDRESS)
    uniswap.poolCount = ZERO_BI
    uniswap.txCount = ZERO_BI
    uniswap.totalVolumeUSD = ZERO_BD
    uniswap.totalVolumeETH = ZERO_BD
    uniswap.totalFeesUSD = ZERO_BD
    uniswap.totalFeesETH = ZERO_BD
    uniswap.untrackedVolumeUSD = ZERO_BD
    uniswap.totalValueLockedUSD = ZERO_BD
    uniswap.totalValueLockedETH = ZERO_BD
    uniswap.totalValueLockedUSDUntracked = ZERO_BD
    uniswap.totalValueLockedETHUntracked = ZERO_BD
    uniswap.owner = '0x0000000000000000000000000000000000000000'
    uniswap.save()
  }

  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400 // rounded
  let dayStartTimestamp = dayID * 86400
  let uniswapDayData = UniswapDayData.load(dayID.toString())
  if (uniswapDayData === null) {
    uniswapDayData = new UniswapDayData(dayID.toString())
    uniswapDayData.date = dayStartTimestamp
    uniswapDayData.volumeETH = ZERO_BD
    uniswapDayData.volumeUSD = ZERO_BD
    uniswapDayData.volumeUSDUntracked = ZERO_BD
    uniswapDayData.feesUSD = ZERO_BD
  }
  uniswapDayData.tvlUSD = uniswap.totalValueLockedUSD
  uniswapDayData.txCount = uniswap.txCount
  uniswapDayData.save()
  return uniswapDayData as UniswapDayData
}

export function updatePoolDayData(event: ethereum.Event): PoolDayData {
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let dayPoolID = event.address
      .toHexString()
      .concat('-')
      .concat(dayID.toString())
  let pool = Pool.load(event.address.toHexString())
  if (pool == null) {
    // This should not happen in normal flow, but we need to handle it
    // Return a default PoolDayData or handle appropriately
    let poolDayData = new PoolDayData(dayPoolID)
    poolDayData.date = dayStartTimestamp
    poolDayData.pool = event.address.toHexString()
    poolDayData.volumeToken0 = ZERO_BD
    poolDayData.volumeToken1 = ZERO_BD
    poolDayData.volumeUSD = ZERO_BD
    poolDayData.feesUSD = ZERO_BD
    poolDayData.txCount = ZERO_BI
    poolDayData.feeGrowthGlobal0X128 = ZERO_BI
    poolDayData.feeGrowthGlobal1X128 = ZERO_BI
    poolDayData.open = ZERO_BD
    poolDayData.high = ZERO_BD
    poolDayData.low = ZERO_BD
    poolDayData.close = ZERO_BD
    poolDayData.liquidity = ZERO_BI
    poolDayData.sqrtPrice = ZERO_BI
    poolDayData.token0Price = ZERO_BD
    poolDayData.token1Price = ZERO_BD
    poolDayData.tick = ZERO_BI
    poolDayData.tvlUSD = ZERO_BD
    poolDayData.save()
    return poolDayData
  }

  let poolDayData = PoolDayData.load(dayPoolID)
  if (poolDayData === null) {
    poolDayData = new PoolDayData(dayPoolID)
    poolDayData.date = dayStartTimestamp
    poolDayData.pool = pool.id
    // things that dont get initialized always
    poolDayData.volumeToken0 = ZERO_BD
    poolDayData.volumeToken1 = ZERO_BD
    poolDayData.volumeUSD = ZERO_BD
    poolDayData.feesUSD = ZERO_BD
    poolDayData.txCount = ZERO_BI
    poolDayData.feeGrowthGlobal0X128 = ZERO_BI
    poolDayData.feeGrowthGlobal1X128 = ZERO_BI
    poolDayData.open = pool.token0Price
    poolDayData.high = pool.token0Price
    poolDayData.low = pool.token0Price
    poolDayData.close = pool.token0Price
  }

  if (pool.token0Price.gt(poolDayData.high)) {
    poolDayData.high = pool.token0Price
  }
  if (pool.token0Price.lt(poolDayData.low)) {
    poolDayData.low = pool.token0Price
  }

  poolDayData.liquidity = pool.liquidity
  poolDayData.sqrtPrice = pool.sqrtPrice
  poolDayData.feeGrowthGlobal0X128 = pool.feeGrowthGlobal0X128
  poolDayData.feeGrowthGlobal1X128 = pool.feeGrowthGlobal1X128
  poolDayData.token0Price = pool.token0Price
  poolDayData.token1Price = pool.token1Price
  poolDayData.tick = pool.tick
  poolDayData.tvlUSD = pool.totalValueLockedUSD
  poolDayData.txCount = poolDayData.txCount.plus(ONE_BI)
  poolDayData.save()

  return poolDayData as PoolDayData
}

export function updatePoolHourData(event: ethereum.Event): PoolHourData {
  let timestamp = event.block.timestamp.toI32()
  let hourIndex = timestamp / 3600 // get unique hour within unix history
  let hourStartUnix = hourIndex * 3600 // want the rounded effect
  let hourPoolID = event.address
      .toHexString()
      .concat('-')
      .concat(hourIndex.toString())
  let pool = Pool.load(event.address.toHexString())
  if (pool == null) {
    // This should not happen in normal flow, but we need to handle it
    let poolHourData = new PoolHourData(hourPoolID)
    poolHourData.periodStartUnix = hourStartUnix
    poolHourData.pool = event.address.toHexString()
    poolHourData.volumeToken0 = ZERO_BD
    poolHourData.volumeToken1 = ZERO_BD
    poolHourData.volumeUSD = ZERO_BD
    poolHourData.txCount = ZERO_BI
    poolHourData.feesUSD = ZERO_BD
    poolHourData.feeGrowthGlobal0X128 = ZERO_BI
    poolHourData.feeGrowthGlobal1X128 = ZERO_BI
    poolHourData.open = ZERO_BD
    poolHourData.high = ZERO_BD
    poolHourData.low = ZERO_BD
    poolHourData.close = ZERO_BD
    poolHourData.liquidity = ZERO_BI
    poolHourData.sqrtPrice = ZERO_BI
    poolHourData.token0Price = ZERO_BD
    poolHourData.token1Price = ZERO_BD
    poolHourData.tick = ZERO_BI
    poolHourData.tvlUSD = ZERO_BD
    poolHourData.save()
    return poolHourData
  }

  let poolHourData = PoolHourData.load(hourPoolID)
  if (poolHourData === null) {
    poolHourData = new PoolHourData(hourPoolID)
    poolHourData.periodStartUnix = hourStartUnix
    poolHourData.pool = pool.id
    // things that dont get initialized always
    poolHourData.volumeToken0 = ZERO_BD
    poolHourData.volumeToken1 = ZERO_BD
    poolHourData.volumeUSD = ZERO_BD
    poolHourData.txCount = ZERO_BI
    poolHourData.feesUSD = ZERO_BD
    poolHourData.feeGrowthGlobal0X128 = ZERO_BI
    poolHourData.feeGrowthGlobal1X128 = ZERO_BI
    poolHourData.open = pool.token0Price
    poolHourData.high = pool.token0Price
    poolHourData.low = pool.token0Price
    poolHourData.close = pool.token0Price
  }

  if (pool.token0Price.gt(poolHourData.high)) {
    poolHourData.high = pool.token0Price
  }
  if (pool.token0Price.lt(poolHourData.low)) {
    poolHourData.low = pool.token0Price
  }

  poolHourData.liquidity = pool.liquidity
  poolHourData.sqrtPrice = pool.sqrtPrice
  poolHourData.token0Price = pool.token0Price
  poolHourData.token1Price = pool.token1Price
  poolHourData.feeGrowthGlobal0X128 = pool.feeGrowthGlobal0X128
  poolHourData.feeGrowthGlobal1X128 = pool.feeGrowthGlobal1X128
  poolHourData.close = pool.token0Price
  poolHourData.tick = pool.tick
  poolHourData.tvlUSD = pool.totalValueLockedUSD
  poolHourData.txCount = poolHourData.txCount.plus(ONE_BI)
  poolHourData.save()

  // test
  return poolHourData as PoolHourData
}

export function updateTokenDayData(token: Token, event: ethereum.Event): TokenDayData {
  let bundle = Bundle.load('1')
  if (bundle == null) {
    bundle = new Bundle('1')
    bundle.ethPriceUSD = ZERO_BD
    bundle.save()
  }

  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let tokenDayID = token.id
      .toString()
      .concat('-')
      .concat(dayID.toString())
  let tokenPrice = token.derivedETH.times(bundle.ethPriceUSD)

  let tokenDayData = TokenDayData.load(tokenDayID)
  if (tokenDayData === null) {
    tokenDayData = new TokenDayData(tokenDayID)
    tokenDayData.date = dayStartTimestamp
    tokenDayData.token = token.id
    tokenDayData.volume = ZERO_BD
    tokenDayData.volumeUSD = ZERO_BD
    tokenDayData.feesUSD = ZERO_BD
    tokenDayData.untrackedVolumeUSD = ZERO_BD
    tokenDayData.open = tokenPrice
    tokenDayData.high = tokenPrice
    tokenDayData.low = tokenPrice
    tokenDayData.close = tokenPrice
  }

  if (tokenPrice.gt(tokenDayData.high)) {
    tokenDayData.high = tokenPrice
  }

  if (tokenPrice.lt(tokenDayData.low)) {
    tokenDayData.low = tokenPrice
  }

  tokenDayData.close = tokenPrice
  tokenDayData.priceUSD = token.derivedETH.times(bundle.ethPriceUSD)
  tokenDayData.totalValueLocked = token.totalValueLocked
  tokenDayData.totalValueLockedUSD = token.totalValueLockedUSD
  tokenDayData.save()

  return tokenDayData as TokenDayData
}

export function updateTokenHourData(token: Token, event: ethereum.Event): TokenHourData {
  let bundle = Bundle.load('1')
  if (bundle == null) {
    bundle = new Bundle('1')
    bundle.ethPriceUSD = ZERO_BD
    bundle.save()
  }

  let timestamp = event.block.timestamp.toI32()
  let hourIndex = timestamp / 3600 // get unique hour within unix history
  let hourStartUnix = hourIndex * 3600 // want the rounded effect
  let tokenHourID = token.id
      .toString()
      .concat('-')
      .concat(hourIndex.toString())
  let tokenHourData = TokenHourData.load(tokenHourID)
  let tokenPrice = token.derivedETH.times(bundle.ethPriceUSD)

  if (tokenHourData === null) {
    tokenHourData = new TokenHourData(tokenHourID)
    tokenHourData.periodStartUnix = hourStartUnix
    tokenHourData.token = token.id
    tokenHourData.volume = ZERO_BD
    tokenHourData.volumeUSD = ZERO_BD
    tokenHourData.untrackedVolumeUSD = ZERO_BD
    tokenHourData.feesUSD = ZERO_BD
    tokenHourData.open = tokenPrice
    tokenHourData.high = tokenPrice
    tokenHourData.low = tokenPrice
    tokenHourData.close = tokenPrice
  }

  if (tokenPrice.gt(tokenHourData.high)) {
    tokenHourData.high = tokenPrice
  }

  if (tokenPrice.lt(tokenHourData.low)) {
    tokenHourData.low = tokenPrice
  }

  tokenHourData.close = tokenPrice
  tokenHourData.priceUSD = tokenPrice
  tokenHourData.totalValueLocked = token.totalValueLocked
  tokenHourData.totalValueLockedUSD = token.totalValueLockedUSD
  tokenHourData.save()

  return tokenHourData as TokenHourData
}

export function updateTickDayData(tick: Tick, event: ethereum.Event): TickDayData {
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let tickDayDataID = tick.id.concat('-').concat(dayID.toString())
  let tickDayData = TickDayData.load(tickDayDataID)
  if (tickDayData === null) {
    tickDayData = new TickDayData(tickDayDataID)
    tickDayData.date = dayStartTimestamp
    tickDayData.pool = tick.pool
    tickDayData.tick = tick.id
  }
  tickDayData.liquidityGross = tick.liquidityGross
  tickDayData.liquidityNet = tick.liquidityNet
  tickDayData.volumeToken0 = tick.volumeToken0
  tickDayData.volumeToken1 = tick.volumeToken0
  tickDayData.volumeUSD = tick.volumeUSD
  tickDayData.feesUSD = tick.feesUSD
  tickDayData.feeGrowthOutside0X128 = tick.feeGrowthOutside0X128
  tickDayData.feeGrowthOutside1X128 = tick.feeGrowthOutside1X128

  tickDayData.save()

  return tickDayData as TickDayData
}