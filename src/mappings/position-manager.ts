import {
  IncreaseLiquidity,
  DecreaseLiquidity,
  Collect,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Position, Tick, Transaction, Pool } from '../types/schema'
import { Address, BigInt, BigDecimal, ethereum, log } from '@graphprotocol/graph-ts'
import { getOrCreatePool } from '../utils/pool-helper'
import { NonfungiblePositionManager } from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Factory } from '../types/Factory/Factory'

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    // Position doesn't exist yet, create it
    // Note: loadOrCreatePosition already calls getOrCreatePool internally
    position = loadOrCreatePosition(event.params.tokenId, event.address, event)

    if (position == null) {
      log.error('Failed to create position {}', [positionId])
      return
    }
  }

  // Pool must exist at this point (either loaded with position or created in loadOrCreatePosition)
  // But we still do a safety check in case of data inconsistency
  let pool = Pool.load(position.pool)
  if (pool == null) {
    log.error('Pool {} not found for position {}. This should not happen!', [position.pool, positionId])
    // Try to recover by creating the pool
    pool = getOrCreatePool(Address.fromString(position.pool))
    if (pool == null) {
      log.error('Failed to recover pool for position {}', [positionId])
      return
    }
  }

  // Update position liquidity
  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.save()

  // Update pool liquidity
  pool.liquidity = pool.liquidity.plus(event.params.liquidity)
  pool.save()

  log.info('Increased liquidity for position {}: +{}', [
    positionId,
    event.params.liquidity.toString()
  ])
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    log.error('Position {} does not exist', [positionId])
    return
  }

  // Load pool (should exist if position exists)
  let pool = Pool.load(position.pool)
  if (pool == null) {
    log.error('Pool {} not found for position {}. This should not happen!', [position.pool, positionId])
    // Try to recover by creating the pool
    pool = getOrCreatePool(Address.fromString(position.pool))
    if (pool == null) {
      log.error('Failed to recover pool for position {}', [positionId])
      return
    }
  }

  // Update position liquidity
  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.save()

  // Update pool liquidity
  pool.liquidity = pool.liquidity.minus(event.params.liquidity)
  pool.save()

  log.info('Decreased liquidity for position {}: -{}', [
    positionId,
    event.params.liquidity.toString()
  ])
}

export function handleCollect(event: Collect): void {
  let positionId = event.params.tokenId.toString()
  let position = Position.load(positionId)

  if (position == null) {
    log.warning('Position {} does not exist for Collect event', [positionId])
    return
  }

  // Update collected fees
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

export function handleTransfer(event: Transfer): void {
  let positionId = event.params.tokenId.toString()

  // Check if this is a mint (from zero address)
  if (event.params.from.toHexString() == '0x0000000000000000000000000000000000000000') {
    let position = loadOrCreatePosition(event.params.tokenId, event.address, event)

    if (position != null) {
      position.owner = event.params.to
      position.save()

      log.info('Minted new position {} to {}', [positionId, event.params.to.toHexString()])
    } else {
      log.error('Failed to create position {} on mint', [positionId])
    }
    return
  }

  // Check if this is a burn (to zero address)
  if (event.params.to.toHexString() == '0x0000000000000000000000000000000000000000') {
    let position = Position.load(positionId)
    if (position != null) {
      // Mark position as burned
      position.owner = event.params.to
      position.liquidity = BigInt.fromI32(0)
      position.save()

      log.info('Burned position {}', [positionId])
    }
    return
  }

  // Regular transfer
  let position = Position.load(positionId)
  if (position != null) {
    position.owner = event.params.to
    position.save()

    log.info('Transferred position {} from {} to {}', [
      positionId,
      event.params.from.toHexString(),
      event.params.to.toHexString()
    ])
  }
}

function getOrCreateTick(poolAddress: string, tickIdx: i32): Tick {
  let tickId = poolAddress + '#' + tickIdx.toString()
  let tick = Tick.load(tickId)

  if (tick == null) {
    tick = new Tick(tickId)
    tick.poolAddress = poolAddress
    tick.tickIdx = BigInt.fromI32(tickIdx)
    tick.pool = poolAddress
    tick.liquidityGross = BigInt.fromI32(0)
    tick.liquidityNet = BigInt.fromI32(0)
    tick.price0 = BigDecimal.fromString('0')
    tick.price1 = BigDecimal.fromString('0')
    tick.volumeToken0 = BigDecimal.fromString('0')
    tick.volumeToken1 = BigDecimal.fromString('0')
    tick.volumeUSD = BigDecimal.fromString('0')
    tick.untrackedVolumeUSD = BigDecimal.fromString('0')
    tick.feesUSD = BigDecimal.fromString('0')
    tick.collectedFeesToken0 = BigDecimal.fromString('0')
    tick.collectedFeesToken1 = BigDecimal.fromString('0')
    tick.collectedFeesUSD = BigDecimal.fromString('0')
    tick.createdAtTimestamp = BigInt.fromI32(0)
    tick.createdAtBlockNumber = BigInt.fromI32(0)
    tick.liquidityProviderCount = BigInt.fromI32(0)
    tick.feeGrowthOutside0X128 = BigInt.fromI32(0)
    tick.feeGrowthOutside1X128 = BigInt.fromI32(0)
    tick.save()
  }

  return tick as Tick
}

function loadOrCreatePosition(
  tokenId: BigInt,
  nftManagerAddress: Address,
  event: ethereum.Event
): Position | null {
  let positionId = tokenId.toString()
  let position = Position.load(positionId)

  if (position != null) {
    return position
  }

  // Fetch position data from contract
  let nftContract = NonfungiblePositionManager.bind(nftManagerAddress)
  let positionResult = nftContract.try_positions(tokenId)

  if (positionResult.reverted) {
    log.error('Failed to fetch position {} from contract', [positionId])
    return null
  }

  let positionData = positionResult.value

  // Get pool address from Factory
  let factoryResult = nftContract.try_factory()
  if (factoryResult.reverted) {
    log.error('Failed to fetch factory address', [])
    return null
  }

  // Get token addresses and fee from position data
  // positions() returns: (nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1)
  let token0 = positionData.value2 as Address  // token0
  let token1 = positionData.value3 as Address  // token1
  let fee = positionData.value4 as i32         // fee

  // Get pool address from Factory contract
  let factoryContract = Factory.bind(factoryResult.value)
  let poolAddressResult = factoryContract.try_getPool(token0, token1, fee)

  if (poolAddressResult.reverted) {
    log.error('Failed to fetch pool address for position {}', [positionId])
    return null
  }

  let poolAddress = poolAddressResult.value

  // Ensure pool exists (auto-create if needed)
  let pool = getOrCreatePool(poolAddress)
  if (pool == null) {
    log.error('Failed to create pool {} for position {}', [
      poolAddress.toHexString(),
      positionId
    ])
    return null
  }

  // Get or create transaction
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction == null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.gasUsed = event.receipt ? event.receipt!.gasUsed : BigInt.fromI32(0)
    transaction.gasPrice = event.transaction.gasPrice
    transaction.save()
  }

  // Create tick entities for lower and upper
  let tickLowerIdx = positionData.value5 as i32  // tickLower
  let tickUpperIdx = positionData.value6 as i32  // tickUpper
  let tickLower = getOrCreateTick(pool.id, tickLowerIdx)
  let tickUpper = getOrCreateTick(pool.id, tickUpperIdx)

  // Create position entity
  position = new Position(positionId)
  position.owner = Address.fromI32(0) // Will be set by Transfer event
  position.pool = pool.id
  position.token0 = pool.token0
  position.token1 = pool.token1
  position.tickLower = tickLower.id
  position.tickUpper = tickUpper.id
  position.liquidity = positionData.value7  // liquidity
  position.feeGrowthInside0LastX128 = positionData.value8   // feeGrowthInside0LastX128
  position.feeGrowthInside1LastX128 = positionData.value9  // feeGrowthInside1LastX128y

  // Initialize accumulated amounts
  position.depositedToken0 = BigDecimal.fromString('0')
  position.depositedToken1 = BigDecimal.fromString('0')
  position.withdrawnToken0 = BigDecimal.fromString('0')
  position.withdrawnToken1 = BigDecimal.fromString('0')
  position.collectedToken0 = BigDecimal.fromString('0')
  position.collectedToken1 = BigDecimal.fromString('0')
  position.collectedFeesToken0 = BigDecimal.fromString('0')
  position.collectedFeesToken1 = BigDecimal.fromString('0')

  position.transaction = transaction.id

  position.save()

  log.info('Created position {} for pool {}', [positionId, pool.id])

  return position
}