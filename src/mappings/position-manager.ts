/* eslint-disable prefer-const */
import {
  Collect,
  DecreaseLiquidity,
  IncreaseLiquidity,
  NonfungiblePositionManager,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Position, PositionSnapshot, Token, Bundle, Pool, Factory, Tick } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ZERO_BD, ZERO_BI, FACTORY_ADDRESS } from '../utils/constants'
import { Address, BigInt, BigDecimal, ethereum, log } from '@graphprotocol/graph-ts'
import { convertTokenToDecimal, loadTransaction } from '../utils'
import { createTick } from '../utils/tick'

// Helper function to ensure bundle exists
function ensureBundleExists(): Bundle {
  let bundle = Bundle.load('1')
  if (bundle === null) {
    bundle = new Bundle('1')
    bundle.ethPriceUSD = BigDecimal.fromString('2000') // Default ETH price
    bundle.save()
  }

  // Always ensure we have a valid ETH price
  if (bundle.ethPriceUSD.equals(ZERO_BD) || bundle.ethPriceUSD.toString() == '0') {
    bundle.ethPriceUSD = BigDecimal.fromString('2000')
    bundle.save()
  }

  return bundle as Bundle
}

// Track processed positions to avoid redundant calls
let processedPositions = new Map<string, boolean>()

function getOrCreatePosition(event: ethereum.Event, tokenId: BigInt): Position | null {
  let positionId = tokenId.toString()

  // Check if position already exists
  let position = Position.load(positionId)
  if (position !== null) {
    return position
  }

  // Check if we've already tried to process this position in this event
  if (processedPositions.has(positionId)) {
    return null
  }
  processedPositions.set(positionId, true)

  // Try to fetch position from contract
  let contract = NonfungiblePositionManager.bind(event.address)
  let positionCall = contract.try_positions(tokenId)

  if (positionCall.reverted) {
    // Position might have been burned or doesn't exist yet
    log.warning('Position {} does not exist on-chain (may have been burned)', [positionId])
    return null
  }

  let positionResult = positionCall.value

  // Get pool address from factory
  let poolAddress = factoryContract.getPool(
    positionResult.value2,
    positionResult.value3,
    positionResult.value4
  )

  // Check if pool exists in our subgraph
  let pool = Pool.load(poolAddress.toHexString())
  if (pool === null) {
    // This can happen if we're starting indexing after the pool was created
    // Log it but don't try to create the pool retroactively
    log.warning('Pool {} not found in subgraph for position {}. This pool may have been created before our indexing started.', [
      poolAddress.toHexString(),
      positionId
    ])
    return null
  }

  // Create the position
  position = new Position(positionId)
  position.owner = Address.fromString(ADDRESS_ZERO) // Will be updated in Transfer handler
  position.pool = poolAddress.toHexString()
  position.token0 = positionResult.value2.toHexString()
  position.token1 = positionResult.value3.toHexString()

  // Create tick references if they don't exist
  let tickLowerId = position.pool.concat('#').concat(positionResult.value5.toString())
  let tickUpperId = position.pool.concat('#').concat(positionResult.value6.toString())

  let tickLower = Tick.load(tickLowerId)
  if (tickLower === null) {
    tickLower = createTick(tickLowerId, positionResult.value5.toI32(), position.pool, event)
    tickLower.save()
  }

  let tickUpper = Tick.load(tickUpperId)
  if (tickUpper === null) {
    tickUpper = createTick(tickUpperId, positionResult.value6.toI32(), position.pool, event)
    tickUpper.save()
  }

  position.tickLower = tickLowerId
  position.tickUpper = tickUpperId
  position.liquidity = positionResult.value7
  position.depositedToken0 = ZERO_BD
  position.depositedToken1 = ZERO_BD
  position.withdrawnToken0 = ZERO_BD
  position.withdrawnToken1 = ZERO_BD
  position.collectedToken0 = ZERO_BD
  position.collectedToken1 = ZERO_BD
  position.collectedFeesToken0 = ZERO_BD
  position.collectedFeesToken1 = ZERO_BD
  position.transaction = loadTransaction(event).id
  position.feeGrowthInside0LastX128 = positionResult.value8
  position.feeGrowthInside1LastX128 = positionResult.value9

  position.save()

  log.info('Created position {} for pool {} at block {}', [
    positionId,
    poolAddress.toHexString(),
    event.block.number.toString()
  ])

  return position
}

function updateFeeVars(position: Position, event: ethereum.Event, tokenId: BigInt): Position {
  let positionManagerContract = NonfungiblePositionManager.bind(event.address)
  let positionResult = positionManagerContract.try_positions(tokenId)

  if (!positionResult.reverted) {
    position.feeGrowthInside0LastX128 = positionResult.value.value8
    position.feeGrowthInside1LastX128 = positionResult.value.value9
  } else {
    log.warning('Error updating fee vars for position {} - position may have been burned', [position.id])
  }

  return position
}

function savePositionSnapshot(position: Position, event: ethereum.Event): void {
  let snapshotId = position.id.concat('#').concat(event.block.number.toString())
  let positionSnapshot = new PositionSnapshot(snapshotId)
  positionSnapshot.owner = position.owner
  positionSnapshot.pool = position.pool
  positionSnapshot.position = position.id
  positionSnapshot.blockNumber = event.block.number
  positionSnapshot.timestamp = event.block.timestamp
  positionSnapshot.liquidity = position.liquidity
  positionSnapshot.depositedToken0 = position.depositedToken0
  positionSnapshot.depositedToken1 = position.depositedToken1
  positionSnapshot.withdrawnToken0 = position.withdrawnToken0
  positionSnapshot.withdrawnToken1 = position.withdrawnToken1
  positionSnapshot.collectedFeesToken0 = position.collectedFeesToken0
  positionSnapshot.collectedFeesToken1 = position.collectedFeesToken1
  positionSnapshot.transaction = loadTransaction(event).id
  positionSnapshot.feeGrowthInside0LastX128 = position.feeGrowthInside0LastX128
  positionSnapshot.feeGrowthInside1LastX128 = position.feeGrowthInside1LastX128
  positionSnapshot.save()
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  // Ensure bundle exists
  ensureBundleExists()

  let position = getOrCreatePosition(event, event.params.tokenId)
  if (position == null) {
    log.warning('Skipping IncreaseLiquidity for position {} - unable to load or create', [
      event.params.tokenId.toString()
    ])
    return
  }

  // Skip problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Verify pool exists and is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.error('Pool {} not found for position {} - this should not happen', [
      position.pool,
      position.id
    ])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool {} not initialized for position {}', [position.pool, position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.error('Tokens not found for position {} - this should not happen', [position.id])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.depositedToken0 = position.depositedToken0.plus(amount0)
  position.depositedToken1 = position.depositedToken1.plus(amount1)

  position = updateFeeVars(position, event, event.params.tokenId)
  position.save()

  savePositionSnapshot(position, event)
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  // Ensure bundle exists
  ensureBundleExists()

  let position = getOrCreatePosition(event, event.params.tokenId)
  if (position == null) {
    log.warning('Skipping DecreaseLiquidity for position {} - unable to load or create', [
      event.params.tokenId.toString()
    ])
    return
  }

  // Skip problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Verify pool exists and is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.error('Pool {} not found for position {} - this should not happen', [
      position.pool,
      position.id
    ])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool {} not initialized for position {}', [position.pool, position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.error('Tokens not found for position {} - this should not happen', [position.id])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.withdrawnToken0 = position.withdrawnToken0.plus(amount0)
  position.withdrawnToken1 = position.withdrawnToken1.plus(amount1)

  position = updateFeeVars(position, event, event.params.tokenId)
  position.save()

  savePositionSnapshot(position, event)
}

export function handleCollect(event: Collect): void {
  // Ensure bundle exists
  ensureBundleExists()

  let position = getOrCreatePosition(event, event.params.tokenId)
  if (position == null) {
    log.warning('Skipping Collect for position {} - unable to load or create', [
      event.params.tokenId.toString()
    ])
    return
  }

  // Skip problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Verify pool exists and is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.error('Pool {} not found for position {} - this should not happen', [
      position.pool,
      position.id
    ])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool {} not initialized for position {}', [position.pool, position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.error('Tokens not found for position {} - this should not happen', [position.id])
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  position.collectedToken0 = position.collectedToken0.plus(amount0)
  position.collectedToken1 = position.collectedToken1.plus(amount1)

  // Calculate fees as collected minus withdrawn
  position.collectedFeesToken0 = position.collectedToken0.minus(position.withdrawnToken0)
  position.collectedFeesToken1 = position.collectedToken1.minus(position.withdrawnToken1)

  // Ensure fees are not negative
  if (position.collectedFeesToken0.lt(ZERO_BD)) {
    position.collectedFeesToken0 = ZERO_BD
  }
  if (position.collectedFeesToken1.lt(ZERO_BD)) {
    position.collectedFeesToken1 = ZERO_BD
  }

  position = updateFeeVars(position, event, event.params.tokenId)
  position.save()

  savePositionSnapshot(position, event)
}

export function handleTransfer(event: Transfer): void {
  // Ensure bundle exists
  ensureBundleExists()

  // Skip mints from zero address - position will be created when first used
  if (event.params.from.toHexString() == ADDRESS_ZERO) {
    log.debug('Skipping mint transfer for position {}', [event.params.tokenId.toString()])
    return
  }

  // Skip burns to zero address
  if (event.params.to.toHexString() == ADDRESS_ZERO) {
    log.debug('Position {} burned', [event.params.tokenId.toString()])
    return
  }

  let position = getOrCreatePosition(event, event.params.tokenId)
  if (position == null) {
    log.warning('Skipping Transfer for position {} - unable to load or create', [
      event.params.tokenId.toString()
    ])
    return
  }

  position.owner = event.params.to
  position.save()

  savePositionSnapshot(position, event)
}