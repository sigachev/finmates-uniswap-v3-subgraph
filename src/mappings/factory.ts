/* eslint-disable prefer-const */
import { FACTORY_ADDRESS, ZERO_BI, ONE_BI, ZERO_BD, ADDRESS_ZERO } from './../utils/constants'
import { Factory, Bundle } from '../types/schema'
import { PoolCreated } from '../types/Factory/Factory'
import { Pool, Token } from '../types/schema'
import { Pool as PoolTemplate } from '../types/templates'
import { fetchTokenSymbol, fetchTokenName, fetchTokenTotalSupply, fetchTokenDecimals } from '../utils/token'
import { log, BigInt, Address, BigDecimal } from '@graphprotocol/graph-ts'
import { WHITELIST_TOKENS } from './../utils/pricing'

// Initialize or load bundle - CRITICAL for preventing indexing failures
function ensureBundleExists(): Bundle {
  let bundle = Bundle.load('1')
  if (bundle === null) {
    bundle = new Bundle('1')
    bundle.ethPriceUSD = BigDecimal.fromString('2000') // Default ETH price
    bundle.save()
  }

  // Always ensure we have a valid ETH price - never let it be zero
  if (bundle.ethPriceUSD.equals(ZERO_BD) || bundle.ethPriceUSD.toString() == '0') {
    bundle.ethPriceUSD = BigDecimal.fromString('2000')
    bundle.save()
  }

  return bundle as Bundle
}

export function handlePoolCreated(event: PoolCreated): void {
  // CRITICAL: Ensure bundle exists before any operations
  ensureBundleExists()

  // Log for debugging
  log.info('Processing PoolCreated at block {} for pool {}', [
    event.block.number.toString(),
    event.params.pool.toHexString()
  ])

  // temp fix - skip problematic pool
  if (event.params.pool == Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248')) {
    log.warning('Skipping problematic pool: {}', [event.params.pool.toHexString()])
    return
  }

  // load factory (create if doesn't exist)
  let factory = Factory.load(FACTORY_ADDRESS)
  if (factory === null) {
    factory = new Factory(FACTORY_ADDRESS)
    factory.poolCount = ZERO_BI
    factory.totalVolumeETH = ZERO_BD
    factory.totalVolumeUSD = ZERO_BD
    factory.untrackedVolumeUSD = ZERO_BD
    factory.totalFeesUSD = ZERO_BD
    factory.totalFeesETH = ZERO_BD
    factory.totalValueLockedETH = ZERO_BD
    factory.totalValueLockedUSD = ZERO_BD
    factory.totalValueLockedUSDUntracked = ZERO_BD
    factory.totalValueLockedETHUntracked = ZERO_BD
    factory.txCount = ZERO_BI
    factory.owner = ADDRESS_ZERO
    factory.save()
  }

  factory.poolCount = factory.poolCount.plus(ONE_BI)
  factory.save()

  let pool = new Pool(event.params.pool.toHexString()) as Pool
  let token0 = Token.load(event.params.token0.toHexString())
  let token1 = Token.load(event.params.token1.toHexString())

  // fetch info if null - with safe defaults
  if (token0 === null) {
    token0 = new Token(event.params.token0.toHexString())

    // Set safe defaults first
    token0.symbol = 'UNKNOWN'
    token0.name = 'Unknown Token'
    token0.totalSupply = ZERO_BI
    token0.decimals = BigInt.fromI32(18)
    token0.derivedETH = ZERO_BD
    token0.volume = ZERO_BD
    token0.volumeUSD = ZERO_BD
    token0.feesUSD = ZERO_BD
    token0.untrackedVolumeUSD = ZERO_BD
    token0.totalValueLocked = ZERO_BD
    token0.totalValueLockedUSD = ZERO_BD
    token0.totalValueLockedUSDUntracked = ZERO_BD
    token0.txCount = ZERO_BI
    token0.poolCount = ZERO_BI
    token0.whitelistPools = []

    // Try to fetch actual values (may fail for some tokens)
    try {
      let symbol = fetchTokenSymbol(event.params.token0)
      if (symbol != 'unknown' && symbol.length > 0) {
        token0.symbol = symbol
      }
    } catch (e) {
      log.warning('Failed to fetch symbol for token0 {}: {}', [event.params.token0.toHexString(), e.toString()])
    }

    try {
      let name = fetchTokenName(event.params.token0)
      if (name != 'unknown' && name.length > 0) {
        token0.name = name
      }
    } catch (e) {
      log.warning('Failed to fetch name for token0 {}: {}', [event.params.token0.toHexString(), e.toString()])
    }

    try {
      let totalSupply = fetchTokenTotalSupply(event.params.token0)
      token0.totalSupply = totalSupply
    } catch (e) {
      log.warning('Failed to fetch totalSupply for token0 {}: {}', [event.params.token0.toHexString(), e.toString()])
    }

    try {
      let decimals = fetchTokenDecimals(event.params.token0)
      if (decimals !== null && decimals.gt(ZERO_BI) && decimals.le(BigInt.fromI32(255))) {
        token0.decimals = decimals
      }
    } catch (e) {
      log.warning('Failed to fetch decimals for token0 {}: {}', [event.params.token0.toHexString(), e.toString()])
    }

    token0.save()
  }

  if (token1 === null) {
    token1 = new Token(event.params.token1.toHexString())

    // Set safe defaults first
    token1.symbol = 'UNKNOWN'
    token1.name = 'Unknown Token'
    token1.totalSupply = ZERO_BI
    token1.decimals = BigInt.fromI32(18)
    token1.derivedETH = ZERO_BD
    token1.volume = ZERO_BD
    token1.volumeUSD = ZERO_BD
    token1.untrackedVolumeUSD = ZERO_BD
    token1.feesUSD = ZERO_BD
    token1.totalValueLocked = ZERO_BD
    token1.totalValueLockedUSD = ZERO_BD
    token1.totalValueLockedUSDUntracked = ZERO_BD
    token1.txCount = ZERO_BI
    token1.poolCount = ZERO_BI
    token1.whitelistPools = []

    // Try to fetch actual values (may fail for some tokens)
    try {
      let symbol = fetchTokenSymbol(event.params.token1)
      if (symbol != 'unknown' && symbol.length > 0) {
        token1.symbol = symbol
      }
    } catch (e) {
      log.warning('Failed to fetch symbol for token1 {}: {}', [event.params.token1.toHexString(), e.toString()])
    }

    try {
      let name = fetchTokenName(event.params.token1)
      if (name != 'unknown' && name.length > 0) {
        token1.name = name
      }
    } catch (e) {
      log.warning('Failed to fetch name for token1 {}: {}', [event.params.token1.toHexString(), e.toString()])
    }

    try {
      let totalSupply = fetchTokenTotalSupply(event.params.token1)
      token1.totalSupply = totalSupply
    } catch (e) {
      log.warning('Failed to fetch totalSupply for token1 {}: {}', [event.params.token1.toHexString(), e.toString()])
    }

    try {
      let decimals = fetchTokenDecimals(event.params.token1)
      if (decimals !== null && decimals.gt(ZERO_BI) && decimals.le(BigInt.fromI32(255))) {
        token1.decimals = decimals
      }
    } catch (e) {
      log.warning('Failed to fetch decimals for token1 {}: {}', [event.params.token1.toHexString(), e.toString()])
    }

    token1.save()
  }

  // update white listed pools
  if (WHITELIST_TOKENS.includes(token0.id)) {
    let newPools = token1.whitelistPools
    newPools.push(pool.id)
    token1.whitelistPools = newPools
    token1.save()
  }
  if (WHITELIST_TOKENS.includes(token1.id)) {
    let newPools = token0.whitelistPools
    newPools.push(pool.id)
    token0.whitelistPools = newPools
    token0.save()
  }

  // Initialize pool with all required fields
  pool.token0 = token0.id
  pool.token1 = token1.id
  pool.feeTier = BigInt.fromI32(event.params.fee)
  pool.createdAtTimestamp = event.block.timestamp
  pool.createdAtBlockNumber = event.block.number
  pool.liquidityProviderCount = ZERO_BI
  pool.txCount = ZERO_BI
  pool.liquidity = ZERO_BI
  pool.sqrtPrice = ZERO_BI
  pool.feeGrowthGlobal0X128 = ZERO_BI
  pool.feeGrowthGlobal1X128 = ZERO_BI
  pool.token0Price = ZERO_BD
  pool.token1Price = ZERO_BD
  pool.observationIndex = ZERO_BI
  pool.totalValueLockedToken0 = ZERO_BD
  pool.totalValueLockedToken1 = ZERO_BD
  pool.totalValueLockedUSD = ZERO_BD
  pool.totalValueLockedETH = ZERO_BD
  pool.totalValueLockedUSDUntracked = ZERO_BD
  pool.volumeToken0 = ZERO_BD
  pool.volumeToken1 = ZERO_BD
  pool.volumeUSD = ZERO_BD
  pool.feesUSD = ZERO_BD
  pool.untrackedVolumeUSD = ZERO_BD

  pool.collectedFeesToken0 = ZERO_BD
  pool.collectedFeesToken1 = ZERO_BD
  pool.collectedFeesUSD = ZERO_BD

  // Initialize tick to null
  pool.tick = null

  pool.save()

  // create the tracked contract based on the template
  PoolTemplate.create(event.params.pool)

  log.info('Successfully created pool {} at block {}', [pool.id, event.block.number.toString()])
}