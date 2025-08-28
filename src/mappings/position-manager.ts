/* eslint-disable prefer-const */
import {
  Collect,
  DecreaseLiquidity,
  IncreaseLiquidity,
  NonfungiblePositionManager,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Position, PositionSnapshot, Token, Bundle, Pool, Factory, Tick } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ZERO_BD, ZERO_BI, FACTORY_ADDRESS, ONE_BD } from '../utils/constants'
import { Address, BigInt, BigDecimal, ethereum, log } from '@graphprotocol/graph-ts'
import { convertTokenToDecimal, loadTransaction, safeDiv, bigDecimalExponated } from '../utils'

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

function getPosition(event: ethereum.Event, tokenId: BigInt): Position | null {
  let position = Position.load(tokenId.toString())
  if (position === null) {
    let contract = NonfungiblePositionManager.bind(event.address)
    let positionCall = contract.try_positions(tokenId)

    // the following call reverts in situations where the position is minted
    // and deleted in the same block - from my investigation this happens
    // in calls from  BancorSwap
    // (e.g. 0xf7867fa19aa65298fadb8d4f72d0daed5e836f3ba01f0b9b9631cdc6c36bed40)
    if (!positionCall.reverted) {
      let positionResult = positionCall.value
      let poolAddress = factoryContract.getPool(positionResult.value2, positionResult.value3, positionResult.value4)

      // Check if pool exists
      let pool = Pool.load(poolAddress.toHexString())
      if (pool === null) {
        log.warning('Pool does not exist for position {}, skipping', [tokenId.toString()])
        return null
      }

      position = new Position(tokenId.toString())
      // The owner gets correctly updated in the Transfer handler
      position.owner = Address.fromString(ADDRESS_ZERO)
      position.pool = poolAddress.toHexString()
      position.token0 = positionResult.value2.toHexString()
      position.token1 = positionResult.value3.toHexString()

      // Create tick references if they don't exist
      let tickLowerId = position.pool.concat('#').concat(positionResult.value5.toString())
      let tickUpperId = position.pool.concat('#').concat(positionResult.value6.toString())

      let tickLower = Tick.load(tickLowerId)
      if (tickLower === null) {
        // Create a basic tick without using createTick (which expects a Mint event)
        tickLower = new Tick(tickLowerId)
        tickLower.tickIdx = BigInt.fromI32(positionResult.value5)
        tickLower.pool = position.pool
        tickLower.poolAddress = position.pool
        tickLower.createdAtTimestamp = event.block.timestamp
        tickLower.createdAtBlockNumber = event.block.number
        tickLower.liquidityGross = ZERO_BI
        tickLower.liquidityNet = ZERO_BI
        tickLower.liquidityProviderCount = ZERO_BI

        // Calculate prices
        let price0 = bigDecimalExponated(BigDecimal.fromString('1.0001'), BigInt.fromI32(positionResult.value5))
        tickLower.price0 = price0
        tickLower.price1 = safeDiv(ONE_BD, price0)

        tickLower.volumeToken0 = ZERO_BD
        tickLower.volumeToken1 = ZERO_BD
        tickLower.volumeUSD = ZERO_BD
        tickLower.feesUSD = ZERO_BD
        tickLower.untrackedVolumeUSD = ZERO_BD
        tickLower.collectedFeesToken0 = ZERO_BD
        tickLower.collectedFeesToken1 = ZERO_BD
        tickLower.collectedFeesUSD = ZERO_BD
        tickLower.feeGrowthOutside0X128 = ZERO_BI
        tickLower.feeGrowthOutside1X128 = ZERO_BI
        tickLower.save()
      }

      let tickUpper = Tick.load(tickUpperId)
      if (tickUpper === null) {
        // Create a basic tick without using createTick (which expects a Mint event)
        tickUpper = new Tick(tickUpperId)
        tickUpper.tickIdx = BigInt.fromI32(positionResult.value6)
        tickUpper.pool = position.pool
        tickUpper.poolAddress = position.pool
        tickUpper.createdAtTimestamp = event.block.timestamp
        tickUpper.createdAtBlockNumber = event.block.number
        tickUpper.liquidityGross = ZERO_BI
        tickUpper.liquidityNet = ZERO_BI
        tickUpper.liquidityProviderCount = ZERO_BI

        // Calculate prices
        let price0 = bigDecimalExponated(BigDecimal.fromString('1.0001'), BigInt.fromI32(positionResult.value6))
        tickUpper.price0 = price0
        tickUpper.price1 = safeDiv(ONE_BD, price0)

        tickUpper.volumeToken0 = ZERO_BD
        tickUpper.volumeToken1 = ZERO_BD
        tickUpper.volumeUSD = ZERO_BD
        tickUpper.feesUSD = ZERO_BD
        tickUpper.untrackedVolumeUSD = ZERO_BD
        tickUpper.collectedFeesToken0 = ZERO_BD
        tickUpper.collectedFeesToken1 = ZERO_BD
        tickUpper.collectedFeesUSD = ZERO_BD
        tickUpper.feeGrowthOutside0X128 = ZERO_BI
        tickUpper.feeGrowthOutside1X128 = ZERO_BI
        tickUpper.save()
      }

      position.tickLower = tickLowerId
      position.tickUpper = tickUpperId
      position.liquidity = ZERO_BI
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
    } else {
      log.warning('Position call reverted for tokenId {}', [tokenId.toString()])
      return null
    }
  }

  return position
}

function updateFeeVars(position: Position, event: ethereum.Event, tokenId: BigInt): Position {
  let positionManagerContract = NonfungiblePositionManager.bind(event.address)
  let positionResult = positionManagerContract.try_positions(tokenId)
  if (!positionResult.reverted) {
    position.feeGrowthInside0LastX128 = positionResult.value.value8
    position.feeGrowthInside1LastX128 = positionResult.value.value9
  } else {
    log.warning('Error updating fee vars for position {}', [position.id])
  }
  return position
}

function savePositionSnapshot(position: Position, event: ethereum.Event): void {
  let positionSnapshot = new PositionSnapshot(position.id.concat('#').concat(event.block.number.toString()))
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

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    log.warning('Position not found for tokenId {} in handleIncreaseLiquidity', [event.params.tokenId.toString()])
    return
  }

  // temp fix for problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Check if pool is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.warning('Pool not found for position {} in handleIncreaseLiquidity', [position.id])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool not initialized for position {} in handleIncreaseLiquidity', [position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for position {} in handleIncreaseLiquidity', [position.id])
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

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    log.warning('Position not found for tokenId {} in handleDecreaseLiquidity', [event.params.tokenId.toString()])
    return
  }

  // temp fix for problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Check if pool is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.warning('Pool not found for position {} in handleDecreaseLiquidity', [position.id])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool not initialized for position {} in handleDecreaseLiquidity', [position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for position {} in handleDecreaseLiquidity', [position.id])
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

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    log.warning('Position not found for tokenId {} in handleCollect', [event.params.tokenId.toString()])
    return
  }

  // temp fix for problematic pools
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  // Check if pool is initialized
  let pool = Pool.load(position.pool)
  if (pool === null) {
    log.warning('Pool not found for position {} in handleCollect', [position.id])
    return
  }

  if (pool.sqrtPrice.equals(ZERO_BI)) {
    log.warning('Pool not initialized for position {} in handleCollect', [position.id])
    return
  }

  let token0 = Token.load(position.token0)
  let token1 = Token.load(position.token1)

  if (token0 === null || token1 === null) {
    log.warning('Tokens not found for position {} in handleCollect', [position.id])
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

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    log.warning('Position not found for tokenId {} in handleTransfer', [event.params.tokenId.toString()])
    return
  }

  position.owner = event.params.to
  position.save()

  savePositionSnapshot(position, event)
}