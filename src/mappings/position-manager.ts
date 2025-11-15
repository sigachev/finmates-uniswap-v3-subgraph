import {
  IncreaseLiquidity,
  DecreaseLiquidity,
  Collect,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Position, Tick, Transaction, Pool, Token, MintContext } from '../types/schema'
import { Address, BigInt, BigDecimal, ethereum, log } from '@graphprotocol/graph-ts'
import { convertTokenToDecimal } from '../utils'
import { createPositionSnapshot } from '../utils/position-snapshot'
import { ZERO_BD, ZERO_BI } from '../utils/constants'

// ============================================================================
// EVENT-ONLY POSITION MANAGEMENT - NO eth_call OPERATIONS
// ============================================================================
// This implementation builds position state entirely from events:
// 1. Transfer (from 0x0) → Creates minimal Position with owner
// 2. Mint (in Pool) → Creates MintContext with pool/tick info
// 3. IncreaseLiquidity (NFT) → Uses MintContext to associate Position with Pool
//
// NO eth_call to positions() method needed!
// Works for ALL blocks, including very old ones!
// ============================================================================

/**
 * Helper: Get or create Transaction entity
 */
function getOrCreateTransaction(event: ethereum.Event): Transaction {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction == null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.gasUsed = event.receipt ? event.receipt!.gasUsed : ZERO_BI
    transaction.gasPrice = event.transaction.gasPrice
    transaction.save()
  }
  return transaction as Transaction
}

/**
 * Helper: Get or create Tick entity
 */
function getOrCreateTick(poolAddress: string, tickIdx: i32): Tick {
  let tickId = poolAddress + '#' + tickIdx.toString()
  let tick = Tick.load(tickId)

  if (tick == null) {
    tick = new Tick(tickId)
    tick.poolAddress = poolAddress
    tick.tickIdx = BigInt.fromI32(tickIdx)
    tick.pool = poolAddress
    tick.liquidityGross = ZERO_BI
    tick.liquidityNet = ZERO_BI
    tick.price0 = ZERO_BD
    tick.price1 = ZERO_BD
    tick.volumeToken0 = ZERO_BD
    tick.volumeToken1 = ZERO_BD
    tick.volumeUSD = ZERO_BD
    tick.untrackedVolumeUSD = ZERO_BD
    tick.feesUSD = ZERO_BD
    tick.collectedFeesToken0 = ZERO_BD
    tick.collectedFeesToken1 = ZERO_BD
    tick.collectedFeesUSD = ZERO_BD
    tick.createdAtTimestamp = ZERO_BI
    tick.createdAtBlockNumber = ZERO_BI
    tick.liquidityProviderCount = ZERO_BI
    tick.feeGrowthOutside0X128 = ZERO_BI
    tick.feeGrowthOutside1X128 = ZERO_BI
    tick.save()
  }

  return tick as Tick
}

/**
 * Create minimal Position entity from Transfer event
 * Full details populated later by IncreaseLiquidity event
 */
function createMinimalPosition(
  tokenId: BigInt,
  owner: Address,
  event: ethereum.Event
): Position {
  let positionId = tokenId.toString()
  let position = new Position(positionId)

  position.owner = owner
  position.liquidity = ZERO_BI
  position.depositedToken0 = ZERO_BD
  position.depositedToken1 = ZERO_BD
  position.withdrawnToken0 = ZERO_BD
  position.withdrawnToken1 = ZERO_BD
  position.collectedToken0 = ZERO_BD
  position.collectedToken1 = ZERO_BD
  position.collectedFeesToken0 = ZERO_BD
  position.collectedFeesToken1 = ZERO_BD
  position.feeGrowthInside0LastX128 = ZERO_BI
  position.feeGrowthInside1LastX128 = ZERO_BI

  // These will be populated by IncreaseLiquidity event using MintContext
  position.pool = ''
  position.token0 = ''
  position.token1 = ''
  position.tickLower = ''
  position.tickUpper = ''

  let transaction = getOrCreateTransaction(event)
  position.transaction = transaction.id

  position.save()

  log.info('Created minimal position {} for owner {} (awaiting pool association)', [
    positionId,
    owner.toHexString()
  ])

  return position as Position
}

/**
 * Find MintContext from earlier in the same transaction
 * Searches backwards from current log index to find pool context
 */
function findMintContextForPosition(
  txHash: string,
  logIndex: BigInt
): MintContext | null {
  let maxLogIndex = logIndex.toI32()

  // Search up to 100 logs before (generous range for complex transactions)
  let searchStart = maxLogIndex - 100
  if (searchStart < 0) {
    searchStart = 0
  }

  // Search backwards from current log index
  for (let i = maxLogIndex - 1; i >= searchStart; i--) {
    let contextId = txHash + '-' + i.toString()
    let mintContext = MintContext.load(contextId)

    if (mintContext != null) {
      log.info('Found MintContext {} at log {} for IncreaseLiquidity at log {}', [
        contextId,
        i.toString(),
        logIndex.toString()
      ])
      return mintContext as MintContext
    }
  }

  log.warning('No MintContext found in tx {} before log index {}', [
    txHash,
    logIndex.toString()
  ])
  return null
}

/**
 * Associate position with pool using MintContext
 * Returns true if successful, false if MintContext not found
 */
function associatePositionWithPool(
  position: Position,
  txHash: string,
  logIndex: BigInt
): boolean {
  // Skip if position already has a pool
  if (position.pool != '' && position.pool != null) {
    return true
  }

  // Find MintContext from earlier in transaction
  let mintContext = findMintContextForPosition(txHash, logIndex)

  if (mintContext == null) {
    return false
  }

  // Load pool to validate it exists
  let pool = Pool.load(mintContext.pool)
  if (pool == null) {
    log.error('MintContext references non-existent pool {}', [mintContext.pool])
    return false
  }

  // Associate position with pool
  position.pool = pool.id
  position.token0 = pool.token0
  position.token1 = pool.token1

  // Create or get tick entities
  let tickLowerId = pool.id + '#' + mintContext.tickLower.toString()
  let tickUpperId = pool.id + '#' + mintContext.tickUpper.toString()

  getOrCreateTick(pool.id, mintContext.tickLower)
  getOrCreateTick(pool.id, mintContext.tickUpper)

  position.tickLower = tickLowerId
  position.tickUpper = tickUpperId

  position.save()

  log.info('Associated position {} with pool {} ticks=[{}, {}]', [
    position.id,
    pool.id,
    mintContext.tickLower.toString(),
    mintContext.tickUpper.toString()
  ])

  return true
}

/**
 * HANDLE INCREASELIQUIDITY
 * Uses MintContext to associate position with pool - NO eth_call!
 */
export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    // Position doesn't exist - create minimal version
    position = new Position(positionId)
    position.owner = Address.fromI32(0) // Placeholder, updated by Transfer
    position.liquidity = ZERO_BI
    position.depositedToken0 = ZERO_BD
    position.depositedToken1 = ZERO_BD
    position.withdrawnToken0 = ZERO_BD
    position.withdrawnToken1 = ZERO_BD
    position.collectedToken0 = ZERO_BD
    position.collectedToken1 = ZERO_BD
    position.collectedFeesToken0 = ZERO_BD
    position.collectedFeesToken1 = ZERO_BD
    position.feeGrowthInside0LastX128 = ZERO_BI
    position.feeGrowthInside1LastX128 = ZERO_BI
    position.pool = ''
    position.token0 = ''
    position.token1 = ''
    position.tickLower = ''
    position.tickUpper = ''

    let transaction = getOrCreateTransaction(event)
    position.transaction = transaction.id

    log.info('Created position {} from IncreaseLiquidity event', [positionId])
  }

  // Try to associate with pool using MintContext
  let txHash = event.transaction.hash.toHexString()
  let associated = associatePositionWithPool(position, txHash, event.logIndex)

  if (!associated) {
    log.warning('Could not associate position {} with pool (no MintContext found)', [positionId])
    position.save()
    return
  }

  // Position now associated with pool - update liquidity amounts
  let pool = Pool.load(position.pool)
  if (pool == null) {
    log.error('Pool {} not found for position {}', [position.pool, positionId])
    return
  }

  // Get token decimals for conversion
  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 != null && token1 != null) {
    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

    position.depositedToken0 = position.depositedToken0.plus(amount0)
    position.depositedToken1 = position.depositedToken1.plus(amount1)
  }

  // Update position liquidity
  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.save()

  // Update pool liquidity
  pool.liquidity = pool.liquidity.plus(event.params.liquidity)
  pool.save()

  createPositionSnapshot(position as Position, event)

  log.info('Increased liquidity for position {}: +{} (deposited: {} token0, {} token1)', [
    positionId,
    event.params.liquidity.toString(),
    event.params.amount0.toString(),
    event.params.amount1.toString()
  ])
}

/**
 * HANDLE DECREASELIQUIDITY
 * Position must already exist with pool association
 */
export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    log.warning('Position {} does not exist for DecreaseLiquidity', [positionId])
    return
  }

  if (position.pool == '' || position.pool == null) {
    log.warning('Position {} has no pool association for DecreaseLiquidity', [positionId])
    return
  }

  let pool = Pool.load(position.pool)
  if (pool == null) {
    log.error('Pool {} not found for position {}', [position.pool, positionId])
    return
  }

  // Get token decimals
  let token0 = Token.load(pool.token0)
  let token1 = Token.load(pool.token1)

  if (token0 != null && token1 != null) {
    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

    position.withdrawnToken0 = position.withdrawnToken0.plus(amount0)
    position.withdrawnToken1 = position.withdrawnToken1.plus(amount1)
  }

  // Update position liquidity
  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.save()

  // Update pool liquidity
  pool.liquidity = pool.liquidity.minus(event.params.liquidity)
  pool.save()

  createPositionSnapshot(position as Position, event)

  log.info('Decreased liquidity for position {}: -{} (withdrawn: {} token0, {} token1)', [
    positionId,
    event.params.liquidity.toString(),
    event.params.amount0.toString(),
    event.params.amount1.toString()
  ])
}

/**
 * HANDLE COLLECT
 * Position fees collected
 */
export function handleCollect(event: Collect): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    log.warning('Position {} does not exist for Collect', [positionId])
    return
  }

  let amount0Decimal = BigDecimal.fromString(event.params.amount0.toString())
  let amount1Decimal = BigDecimal.fromString(event.params.amount1.toString())

  position.collectedFeesToken0 = position.collectedFeesToken0.plus(amount0Decimal)
  position.collectedFeesToken1 = position.collectedFeesToken1.plus(amount1Decimal)
  position.collectedToken0 = position.collectedToken0.plus(amount0Decimal)
  position.collectedToken1 = position.collectedToken1.plus(amount1Decimal)
  position.save()

  log.info('Collected fees for position {}: {} token0, {} token1', [
    positionId,
    event.params.amount0.toString(),
    event.params.amount1.toString()
  ])
}

/**
 * HANDLE TRANSFER
 * Position ownership changes
 * Special: from 0x0 = mint, to 0x0 = burn
 */
export function handleTransfer(event: Transfer): void {
  let positionId = event.params.tokenId.toString()

  // MINT: from zero address
  if (event.params.from.toHexString() == '0x0000000000000000000000000000000000000000') {
    let position = Position.load(positionId)

    if (position == null) {
      // Create minimal position - details come from IncreaseLiquidity
      position = createMinimalPosition(event.params.tokenId, event.params.to, event)
    } else {
      // Position exists (from IncreaseLiquidity) - update owner
      position.owner = event.params.to
      position.save()
    }

    createPositionSnapshot(position as Position, event)

    log.info('Minted position {} to {}', [positionId, event.params.to.toHexString()])
    return
  }

  // BURN: to zero address
  if (event.params.to.toHexString() == '0x0000000000000000000000000000000000000000') {
    let position = Position.load(positionId)

    if (position == null) {
      log.warning('Position {} does not exist for burn', [positionId])
      return
    }

    position.owner = event.params.to
    position.liquidity = ZERO_BI
    position.save()

    createPositionSnapshot(position as Position, event)

    log.info('Burned position {}', [positionId])
    return
  }

  // REGULAR TRANSFER
  let position = Position.load(positionId)

  if (position == null) {
    log.warning('Position {} does not exist for transfer', [positionId])
    return
  }

  position.owner = event.params.to
  position.save()

  createPositionSnapshot(position as Position, event)

  log.info('Transferred position {} from {} to {}', [
    positionId,
    event.params.from.toHexString(),
    event.params.to.toHexString()
  ])
}