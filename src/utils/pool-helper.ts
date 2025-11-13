import { Address, BigInt, BigDecimal, log } from '@graphprotocol/graph-ts'
import { Pool, Token } from '../types/schema'
import { Pool as PoolContract } from '../types/templates/Pool/Pool'
import { Factory } from '../types/Factory/Factory'
import { ERC20 } from '../types/Factory/ERC20'
import { sqrtPriceX96ToTokenPrices } from '../utils/pricing'
import { ZERO_BI } from '../utils/constants'

export function getOrCreatePool(poolAddress: Address): Pool | null {
  let pool = Pool.load(poolAddress.toHexString())

  if (pool != null) {
    return pool
  }

  log.warning('Pool {} does not exist, creating it...', [poolAddress.toHexString()])

  // Fetch pool data from contract
  let poolContract = PoolContract.bind(poolAddress)

  // Try to get pool parameters
  let token0Result = poolContract.try_token0()
  let token1Result = poolContract.try_token1()
  let feeResult = poolContract.try_fee()
  let liquidityResult = poolContract.try_liquidity()

  if (token0Result.reverted || token1Result.reverted) {
    log.error('Failed to fetch pool data for {}', [poolAddress.toHexString()])
    return null
  }

  let token0Address = token0Result.value
  let token1Address = token1Result.value

  // Create or load tokens
  let token0 = getOrCreateToken(token0Address)
  let token1 = getOrCreateToken(token1Address)

  if (token0 == null || token1 == null) {
    log.error('Failed to create tokens for pool {}', [poolAddress.toHexString()])
    return null
  }

  // Create new pool entity
  pool = new Pool(poolAddress.toHexString())
  pool.token0 = token0.id
  pool.token1 = token1.id
  pool.feeTier = feeResult.reverted ? BigInt.fromI32(0) : BigInt.fromI32(feeResult.value)
  pool.liquidity = liquidityResult.reverted ? BigInt.fromI32(0) : liquidityResult.value

  // Initialize with default values
  pool.sqrtPrice = BigInt.fromI32(0)
  pool.feeGrowthGlobal0X128 = BigInt.fromI32(0)
  pool.feeGrowthGlobal1X128 = BigInt.fromI32(0)
  pool.token0Price = BigDecimal.fromString('0')
  pool.token1Price = BigDecimal.fromString('0')
  pool.tick = BigInt.fromI32(0)
  pool.observationIndex = BigInt.fromI32(0)

  // Try to fetch current pool state from slot0()
  let slot0Result = poolContract.try_slot0()
  if (!slot0Result.reverted) {
    pool.sqrtPrice = slot0Result.value.value0
    pool.tick = BigInt.fromI32(slot0Result.value.value1)
    pool.observationIndex = BigInt.fromI32(slot0Result.value.value2)

    // Calculate token prices from sqrtPrice if we have a valid value
    if (pool.sqrtPrice.gt(ZERO_BI)) {
      let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
      pool.token0Price = prices[0]
      pool.token1Price = prices[1]

      log.info('Pool {} initialized with sqrtPrice: {}, tick: {}, token0Price: {}, token1Price: {}', [
        poolAddress.toHexString(),
        pool.sqrtPrice.toString(),
        pool.tick!.toString(),
        pool.token0Price.toString(),
        pool.token1Price.toString()
      ])
    } else {
      log.warning('Pool {} has zero sqrtPrice, prices will remain zero', [poolAddress.toHexString()])
    }
  } else {
    log.warning('Failed to fetch slot0 for pool {}, prices will remain zero', [poolAddress.toHexString()])
  }

  // Try to fetch fee growth globals
  let feeGrowthGlobal0Result = poolContract.try_feeGrowthGlobal0X128()
  let feeGrowthGlobal1Result = poolContract.try_feeGrowthGlobal1X128()
  if (!feeGrowthGlobal0Result.reverted) {
    pool.feeGrowthGlobal0X128 = feeGrowthGlobal0Result.value
  }
  if (!feeGrowthGlobal1Result.reverted) {
    pool.feeGrowthGlobal1X128 = feeGrowthGlobal1Result.value
  }
  pool.volumeToken0 = BigDecimal.fromString('0')
  pool.volumeToken1 = BigDecimal.fromString('0')
  pool.volumeUSD = BigDecimal.fromString('0')
  pool.untrackedVolumeUSD = BigDecimal.fromString('0')
  pool.feesUSD = BigDecimal.fromString('0')
  pool.txCount = BigInt.fromI32(0)
  pool.collectedFeesToken0 = BigDecimal.fromString('0')
  pool.collectedFeesToken1 = BigDecimal.fromString('0')
  pool.collectedFeesUSD = BigDecimal.fromString('0')
  pool.totalValueLockedToken0 = BigDecimal.fromString('0')
  pool.totalValueLockedToken1 = BigDecimal.fromString('0')
  pool.totalValueLockedETH = BigDecimal.fromString('0')
  pool.totalValueLockedUSD = BigDecimal.fromString('0')
  pool.totalValueLockedUSDUntracked = BigDecimal.fromString('0')
  pool.liquidityProviderCount = BigInt.fromI32(0)
  pool.createdAtTimestamp = BigInt.fromI32(0)
  pool.createdAtBlockNumber = BigInt.fromI32(0)

  pool.save()

  log.info('Successfully created pool {} with tokens {}/{}', [
    poolAddress.toHexString(),
    token0.symbol,
    token1.symbol
  ])

  return pool
}

export function getOrCreateToken(tokenAddress: Address): Token | null {
  let token = Token.load(tokenAddress.toHexString())

  if (token != null) {
    return token
  }

  log.warning('Token {} does not exist, creating it...', [tokenAddress.toHexString()])

  let tokenContract = ERC20.bind(tokenAddress)

  // Fetch token data
  let symbolResult = tokenContract.try_symbol()
  let nameResult = tokenContract.try_name()
  let decimalsResult = tokenContract.try_decimals()

  if (decimalsResult.reverted) {
    log.error('Failed to fetch decimals for token {}', [tokenAddress.toHexString()])
    return null
  }

  token = new Token(tokenAddress.toHexString())
  token.symbol = symbolResult.reverted ? 'UNKNOWN' : symbolResult.value
  token.name = nameResult.reverted ? 'Unknown Token' : nameResult.value
  token.decimals = BigInt.fromI32(decimalsResult.value)
  token.totalSupply = BigInt.fromI32(0)

  // Initialize all BigDecimal fields
  token.volume = BigDecimal.fromString('0')
  token.volumeUSD = BigDecimal.fromString('0')
  token.untrackedVolumeUSD = BigDecimal.fromString('0')
  token.feesUSD = BigDecimal.fromString('0')
  token.totalValueLocked = BigDecimal.fromString('0')
  token.totalValueLockedUSD = BigDecimal.fromString('0')
  token.totalValueLockedUSDUntracked = BigDecimal.fromString('0')
  token.derivedETH = BigDecimal.fromString('0')

  // Initialize counters
  token.txCount = BigInt.fromI32(0)
  token.poolCount = BigInt.fromI32(0)

  // Initialize whitelist pools array (empty)
  token.whitelistPools = []

  token.save()

  log.info('Successfully created token {} ({})', [token.symbol, tokenAddress.toHexString()])

  return token
}